import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Edges, GizmoHelper, GizmoViewcube, Grid, Html, Line, OrbitControls, OrthographicCamera } from '@react-three/drei';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { cn } from '@/lib/utils';
import { formatLength, type UnitSystem } from '../units';
import { blocksOnFloor, bounds, draftMeshes, type DraftMesh, type Measure, type P3 } from './model';
import type { ExteriorDraft, ViewId } from './types';

export type ModelView = ViewId | '3d';

interface Props {
  draft: ExteriorDraft;
  view: ModelView;
  measures: Measure[];
  units: UnitSystem;
  dark: boolean;
  activePart: string | null;
  activeMeasure: string | null;
  onPickPart: (part: string | null) => void;
  onPickMeasure: (id: string) => void;
}

/** Plan mm (x right, y toward the back, z up) to scene metres (Y up, the back toward -Z). */
const toScene = (p: P3): [number, number, number] => [p.x / 1000, p.z / 1000, -p.y / 1000];

const VIEW_AXES: Record<ViewId, { from: [number, number, number]; up: [number, number, number] }> = {
  top: { from: [0, 1, 0], up: [0, 0, -1] },
  basement: { from: [0, 1, 0], up: [0, 0, -1] },
  ground: { from: [0, 1, 0], up: [0, 0, -1] },
  first: { from: [0, 1, 0], up: [0, 0, -1] },
  front: { from: [0, 0, 1], up: [0, 1, 0] },
  back: { from: [0, 0, -1], up: [0, 1, 0] },
  left: { from: [-1, 0, 0], up: [0, 1, 0] },
  right: { from: [1, 0, 0], up: [0, 1, 0] },
};

/** The clay draft in 3D, or seen straight on like one of the drawings, with its measurements. */
export function DraftViewport({ draft, view, measures, units, dark, activePart, activeMeasure, onPickPart, onPickMeasure }: Props) {
  const meshes = useMemo(() => {
    const all = draftMeshes(draft);
    if (view === 'ground' || view === 'first') {
      // A floor plan: only the walls standing at that floor.
      const ids = new Set(blocksOnFloor(draft, view).map((b) => b.id));
      return all.filter((m) => m.kind === 'wall' && ids.has(m.part));
    }
    // The foundation plan: only the foundations.
    if (view === 'basement') return all.filter((m) => m.kind === 'foundation');
    return all;
  }, [draft, view]);
  const box = bounds(draft);
  const home = useMemo(() => {
    const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, z: box.z1 / 2 };
    const size = Math.hypot(box.x1 - box.x0, box.y1 - box.y0, box.z1) / 1000;
    const d = Math.max(size * 1.75, 10);
    const t = toScene(c);
    return { target: t, camera: [t[0] + d * 0.55, t[1] + d * 0.45, t[2] + d * 0.8] as [number, number, number] };
    // Frame once per view; editing a number shouldn't move the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, draft.createdAt]);

  return (
    <Canvas key={view} camera={{ position: home.camera, fov: 40, near: 0.05, far: 2000 }} onPointerMissed={() => onPickPart(null)}>
      <color attach="background" args={[dark ? '#1b1f26' : '#f4f5f7']} />
      <hemisphereLight args={['#ffffff', '#c9ced4', 1.5]} />
      <directionalLight position={[8, 18, 12]} intensity={1.4} />
      <directionalLight position={[-12, 8, -10]} intensity={0.45} />

      {meshes.map((m) => (
        <ClayMesh key={m.id + m.positions.length} mesh={m} dark={dark} active={activePart === m.part} onPick={onPickPart} />
      ))}

      <Dimensions measures={measures} labelsRight={levelLabelsRight(view)} outward={view === '3d' ? { x: -1, y: 0, z: 0 } : SCREEN[view].right} in3d={view === '3d'} units={units} dark={dark} activePart={activePart} activeMeasure={activeMeasure} onPick={onPickMeasure} />

      <Grid
        args={[200, 200]}
        cellSize={0.3048}
        sectionSize={3.048}
        cellColor={dark ? '#2c333d' : '#dde1e6'}
        sectionColor={dark ? '#4a5563' : '#b4bcc6'}
        cellThickness={0.5}
        sectionThickness={1}
        fadeDistance={view === '3d' ? 90 : 400}
        side={THREE.DoubleSide}
        infiniteGrid
        position={[0, view === 'ground' || view === 'first' || view === 'top' || view === 'basement' ? -8 : 0, 0]}
      />
      {view === '3d' ? (
        <>
          <OrbitControls makeDefault enableDamping target={home.target} />
          <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
            <GizmoViewcube />
          </GizmoHelper>
        </>
      ) : (
        <FlatCamera view={view} draft={draft} measures={measures} />
      )}
    </Canvas>
  );
}

const clayCache = new Map<string, THREE.MeshStandardMaterial>();
function clay(kind: DraftMesh['kind'], dark: boolean, active: boolean) {
  const key = `${kind}|${dark}|${active}`;
  let m = clayCache.get(key);
  if (!m) {
    const color = active
      ? '#f5c46b'
      : kind === 'opening'
        ? dark
          ? '#3d4450'
          : '#6b7480'
        : kind === 'roof'
          ? dark
            ? '#a29f99'
            : '#efede9'
          : kind === 'foundation'
            ? dark
              ? '#7d838c'
              : '#c9ccd1'
          : dark
            ? '#b9b6b0'
            : '#ffffff';
    m = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    clayCache.set(key, m);
  }
  return m;
}

function ClayMesh({ mesh, dark, active, onPick }: { mesh: DraftMesh; dark: boolean; active: boolean; onPick: (part: string) => void }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(mesh.positions.length);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const [x, y, z] = toScene({ x: mesh.positions[i], y: mesh.positions[i + 1], z: mesh.positions[i + 2] });
      pos[i] = x;
      pos[i + 1] = y;
      pos[i + 2] = z;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }, [mesh]);
  return (
    <mesh
      geometry={geometry}
      material={clay(mesh.kind, dark, active)}
      name={mesh.name}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onPick(mesh.part);
      }}
    >
      <Edges threshold={10} color={active ? '#b06a00' : dark ? '#e7e5e4' : '#1c1917'} />
    </mesh>
  );
}

