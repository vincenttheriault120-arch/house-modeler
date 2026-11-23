/**
 * Scoring a draft against an answer sheet: a small JSON file of the values a
 * person has read off their plans and confirmed. It lets us tell whether a
 * change to how Claude reads plans makes drafts better, rather than judging by eye.
 *
 * The answer sheet uses the draft's frame (mm; x from the leftmost wall, y back
 * from the front, z above grade) and describes parts, not how Claude must split
 * them: each expected part is matched to the drafted block that overlaps it most.
 */
import { bounds, house, top } from './model';
import type { Block, ExteriorDraft, RoofType } from './types';

/** A value in mm, or with its own tolerance (for values scaled off a drawing rather than written). */
export type SheetValue = number | { mm: number; tol?: number; note?: string };

export interface SheetPart {
  id: string;
  name: string;
  kind: 'volume' | 'foundation';
  x?: SheetValue;
  y?: SheetValue;
  width?: SheetValue;
  depth?: SheetValue;
  /** Volumes: bottom and top of the walls. Foundations: bottom and top of the foundation walls. */
  base?: SheetValue;
  top?: SheetValue;
  /** Volumes: the highest point of the roof. */
  roofTop?: SheetValue;
  roofType?: RoofType;
  /** Foundations. */
  foundation?: 'basement' | 'slab';
  note?: string;
}

export interface AnswerSheet {
  name: string;
  /** Default tolerance for a value counted right, in mm. */
  tolerance?: number;
  overall?: { width?: SheetValue; depth?: SheetValue; height?: SheetValue };
  parts: SheetPart[];
}

export type Verdict = 'right' | 'close' | 'wrong' | 'missing';

export interface ScoreRow {
  part: string;
  label: string;
  expected: string;
  got: string;
  verdict: Verdict;
}

export interface Score {
  sheet: string;
  rows: ScoreRow[];
  counts: Record<Verdict, number>;
  /** Drafted blocks no expected part matched. */
  extra: string[];
}

const DEFAULT_TOL = 13; // about half an inch
const CLOSE = 50;

function val(v: SheetValue): { mm: number; tol?: number } {
  return typeof v === 'number' ? { mm: v } : v;
}

/** Reads and checks an answer sheet file. Throws a plain-language error. */
export function parseAnswerSheet(text: string): AnswerSheet {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not an answer sheet (it is not valid JSON).');
  }
  const s = raw as Partial<AnswerSheet>;
  if (!s || typeof s !== 'object' || !Array.isArray(s.parts)) throw new Error('That file is not an answer sheet (it has no "parts" list).');
  for (const p of s.parts) {
    if (!p || typeof p.id !== 'string' || (p.kind !== 'volume' && p.kind !== 'foundation')) {
      throw new Error('Each part in the answer sheet needs an "id" and a "kind" of "volume" or "foundation".');
    }
  }
  return { name: typeof s.name === 'string' ? s.name : 'Answer sheet', tolerance: s.tolerance, overall: s.overall, parts: s.parts };
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

function blockBox(b: Block): Box {
  return { x0: b.x.mm, x1: b.x.mm + b.width.mm, y0: b.y.mm, y1: b.y.mm + b.depth.mm, z0: b.base.mm, z1: top(b) };
}

/** The part's box, filling what the sheet leaves out from the block it is compared with. */
function partBox(p: SheetPart, fill: Box): Box {
  const n = (v: SheetValue | undefined, d: number) => (v === undefined ? d : val(v).mm);
  const x0 = n(p.x, fill.x0);
  const y0 = n(p.y, fill.y0);
  const z0 = n(p.base, fill.z0);
  return { x0, y0, z0, x1: x0 + n(p.width, fill.x1 - fill.x0), y1: y0 + n(p.depth, fill.y1 - fill.y0), z1: n(p.top, fill.z1) };
}

function overlap(a: Box, b: Box): number {
  const len = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const vol = (q: Box) => (q.x1 - q.x0) * (q.y1 - q.y0) * Math.max(1, q.z1 - q.z0);
  const i = len(a.x0, a.x1, b.x0, b.x1) * len(a.y0, a.y1, b.y0, b.y1) * Math.max(1, len(a.z0, a.z1, b.z0, b.z1));
  if (i <= 0) return 0;
  return i / (vol(a) + vol(b) - i);
}

/** The highest point of a block's roof above grade. */
function roofTop(b: Block): number {
  return top(b) + (b.roof.type === 'flat' ? 0 : b.roof.rise.mm);
}

/** How much of block b's volume lies inside box a. */
function inside(a: Box, b: Box): number {
  const len = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const i = len(a.x0, a.x1, b.x0, b.x1) * len(a.y0, a.y1, b.y0, b.y1) * Math.max(1, len(a.z0, a.z1, b.z0, b.z1));
  return i / ((b.x1 - b.x0) * (b.y1 - b.y0) * Math.max(1, b.z1 - b.z0));
}

/**
 * Pairs each expected part with the drafted block that overlaps it most, best pairs first.
 * Other blocks that lie mostly inside the same part join it, so a part Claude drafted in
 * several boxes (e.g. split where a wall jogs) is scored as their outside box.
 */
