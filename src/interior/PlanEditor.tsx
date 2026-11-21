import { useEffect, useMemo, useRef, useState } from 'react';
import { bounds, pointInPolygon, type Vec2 } from '../model/geometry';
import { newId } from '../model/project';
import {
  roomArea,
  formatArea,
  shellOutlines,
  snap,
  snapTargets,
  wallLength,
  wallOutline,
  doorAt,
  stairOutline,
  stairTreads,
  wallGaps,
  wallPiece,
  wallSolids,
  DOOR_DEFAULT,
  type Door,
  type Heading,
  type InteriorWall,
  type Snap,
  type Stair,
  type StoreyLayout,
} from '../model/interior';
import type { Project } from '../model/types';
import { formatLength, type UnitSystem } from '../units';

export type Tool = 'select' | 'wall' | 'door' | 'stair' | 'room';
export type Selection = { type: 'wall' | 'room' | 'door' | 'stair'; id: string } | null;

export interface Underlay {
  url: string;
  /** The sheet's rectangle in the model, mm. */
  minX: number;
  minY: number;
  width: number;
  height: number;
  opacity: number;
}

interface Props {
  project: Project;
  layout: StoreyLayout;
  onChange: (layout: StoreyLayout) => void;
  tool: Tool;
  wallThickness: number;
  /** What the Door tool places. */
  doorKind: Door['kind'];
  /** Risers for a new stair, worked out by the parent from the storey heights. */
  stairSteps: (st: Stair) => number;
  selected: Selection;
  onSelect: (s: Selection) => void;
  /** Called when a room is closed, so its name can be typed. */
  onRoomCreated?: (id: string) => void;
  underlay: Underlay | null;
  units: UnitSystem;
  dark: boolean;
}

interface View {
  cx: number;
  cy: number;
  /** Screen pixels per mm. */
  k: number;
}

const SNAP_PX = 12;