/** Screen right and up for each flat view, in plan axes. */
const SCREEN: Record<ViewId, { right: P3; up: P3 }> = {
  front: { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  back: { right: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  left: { right: { x: 0, y: -1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  right: { right: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  top: { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  basement: { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  ground: { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  first: { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
};
const dot = (a: P3, b: P3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Level names sit on the side of their marker that faces away from the house. */
export const levelLabelsRight = (view: ModelView) => view === 'left' || view === 'back';

/** A flat camera, square to one drawing, that frames the house and its measurements. Pan and zoom only. */
function FlatCamera({ view, draft, measures }: { view: ViewId; draft: ExteriorDraft; measures: Measure[] }) {
  const size = useThree((s) => s.size);
  const [setup] = useState(() => {
    const b = bounds(draft);
    const ax = SCREEN[view];
    const pts: P3[] = [];
    for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [0, b.z1]) pts.push({ x, y, z });
    for (const m of measures) {
      if (m.detail) continue;
      pts.push(m.a, m.b);
      // Room for level names beside their marker.
      if (m.level) {
        const side = levelLabelsRight(view) ? 1 : -1;
        pts.push({ x: m.a.x + ax.right.x * side * 5500, y: m.a.y + ax.right.y * side * 5500, z: m.a.z });
      }
    }
    const us = pts.map((p) => dot(p, ax.right));
    const vs = pts.map((p) => dot(p, ax.up));
    const u0 = Math.min(...us) - 1200;
    const u1 = Math.max(...us) + 1200;
    const v0 = Math.min(...vs) - 900;
    const v1 = Math.max(...vs) + 900;
    const cu = (u0 + u1) / 2;
    const cv = (v0 + v1) / 2;
    const flat = view === 'top' || view === 'ground' || view === 'first' || view === 'basement';
    const c: P3 = {
      x: ax.right.x * cu + ax.up.x * cv,
      y: ax.right.y * cu + ax.up.y * cv,
      z: ax.right.z * cu + ax.up.z * cv + (flat ? b.z1 : 0),
    };
    return { t: toScene(c), ax: VIEW_AXES[view], across: (u1 - u0) / 1000, tall: (v1 - v0) / 1000 };
  });
  const zoom = Math.min(size.width / setup.across, size.height / setup.tall);
  const d = 200;
  const pos: [number, number, number] = [setup.t[0] + setup.ax.from[0] * d, setup.t[1] + setup.ax.from[1] * d, setup.t[2] + setup.ax.from[2] * d];
  return (
    <>
      <OrthographicCamera makeDefault position={pos} up={setup.ax.up} zoom={zoom} near={0.1} far={1000} />
      <OrbitControls
        makeDefault
        enableRotate={false}
        enableDamping
        target={setup.t}
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
    </>
  );
}

const pillBase = 'select-none whitespace-nowrap rounded border px-1 py-px text-[11px] leading-tight font-semibold tabular-nums shadow-sm cursor-pointer';

/** Measurement colours: black when read from the plans or typed by you, red when Claude inferred it. */
export function sourceClass(source: string, dark: boolean) {
  if (source === 'ai') return dark ? 'text-red-400' : 'text-red-600';
  return dark ? 'text-stone-100' : 'text-stone-950';
}

function Dimensions({
  measures,
  labelsRight,
  outward,
  in3d,
  units,
  dark,
  activePart,
  activeMeasure,
  onPick,
}: {
  measures: Measure[];
  labelsRight: boolean;
  /** Screen-right, in plan axes: close levels are staggered along it. */
  outward: P3;
  in3d: boolean;
  units: UnitSystem;
  dark: boolean;
  activePart: string | null;
  activeMeasure: string | null;
  onPick: (id: string) => void;
}) {
  // drei's Html drops the first label under strict mode's double mount; wait a frame.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!ready) return null;
  const ink = dark ? '#e7e5e4' : '#1c1917';
  const red = dark ? '#f87171' : '#dc2626';
  const faint = dark ? '#57534e' : '#c4c0bb';
  const levels = measures.filter((m) => m.level);
  // Levels a foot apart would print over each other: put every other close one in a second column.
  const shift = new Map<string, number>();
  const last = [-Infinity, -Infinity];
  for (const m of [...levels].sort((a, b) => a.a.z - b.a.z)) {
    const col = m.a.z - last[0] > 750 ? 0 : m.a.z - last[1] > 750 ? 1 : 0;
    last[col] = m.a.z;
    shift.set(m.id, col * (labelsRight ? 1 : -1) * 2400);
  }
  const lvlTop = levels.reduce((z, m) => Math.max(z, m.a.z), 0);
  const lvlBottom = levels.reduce((z, m) => Math.min(z, m.a.z), 0);
  return (
    <group>
      {measures.map((m) => {
        if (m.detail && m.part !== activePart && m.id !== activeMeasure) return null;
        // In 3D, door and window sizes would show through the walls: only the picked one's.
        if (in3d && m.opening && m.part !== activePart) return null;
        const on = m.id === activeMeasure;
        const color = on ? '#1d4ed8' : m.dim.source === 'ai' ? red : ink;
        const label = (
          <button
            type="button"
            onClick={() => onPick(m.id)}
            title={`${m.partName}: ${m.label}${m.dim.ref ? `\n${m.dim.ref}` : ''}`}
            className={cn(
              pillBase,
              dark ? 'border-stone-600 bg-stone-900/90' : 'border-stone-300 bg-white/95',
              sourceClass(m.dim.source, dark),
              m.dim.ok && 'border-green-600',
              on && 'ring-2 ring-blue-700 ring-offset-1',
              m.part === activePart && !on && 'border-amber-500',
            )}
          >
            {m.dim.ok && <span className="text-green-600">✓ </span>}
            {m.level ? (
              // Just the height: the name is in the tooltip and the list, so close levels don't collide.
              (m.dim.mm > 0.5 ? '+' : '') + formatLength(m.dim.mm, units)
            ) : (
              formatLength(m.dim.mm, units)
            )}
          </button>
        );
        if (m.level) {
          const p = toScene(m.a);
          const k = shift.get(m.id) ?? 0;
          const q = toScene({ x: m.a.x + outward.x * k, y: m.a.y + outward.y * k, z: m.a.z });
          const o = toScene({ x: m.a.x + outward.x * 300, y: m.a.y + outward.y * 300, z: m.a.z });
          return (
            <group key={m.id}>
              <Line points={[[2 * p[0] - o[0], p[1], 2 * p[2] - o[2]], o]} color={color} lineWidth={2} />
              {k !== 0 && <Line points={[p, q]} color={faint} lineWidth={1} dashed dashSize={0.15} gapSize={0.1} />}
              <Html position={q} zIndexRange={[20, 0]}>
                <div className={cn('-translate-y-1/2', labelsRight ? 'translate-x-3' : '-translate-x-[calc(100%+0.5rem)]')}>{label}</div>
              </Html>
            </group>
          );
        }
        const a = toScene(m.a);
        const b = toScene(m.b);
        const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        return (
          <group key={m.id}>
            {m.from && <Line points={[toScene(m.from[0]), a]} color={faint} lineWidth={1} />}
            {m.from && <Line points={[toScene(m.from[1]), b]} color={faint} lineWidth={1} />}
            <Line points={[a, b]} color={color} lineWidth={on ? 3 : 1.4} />
            <Tick at={a} color={color} />
            <Tick at={b} color={color} />
            <Html position={mid} center zIndexRange={[20, 0]}>
              {label}
            </Html>
          </group>
        );
      })}
      {levels.length > 1 && (
        <Line
          points={[toScene({ ...levels[0].a, z: lvlBottom }), toScene({ ...levels[0].a, z: lvlTop })]}
          color={ink}
          lineWidth={1.2}
        />
      )}
    </group>
  );
}

function Tick({ at, color }: { at: [number, number, number]; color: string }) {
  const r = 0.12;
  return (
    <mesh position={at}>
      <sphereGeometry args={[r / 2.2, 8, 8]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