function match(sheet: AnswerSheet, draft: ExteriorDraft): Map<string, Block[]> {
  const pairs: { part: SheetPart; block: Block; iou: number }[] = [];
  for (const part of sheet.parts) {
    for (const block of draft.blocks) {
      if ((part.kind === 'foundation') !== !!block.foundation) continue;
      const bb = blockBox(block);
      const iou = overlap(partBox(part, bb), bb);
      if (iou >= 0.2) pairs.push({ part, block, iou });
    }
  }
  pairs.sort((a, b) => b.iou - a.iou);
  const out = new Map<string, Block[]>();
  const used = new Set<string>();
  for (const { part, block } of pairs) {
    if (out.has(part.id) || used.has(block.id)) continue;
    out.set(part.id, [block]);
    used.add(block.id);
  }
  for (const part of sheet.parts) {
    const first = out.get(part.id)?.[0];
    if (!first) continue;
    const box = partBox(part, blockBox(first));
    for (const block of draft.blocks) {
      if (used.has(block.id) || (part.kind === 'foundation') !== !!block.foundation) continue;
      if (inside(box, blockBox(block)) >= 0.6) {
        out.get(part.id)!.push(block);
        used.add(block.id);
      }
    }
  }
  return out;
}

/** The outside box of several blocks, as one block; the roof is the highest one's. */
function merged(blocks: Block[]): Block {
  if (blocks.length === 1) return blocks[0];
  const boxes = blocks.map(blockBox);
  const x0 = Math.min(...boxes.map((b) => b.x0));
  const y0 = Math.min(...boxes.map((b) => b.y0));
  const z0 = Math.min(...boxes.map((b) => b.z0));
  const z1 = Math.max(...boxes.map((b) => b.z1));
  const high = blocks.reduce((a, b) => (roofTop(b) > roofTop(a) ? b : a));
  const mm = (v: number) => ({ mm: v, source: 'ai' as const });
  return {
    ...high,
    name: blocks.map((b) => b.name).join('" + "'),
    x: mm(x0),
    y: mm(y0),
    width: mm(Math.max(...boxes.map((b) => b.x1)) - x0),
    depth: mm(Math.max(...boxes.map((b) => b.y1)) - y0),
    base: mm(z0),
    height: mm(z1 - z0),
    roof: { ...high.roof, rise: mm(roofTop(high) - z1) },
  };
}

export function scoreDraft(draft: ExteriorDraft, sheet: AnswerSheet, fmt: (mm: number) => string = (mm) => `${Math.round(mm)} mm`): Score {
  const tol0 = sheet.tolerance ?? DEFAULT_TOL;
  const rows: ScoreRow[] = [];
  const num = (part: string, label: string, want: SheetValue | undefined, got: number | undefined) => {
    if (want === undefined) return;
    const w = val(want);
    const tol = w.tol ?? tol0;
    if (got === undefined) {
      rows.push({ part, label, expected: fmt(w.mm), got: '—', verdict: 'missing' });
      return;
    }
    const off = Math.abs(got - w.mm);
    const verdict: Verdict = off <= tol ? 'right' : off <= Math.max(CLOSE, 2 * tol) ? 'close' : 'wrong';
    rows.push({ part, label, expected: fmt(w.mm), got: fmt(got), verdict });
  };

  if (sheet.overall) {
    const blocks = house(draft);
    const b = blocks.length ? bounds({ ...draft, blocks }) : undefined;
    num('Whole house', 'Overall width', sheet.overall.width, b && b.x1 - b.x0);
    num('Whole house', 'Overall depth', sheet.overall.depth, b && b.y1 - b.y0);
    num('Whole house', 'Highest point above grade', sheet.overall.height, b && b.z1);
  }

  const matched = match(sheet, draft);
  for (const p of sheet.parts) {
    const found = matched.get(p.id);
    const name = p.name || p.id;
    if (!found) {
      rows.push({ part: name, label: p.kind === 'foundation' ? 'Foundation' : 'Part', expected: 'drafted', got: 'not found', verdict: 'missing' });
      continue;
    }
    const b = merged(found);
    const part = `${name} (drafted as "${b.name}")`;
    num(part, 'Left side (x)', p.x, b.x.mm);
    num(part, 'Front (y)', p.y, b.y.mm);
    num(part, 'Width', p.width, b.width.mm);
    num(part, 'Depth', p.depth, b.depth.mm);
    num(part, 'Bottom of walls', p.base, b.base.mm);
    num(part, 'Top of walls', p.top, top(b));
    if (p.kind === 'volume') {
      num(part, 'Highest point of roof', p.roofTop, roofTop(b));
      if (p.roofType) {
        rows.push({ part, label: 'Roof shape', expected: p.roofType, got: b.roof.type, verdict: b.roof.type === p.roofType ? 'right' : 'wrong' });
      }
    } else if (p.foundation) {
      const got = b.foundation?.type;
      rows.push({ part, label: 'Foundation type', expected: p.foundation, got: got ?? '—', verdict: got === p.foundation ? 'right' : 'wrong' });
    }
  }

  const usedIds = new Set([...matched.values()].flat().map((b) => b.id));
  const extra = draft.blocks.filter((b) => !usedIds.has(b.id)).map((b) => b.name);
  const counts: Record<Verdict, number> = { right: 0, close: 0, wrong: 0, missing: 0 };
  for (const r of rows) counts[r.verdict]++;
  return { sheet: sheet.name, rows, counts, extra };
}