/** The storey seen from above: draw interior walls and rooms over the floor plan. */
export function PlanEditor(props: Props) {
  const { project, layout, onChange, tool, wallThickness, doorKind, stairSteps, selected, onSelect, underlay, units, dark } = props;
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const shells = useMemo(() => shellOutlines(project), [project]);
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState<Vec2[]>([]);
  const [hover, setHover] = useState<Snap | null>(null);
  const pan = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);

  // Keep the drawing area's size, and fit the house the first time.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (view || size.w < 50) return;
    const pts = shells.flatMap((s) => s.outside);
    const b = pts.length ? bounds(pts) : { minX: -5000, maxX: 5000, minY: -5000, maxY: 5000 };
    const k = Math.min(size.w / (b.maxX - b.minX + 3000), size.h / (b.maxY - b.minY + 3000));
    setView({ cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, k });
  }, [shells, size, view]);

  // A new tool starts a fresh drawing (the parent remounts this for each storey).
  useEffect(() => setDraft([]), [tool]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === 'Escape') {
        if (draft.length) setDraft([]);
        else onSelect(null);
      } else if (e.key === 'Enter' && tool === 'room') closeRoom();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        removeSelected();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!view) return <svg ref={svg} className="size-full" />;

  const toModel = (sx: number, sy: number): Vec2 => ({ x: view.cx + (sx - size.w / 2) / view.k, y: view.cy - (sy - size.h / 2) / view.k });
  const toScreen = (p: Vec2): [number, number] => [size.w / 2 + (p.x - view.cx) * view.k, size.h / 2 - (p.y - view.cy) * view.k];
  const local = (e: React.PointerEvent | React.WheelEvent | React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };
  const targets = snapTargets(project, layout, tool === 'room' ? 'face' : 'centre');
  const snapAt = (sx: number, sy: number) => {
    const extra = draft.length >= 3 && tool === 'room' ? { points: [draft[0], ...targets.points], segments: targets.segments } : targets;
    return snap(toModel(sx, sy), extra, SNAP_PX / view.k, draft.at(-1) ?? null, units === 'imperial' ? 25.4 : 10);
  };

  function removeSelected() {
    if (!selected) return;
    onChange(removeFrom(layout, selected));
    onSelect(null);
  }

  /** The wall under a point, within a few pixels. */
  function wallAt(p: Vec2): InteriorWall | undefined {
    const tol = 6 / view!.k;
    return [...layout.walls].reverse().find((w) => pointInPolygon(p, wallOutline({ ...w, thickness: w.thickness + 2 * tol })));
  }

  /** Where the Door tool would put a door now: a wall and a position along it. */
  function doorPreview(p: Vec2) {
    const w = wallAt(p);
    if (!w) return null;
    const width = Math.min(DOOR_DEFAULT[doorKind].width, wallLength(w));
    return { wall: w, at: doorAt(w, p, width), width };
  }

  /** A stair from two opposite corners: it climbs along its longer side, away from the first corner. */
  function stairFrom(a: Vec2, b: Vec2): Stair {
    const sx = Math.abs(b.x - a.x);
    const sy = Math.abs(b.y - a.y);
    const heading: Heading = sy >= sx ? (b.y > a.y ? 'up' : 'down') : b.x > a.x ? 'right' : 'left';
    return { id: newId(), x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), sx, sy, heading };
  }

  function closeRoom() {
    if (draft.length < 3) return;
    const id = newId();
    const n = layout.rooms.length + 1;
    onChange({ ...layout, rooms: [...layout.rooms, { id, name: `Room ${n}`, outline: draft }] });
    setDraft([]);
    onSelect({ type: 'room', id });
    props.onRoomCreated?.(id);
  }

  function hit(p: Vec2): Selection {
    const tol = 6 / view!.k;
    for (const w of layout.walls) {
      for (const g of wallGaps(w, layout.doors)) {
        if (pointInPolygon(p, wallPiece({ ...w, thickness: w.thickness + 2 * tol }, g.from, g.to))) return { type: 'door', id: g.door.id };
      }
    }
    for (const st of [...(layout.stairs ?? [])].reverse()) if (pointInPolygon(p, stairOutline(st))) return { type: 'stair', id: st.id };
    for (const w of [...layout.walls].reverse()) {
      const grown = wallOutline({ ...w, thickness: w.thickness + 2 * tol });
      if (pointInPolygon(p, grown)) return { type: 'wall', id: w.id };
    }
    for (const r of [...layout.rooms].reverse()) if (pointInPolygon(p, r.outline)) return { type: 'room', id: r.id };
    return null;
  }

  function click(sx: number, sy: number) {
    if (tool === 'select') {
      onSelect(hit(toModel(sx, sy)));
      return;
    }
    if (tool === 'door') {
      const d = doorPreview(toModel(sx, sy));
      if (!d) return;
      const door: Door = { id: newId(), wallId: d.wall.id, kind: doorKind, at: d.at, width: d.width, height: DOOR_DEFAULT[doorKind].height, swing: 1, hinge: 'start' };
      onChange({ ...layout, doors: [...(layout.doors ?? []), door] });
      onSelect({ type: 'door', id: door.id });
      return;
    }
    const s = snapAt(sx, sy);
    if (tool === 'stair') {
      if (!draft.length) setDraft([s.p]);
      else {
        const st = stairFrom(draft[0], s.p);
        if (st.sx >= 300 && st.sy >= 300) {
          onChange({ ...layout, stairs: [...(layout.stairs ?? []), st] });
          onSelect({ type: 'stair', id: st.id });
        }
        setDraft([]);
      }
      return;
    }
    if (tool === 'wall') {
      const from = draft.at(-1);
      if (from && wallLength({ a: from, b: s.p }) >= 25) {
        onChange({ ...layout, walls: [...layout.walls, { id: newId(), a: from, b: s.p, thickness: wallThickness }] });
      }
      setDraft([s.p]);
    } else {
      if (draft.length >= 3 && s.p === draft[0]) closeRoom();
      else if (!draft.length || wallLength({ a: draft[draft.length - 1], b: s.p }) >= 1) setDraft([...draft, s.p]);
    }
  }

  const ink = dark ? '#e7e5e4' : '#1c1917';
  const shellFill = dark ? '#57534e' : '#a8a29e';
  const wallFill = dark ? '#d6d3d1' : '#44403c';
  const sel = '#1d4ed8';
  const path = (poly: Vec2[]) => `M${poly.map((p) => `${p.x},${p.y}`).join('L')}Z`;
  const last = draft.at(-1);
  const preview = hover && last ? hover.p : null;

  return (
    <svg
      ref={svg}
      className="size-full touch-none select-none"
      style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
      onWheel={(e) => {
        const { sx, sy } = local(e);
        const before = toModel(sx, sy);
        const k = Math.min(2, Math.max(0.005, view.k * Math.exp(-e.deltaY * 0.0015)));
        setView({ k, cx: before.x - (sx - size.w / 2) / k, cy: before.y + (sy - size.h / 2) / k });
      }}
      onPointerDown={(e) => {
        const { sx, sy } = local(e);
        if (e.button === 0 && tool !== 'select') return;
        svg.current!.setPointerCapture(e.pointerId);
        pan.current = { x: sx, y: sy, view, moved: false };
      }}
      onPointerMove={(e) => {
        const { sx, sy } = local(e);
        const p = pan.current;
        if (p) {
          if (Math.abs(sx - p.x) + Math.abs(sy - p.y) > 3) p.moved = true;
          if (p.moved) setView({ ...p.view, cx: p.view.cx - (sx - p.x) / p.view.k, cy: p.view.cy + (sy - p.y) / p.view.k });
          return;
        }
        setHover(tool === 'select' ? null : tool === 'door' ? { p: toModel(sx, sy), kind: 'grid' } : snapAt(sx, sy));
      }}
      onPointerUp={(e) => {
        const { sx, sy } = local(e);
        const p = pan.current;
        pan.current = null;
        if (p && !p.moved && e.button === 0) click(sx, sy);
        if (!p && e.button === 0) click(sx, sy);
      }}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={() => (tool === 'room' ? closeRoom() : setDraft([]))}
      onContextMenu={(e) => {
        e.preventDefault();
        if (draft.length) setDraft([]);
      }}
    >
      <g transform={`translate(${size.w / 2},${size.h / 2}) scale(${view.k},${-view.k}) translate(${-view.cx},${-view.cy})`}>
        {underlay && (
          <image
            href={underlay.url}
            x={underlay.minX}
            y={-(underlay.minY + underlay.height)}
            width={underlay.width}
            height={underlay.height}
            transform="scale(1,-1)"
            opacity={underlay.opacity}
            preserveAspectRatio="none"
          />
        )}
        {shells.map((s) => (
          <path key={s.id} d={path(s.outside) + path([...s.inside].reverse())} fill={shellFill} fillOpacity={0.55} stroke={ink} strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
        ))}
        {layout.rooms.map((r) => {
          const on = selected?.type === 'room' && selected.id === r.id;
          return (
            <path key={r.id} d={path(r.outline)} fill={on ? sel : '#16a34a'} fillOpacity={on ? 0.18 : 0.1} stroke={on ? sel : '#16a34a'} strokeWidth={on ? 2 : 1} strokeDasharray={on ? undefined : '4 3'} vectorEffect="non-scaling-stroke" />
          );
        })}
        {(layout.stairs ?? []).map((st) => {
          const on = selected?.type === 'stair' && selected.id === st.id;
          return <StairShape key={st.id} st={st} steps={stairSteps(st)} color={on ? sel : ink} fill={on ? sel : dark ? '#44403c' : '#f5f5f4'} />;
        })}
        {tool === 'stair' && draft.length === 1 && hover && (
          <StairShape st={stairFrom(draft[0], hover.p)} steps={stairSteps(stairFrom(draft[0], hover.p))} color={sel} fill={sel} faint />
        )}
        {layout.walls.map((w) => {
          const on = selected?.type === 'wall' && selected.id === w.id;
          return (
            <g key={w.id}>
              {wallSolids(w, layout.doors).map(([a, b], i) => (
                <path key={i} d={path(wallPiece(w, a, b))} fill={on ? sel : wallFill} stroke={on ? sel : ink} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              ))}
              {wallGaps(w, layout.doors).map((g) => (
                <DoorShape key={g.door.id} wall={w} from={g.from} to={g.to} door={g.door} color={selected?.id === g.door.id ? sel : ink} />
              ))}
            </g>
          );
        })}
        {tool === 'door' &&
          hover &&
          (() => {
            const d = doorPreview(hover.p);
            if (!d) return null;
            return <path d={path(wallPiece({ ...d.wall, thickness: d.wall.thickness + 40 / view.k }, d.at - d.width / 2, d.at + d.width / 2))} fill={sel} fillOpacity={0.4} stroke={sel} vectorEffect="non-scaling-stroke" />;
          })()}
        {tool === 'wall' && last && preview && (
          <path d={path(wallOutline({ id: '', a: last, b: preview, thickness: wallThickness }))} fill={sel} fillOpacity={0.35} stroke={sel} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
        {tool === 'room' && draft.length > 0 && (
          <polyline
            points={[...draft, ...(preview ? [preview] : [])].map((p) => `${p.x},${p.y}`).join(' ')}
            fill={sel}
            fillOpacity={0.08}
            stroke={sel}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </g>

      {/* Labels, in screen space so they stay readable. */}
      {layout.walls.map((w) => {
        const len = wallLength(w);
        if (len * view.k < 40) return null;
        const [x, y] = toScreen({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
        return <Tag key={w.id} x={x} y={y} text={formatLength(len, units)} dark={dark} />;
      })}
      {layout.rooms.map((r) => {
        const b = bounds(r.outline);
        const [x, y] = toScreen({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
        return (
          <g key={r.id} pointerEvents="none">
            <text x={x} y={y - 3} textAnchor="middle" fontSize={13} fontWeight={600} fill={dark ? '#bbf7d0' : '#14532d'} stroke={dark ? '#1c1917' : '#fff'} strokeWidth={3} paintOrder="stroke">
              {r.name}
            </text>
            <text x={x} y={y + 13} textAnchor="middle" fontSize={11} fill={dark ? '#d6d3d1' : '#44403c'} stroke={dark ? '#1c1917' : '#fff'} strokeWidth={3} paintOrder="stroke">
              {formatArea(roomArea(r), units)}
            </text>
          </g>
        );
      })}
      {draft.map((p, i) => {
        const [x, y] = toScreen(p);
        return <circle key={i} cx={x} cy={y} r={i === 0 && tool === 'room' ? 5 : 3} fill="white" stroke={sel} strokeWidth={2} pointerEvents="none" />;
      })}
      {hover && tool !== 'select' && tool !== 'door' && (
        <g pointerEvents="none">
          {(() => {
            const [x, y] = toScreen(hover.p);
            const len = last ? wallLength({ a: last, b: hover.p }) : 0;
            const stair = tool === 'stair' && last ? stairFrom(last, hover.p) : null;
            return (
              <>
                <circle cx={x} cy={y} r={hover.kind === 'corner' ? 6 : 4} fill="none" stroke={sel} strokeWidth={2} />
                <Tag x={x + 14} y={y - 14} anchor="start" text={`${stair ? `${formatLength(stair.sx, units)} × ${formatLength(stair.sy, units)}` : last ? formatLength(len, units) : ''}${hover.kind === 'grid' ? '' : `${last ? ' · ' : ''}${SNAP_NAMES[hover.kind]}`}`} dark={dark} hideEmpty />
              </>
            );
          })()}
        </g>
      )}
    </svg>
  );
}

const SNAP_NAMES: Record<Snap['kind'], string> = { corner: 'corner', face: 'on wall', end: 'end', grid: '', square: 'square' };

function Tag({ x, y, text, dark, anchor = 'middle', hideEmpty }: { x: number; y: number; text: string; dark: boolean; anchor?: 'middle' | 'start'; hideEmpty?: boolean }) {
  if (hideEmpty && !text) return null;
  const w = text.length * 6.6 + 10;
  const left = anchor === 'middle' ? x - w / 2 : x;
  return (
    <g pointerEvents="none">
      <rect x={left} y={y - 9} width={w} height={18} rx={4} fill={dark ? '#1c1917' : '#ffffff'} fillOpacity={0.92} stroke={dark ? '#57534e' : '#d6d3d1'} />
      <text x={left + w / 2} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={500} fill={dark ? '#f5f5f4' : '#1c1917'} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {text}
      </text>
    </g>
  );
}

/** Take a wall, room, door or stair out of the layout (a wall takes its doors with it). */
export function removeFrom(layout: StoreyLayout, sel: NonNullable<Selection>): StoreyLayout {
  switch (sel.type) {
    case 'wall':
      return { ...layout, walls: layout.walls.filter((w) => w.id !== sel.id), doors: (layout.doors ?? []).filter((d) => d.wallId !== sel.id) };
    case 'room':
      return { ...layout, rooms: layout.rooms.filter((r) => r.id !== sel.id) };
    case 'door':
      return { ...layout, doors: (layout.doors ?? []).filter((d) => d.id !== sel.id) };
    case 'stair':
      return { ...layout, stairs: (layout.stairs ?? []).filter((s) => s.id !== sel.id) };
  }
}

/** A door as drawn on plans: the leaf open at 90° and its swing arc; an opening as two jamb lines. */
function DoorShape({ wall, from, to, door, color }: { wall: InteriorWall; from: number; to: number; door: Door; color: string }) {
  const len = wallLength(wall) || 1;
  const ux = (wall.b.x - wall.a.x) / len;
  const uy = (wall.b.y - wall.a.y) / len;
  const nx = -uy;
  const ny = ux;
  const at = (d: number, off = 0) => ({ x: wall.a.x + ux * d + nx * off, y: wall.a.y + uy * d + ny * off });
  const t = wall.thickness / 2;
  const jambs = [from, to].map((d) => {
    const p = at(d, -t);
    const q = at(d, t);
    return <line key={d} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
  });
  if (door.kind === 'opening') return <g>{jambs}</g>;
  const side = door.swing ?? 1;
  const hingeAt = door.hinge === 'end' ? to : from;
  const freeAt = door.hinge === 'end' ? from : to;
  const w = to - from;
  const hinge = at(hingeAt, side * t);
  const open = { x: hinge.x + nx * side * w, y: hinge.y + ny * side * w };
  const closed = at(freeAt, side * t);
  // Sweep direction depends on which way round the arc goes, in the flipped (y-up) drawing.
  const cross = (closed.x - hinge.x) * (open.y - hinge.y) - (closed.y - hinge.y) * (open.x - hinge.x);
  return (
    <g>
      {jambs}
      <line x1={hinge.x} y1={hinge.y} x2={open.x} y2={open.y} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <path d={`M${closed.x},${closed.y} A${w},${w} 0 0 ${cross > 0 ? 1 : 0} ${open.x},${open.y}`} fill="none" stroke={color} strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
    </g>
  );
}

/** A stair as drawn on plans: its outline, a line per tread and an arrow pointing up the stair. */
function StairShape({ st, steps, color, fill, faint }: { st: Stair; steps: number; color: string; fill: string; faint?: boolean }) {
  const treads = stairTreads(st, Math.max(1, steps - 1));
  const o = stairOutline(st);
  const mid = (p: Vec2[]) => ({ x: (p[0].x + p[2].x) / 2, y: (p[0].y + p[2].y) / 2 });
  const a = mid(treads[0]);
  const b = mid(treads[treads.length - 1]);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const head = Math.min(st.sx, st.sy) * 0.25;
  return (
    <g opacity={faint ? 0.6 : 1}>
      <path d={`M${o.map((p) => `${p.x},${p.y}`).join('L')}Z`} fill={fill} fillOpacity={faint ? 0.15 : fill === color ? 0.18 : 1} stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {treads.slice(1).map((t, i) => (
        <line key={i} x1={t[0].x} y1={t[0].y} x2={st.heading === 'up' || st.heading === 'down' ? t[1].x : t[3].x} y2={st.heading === 'up' || st.heading === 'down' ? t[1].y : t[3].y} stroke={color} strokeWidth={0.75} vectorEffect="non-scaling-stroke" />
      ))}
      <path
        d={`M${a.x},${a.y}L${b.x},${b.y}M${b.x - ux * head - uy * head * 0.6},${b.y - uy * head + ux * head * 0.6}L${b.x},${b.y}L${b.x - ux * head + uy * head * 0.6},${b.y - uy * head - ux * head * 0.6}`}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}
