import { fmtFt, parseLevel, type SheetMeasures } from '../plans/measure';
import { top } from './model';
import type { Block, ExteriorDraft } from './types';

const FT = 304.8; // mm per foot

/**
 * The drawings' level system against the draft's heights above grade: the offset (in feet) that
 * turns the most draft levels into levels written on the measured sheets, e.g. 100' when grade is
 * written as 100'-0". Needs at least two levels to agree, else null.
 */
export function findDatum(draft: ExteriorDraft, sheets: { m: SheetMeasures }[]): number | null {
  const written = [...new Set(sheets.flatMap((s) => s.m.levels.map(parseLevel)).filter((v): v is number => v !== null))];
  const votes = new Map<number, Set<number>>();
  for (const l of draft.levels) {
    const e = l.elevation.mm / FT;
    for (const w of written) {
      const key = Math.round((w - e) * 24); // to the half inch
      if (!votes.has(key)) votes.set(key, new Set());
      votes.get(key)!.add(Math.round(w * 24));
    }
  }
  let best: [number, number] | null = null;
  for (const [k, v] of votes) if (!best || v.size > best[1]) best = [k, v.size];
  return best && best[1] >= 2 ? best[0] / 24 : null;
}

/**
 * Puts the eave of each hip or gable roof where the drawings' lines put it. A roof is matched to a
 * measured peak by its height (within 6"); when the measured eave under that peak differs from the
 * draft's wall top by more than half an inch (and less than 3'), the wall top moves to the measured
 * eave and the rise grows or shrinks so the peak stays where it was. The new values are inferred
 * (red), with the sheet they were measured on. Drafts with no matching measurements are unchanged.
 */
export function applyMeasuredEaves(draft: ExteriorDraft, sheets: { title: string; m: SheetMeasures }[]): ExteriorDraft {
  const datum = findDatum(draft, sheets);
  if (datum === null) return draft;
  const notes: string[] = [];
  const blocks = draft.blocks.map((b): Block => {
    if (b.foundation || (b.roof.type !== 'hip' && b.roof.type !== 'gable')) return b;
    const wallTop = top(b) / FT + datum;
    const peak = wallTop + b.roof.rise.mm / FT;
    const found: { eave: number; title: string }[] = [];
    for (const s of sheets)
      for (const p of s.m.peaks) if (p.eave && Math.abs(p.height - peak) <= 0.5) found.push({ eave: p.eave.height, title: s.title });
    if (!found.length) return b;
    const eaves = found.map((f) => f.eave).sort((x, y) => x - y);
    const eave = eaves[Math.floor((eaves.length - 1) / 2)];
    const diff = eave - wallTop;
    if (Math.abs(diff) < 0.5 / 12 || Math.abs(diff) > 3) return b;
    const where = [...new Set(found.map((f) => f.title))].join(' and ');
    const off = `${fmtFt(Math.abs(diff)).replace(/^0' /, '')} ${diff < 0 ? 'below' : 'above'} where it was drafted (${fmtFt(wallTop)})`;
    const ref = `Measured from the lines of ${where}: roof eave at ${fmtFt(eave)}, ${off}.`;
    const newTopMm = (eave - datum) * FT;
    notes.push(`${b.name}: roof eave moved to ${fmtFt(eave)}, ${off}, as measured on the drawings.`);
    return {
      ...b,
      height: { mm: Math.round(newTopMm - b.base.mm), source: 'ai', ref },
      roof: { ...b.roof, rise: { mm: Math.round((peak - eave) * FT), source: 'ai', ref: `Peak kept; rise from the measured eave. ${b.roof.rise.ref ?? ''}`.trim() } },
    };
  });
  if (!notes.length) return draft;
  return { ...draft, blocks, summary: `${draft.summary} ${notes.join(' ')}`.trim() };
}
