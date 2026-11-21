import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { Edges, GizmoHelper, GizmoViewcube, Grid, Html, Line, OrbitControls, OrthographicCamera } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { cn } from '@/lib/utils';
import type { Component } from './model/component';
import type { LengthDimension, LevelMark, Point3 } from './model/dimensions';
import type { SheetView } from './model/calibration';
import type { MeasureState } from './model/checks';
import { formatLength, type UnitSystem } from './units';
import { componentGeometry, materialFor } from './scene/meshes';

interface Props {
  dark?: boolean;
  components: Component[];
  /** Grid cell size in mm. */
  gridSpacing: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Clay mode: one matte grey for everything, with crisp dark outlines. */
  clay?: boolean;
  /** Measurements to draw on the model. */
  dimensions?: { lengths: LengthDimension[]; levels: LevelMark[] };
  /** How each measurement stands against the plans (dimension and `level:<id>` ids). */
  checkStates?: Record<string, MeasureState>;
  /** The measurement being checked, drawn highlighted. */
  activeCheck?: string | null;
  /** Clicking a measurement's label picks it for checking. */
  onPickCheck?: (id: string) => void;
  units?: UnitSystem;
  /** A calibrated plan laid over the model, seen straight on. */
  backdrop?: Backdrop;
}

export interface Backdrop {
  texture: THREE.Texture;
  view: SheetView;
  /** The sheet's centre and size in the model, mm. */
  center: Point3;
  width: number;
  height: number;
  opacity: number;
  /** What to frame: the middle of the model and how big it is, mm. */
  focus: Point3;
  span: number;
  /** view: look only; move: drag the sheet; align: click points on it. */
  mode?: 'view' | 'move' | 'align';
  /** The point picked first when aligning. */
  marker?: Point3 | null;
  onPick?: (p: Point3) => void;
  /** While dragging: the move so far; done on release. */
  onDrag?: (d: Point3, done: boolean) => void;
}

/**
 * The 3D view. Scene units are metres. Y is up and grade is at 0. To reset
 * the camera, remount this component.
 */
export function Viewport({ dark = false, components, gridSpacing, selectedId, onSelect, clay = false, dimensions, units = 'imperial', backdrop, checkStates, activeCheck, onPickCheck }: Props) {
  const cell = gridSpacing / 1000;
  // Frame the measurements too, with room for the level names left of their marker.
  const extra = useMemo(
    () => (dimensions ? dimensions.levels.flatMap((l) => [l.at, { ...l.at, x: l.at.x - 4000 }]) : []),
    [dimensions],
  );
  const view = useMemo(() => homeView(components, extra), [components.length === 0, !!dimensions]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Canvas
      camera={{ position: view.camera, fov: 45, near: 0.05, far: 2000 }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={[dark ? '#1b1f26' : '#eef1f4']} />
      <hemisphereLight args={['#ffffff', '#b8c0c8', 1.3]} />
      <directionalLight position={[10, 20, 8]} intensity={1.6} />
      <directionalLight position={[-12, 8, -10]} intensity={0.5} />

      {components.map((c) => (
        <ComponentMesh
          key={c.id + JSON.stringify(c.outline) + c.bottom + c.top}
          component={c}
          selected={c.id === selectedId}
          onSelect={onSelect}
          clay={clay}
          dark={dark}
        />
      ))}

      {dimensions && (
        <Dimensions {...dimensions} units={units} dark={dark} states={checkStates} active={activeCheck ?? null} onPick={onPickCheck} />
      )}
      {backdrop && <PlanSheet backdrop={backdrop} />}

      <Grid
        args={[200, 200]}
        cellSize={cell}
        sectionSize={cell * 10}
        cellColor={dark ? '#2c333d' : '#c3cad3'}
        sectionColor={dark ? '#4a5563' : '#8e99a6'}
        cellThickness={0.6}
        sectionThickness={1.1}
        fadeDistance={120}
        side={THREE.DoubleSide}
        infiniteGrid
      />

      {backdrop ? (
        <CompareCamera backdrop={backdrop} />
      ) : (
        <OrbitControls makeDefault enableDamping target={view.target} />
      )}
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewcube />
      </GizmoHelper>
    </Canvas>
  );
}

function ComponentMesh({
  component,
  selected,
  onSelect,
  clay,
  dark,
}: {
  component: Component;
  selected: boolean;
  onSelect: (id: string) => void;
  clay: boolean;
  dark: boolean;
}) {
  const geometry = useMemo(() => componentGeometry(component), [component]);
  const material = useMemo(() => {
    const base = clay ? clayMaterial(dark) : materialFor(component.material);
    if (!selected) return base;
    const m = base.clone();
    m.color.set('#f2a93b');
    return m;
  }, [component.material, selected, clay, dark]);
  const edge = selected ? '#b06a00' : clay ? (dark ? '#e7e5e4' : '#1c1917') : '#6b7178';

  return (
    <mesh
      geometry={geometry}
      material={material}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect(component.id);
      }}
    >
      <Edges threshold={clay ? 15 : 20} color={edge} />
    </mesh>
  );
}

/** Camera position looking at the model's middle from the front-right. */
function homeView(components: Component[], extra: Point3[] = []) {
  if (components.length === 0) {
    return { camera: [14, 11, 16] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
  }
  const box = new THREE.Box3();
  for (const c of components) {
    for (const p of c.outline) {
      box.expandByPoint(new THREE.Vector3(p.x / 1000, c.bottom / 1000, -p.y / 1000));
      box.expandByPoint(new THREE.Vector3(p.x / 1000, c.top / 1000, -p.y / 1000));
    }
  }
  for (const p of extra) box.expandByPoint(new THREE.Vector3(...toScene(p)));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const d = Math.max(size * 1.5, 8);
  return {
    camera: [center.x + d * 0.6, center.y + d * 0.55, center.z + d * 0.75] as [number, number, number],
    target: [center.x, center.y, center.z] as [number, number, number],
  };
}

const clayCache = new Map<boolean, THREE.MeshStandardMaterial>();

/** Matte, untextured grey: the shape reads, nothing distracts from the measurements. */
function clayMaterial(dark: boolean): THREE.MeshStandardMaterial {
  let m = clayCache.get(dark);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: dark ? '#8f8c86' : '#dedbd5', roughness: 1, metalness: 0 });
    m.name = 'Clay';
    clayCache.set(dark, m);
  }
  return m;
}

/** Plan mm (x right, y up the page, z up) to scene metres (Y up, plan y toward -Z). */
const toScene = (p: Point3): [number, number, number] => [p.x / 1000, p.z / 1000, -p.y / 1000];

function signed(mm: number, units: UnitSystem) {
  return (mm > 0.5 ? '+' : '') + formatLength(mm, units);
}

const labelClass =
  'pointer-events-none select-none whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium tabular-nums shadow-sm';

const STATE_PILL: Partial<Record<MeasureState, string>> = {
  matches: 'border-green-600 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100',
  differs: 'border-red-600 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100',
  changed: 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
};
const STATE_MARK: Partial<Record<MeasureState, string>> = { matches: '✓ ', differs: '✕ ', changed: '↻ ' };
const ACTIVE = '#1d4ed8';

function Dimensions({
  lengths,
  levels,
  units,
  dark,
  states = {},
  active,
  onPick,
}: {
  lengths: LengthDimension[];
  levels: LevelMark[];
  units: UnitSystem;
  dark: boolean;
  states?: Record<string, MeasureState>;
  active: string | null;
  onPick?: (id: string) => void;
}) {
  /** A label: a button when measurements can be picked, coloured by how it stands. */
  const label = (id: string, children: React.ReactNode, extra = '') => {
    const st = states[id];
    const cls = cn(
      labelClass,
      (st && STATE_PILL[st]) || pill,
      id === active && 'ring-2 ring-blue-700 ring-offset-1',
      onPick && 'pointer-events-auto cursor-pointer hover:border-blue-700',
      extra,
    );
    const body = (
      <>
        {st && STATE_MARK[st]}
        {children}
      </>
    );
    return onPick ? (
      <button type="button" className={cls} onClick={() => onPick(id)} title="Check this against the plans">
        {body}
      </button>
    ) : (
      <div className={cls}>{body}</div>
    );
  };
  const ink = dark ? '#e7e5e4' : '#1c1917';
  const faint = dark ? '#78716c' : '#a8a29e';
  const pill = dark ? 'border-stone-600 bg-stone-900/90 text-stone-100' : 'border-stone-300 bg-white/95 text-stone-900';
  const top = levels.at(-1);
  const bottom = levels[0];
  // Labels are DOM overlays; mounting them a frame after the canvas avoids
  // drei's Html dropping the first one under React's strict double mount.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!ready) return null;
  return (
    <group>
      {lengths.map((d) => {
        const a = toScene(d.a);
        const b = toScene(d.b);
        const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        return (
          <group key={d.id}>
            <Line points={[toScene(d.from[0]), a]} color={faint} lineWidth={1} />
            <Line points={[toScene(d.from[1]), b]} color={faint} lineWidth={1} />
            <Line points={[a, b]} color={d.id === active ? ACTIVE : ink} lineWidth={d.id === active ? 3 : 1.5} />
            <Tick at={a} color={d.id === active ? ACTIVE : ink} />
            <Tick at={b} color={d.id === active ? ACTIVE : ink} />
            <Html position={mid} center zIndexRange={[20, 0]}>
              {label(d.id, formatLength(d.mm, units))}
            </Html>
          </group>
        );
      })}
      {top && bottom && top !== bottom && <Line points={[toScene(bottom.at), toScene(top.at)]} color={ink} lineWidth={1.5} />}
      {levels.map((l) => {
        const p = toScene(l.at);
        return (
          <group key={l.id}>
            <Line points={[[p[0] - 0.25, p[1], p[2]], [p[0] + 0.6, p[1], p[2]]]} color={ink} lineWidth={2} />
            <Html position={p} zIndexRange={[20, 0]}>
              {l.id === 'grade' ? (
                <div className={cn(labelClass, pill, '-translate-x-[calc(100%+0.75rem)] -translate-y-1/2')}>
                  {l.name} <span className="opacity-70">{signed(l.elevation, units)}</span>
                </div>
              ) : (
                label(
                  `level:${l.id}`,
                  <>
                    {l.name} <span className="opacity-70">{signed(l.elevation, units)}</span>
                  </>,
                  'block -translate-x-[calc(100%+0.75rem)] -translate-y-1/2',
                )
              )}
            </Html>
          </group>
        );
      })}
    </group>
  );
}

/** A small mark across each end of a dimension line, like on a drawing. */
function Tick({ at, color }: { at: [number, number, number]; color: string }) {
  const r = 0.15;
  return <Line points={[[at[0], at[1] - r, at[2]], [at[0], at[1] + r, at[2]]]} color={color} lineWidth={2} />;
}

/** Which way the camera looks from, and which way is up on screen, for each flat view (scene axes). */
const VIEW_AXES: Record<SheetView, { from: [number, number, number]; up: [number, number, number] }> = {
  top: { from: [0, 1, 0], up: [0, 0, -1] },
  front: { from: [0, 0, 1], up: [0, 1, 0] },
  back: { from: [0, 0, -1], up: [0, 1, 0] },
  left: { from: [-1, 0, 0], up: [0, 1, 0] },
  right: { from: [1, 0, 0], up: [0, 1, 0] },
};

/** Turns a plane facing +Z so it faces the camera of each view, with the sheet's right going the right way. */
const SHEET_ROTATION: Record<SheetView, [number, number, number]> = {
  top: [-Math.PI / 2, 0, 0],
  front: [0, 0, 0],
  back: [0, Math.PI, 0],
  left: [0, -Math.PI / 2, 0],
  right: [0, Math.PI / 2, 0],
};

const fromScene = (v: THREE.Vector3): Point3 => ({ x: v.x * 1000, y: -v.z * 1000, z: v.y * 1000 });

/** The plan's lines, drawn over the model so differences show. In move or align mode, it takes the clicks. */
function PlanSheet({ backdrop }: { backdrop: Backdrop }) {
  const start = useRef<Point3 | null>(null);
  const axis = VIEW_AXES[backdrop.view].from;
  // Where the pointer's ray meets the sheet's plane (works off the sheet's edges too).
  const hitPlane = (e: ThreeEvent<PointerEvent>) => {
    const c = toScene(backdrop.center);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...axis), new THREE.Vector3(...c));
    const out = new THREE.Vector3();
    return e.ray.intersectPlane(plane, out) ? fromScene(out) : null;
  };
  const active = backdrop.mode === 'move' || backdrop.mode === 'align';
  const m = backdrop.marker;
  return (
    <>
      {active && (
        // A large invisible catcher in the sheet's plane, so clicks and drags land anywhere.
        <mesh
          position={toScene(backdrop.center)}
          rotation={SHEET_ROTATION[backdrop.view]}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            const p = hitPlane(e);
            if (!p) return;
            if (backdrop.mode === 'align') backdrop.onPick?.(p);
            else {
              start.current = p;
              (e.target as Element).setPointerCapture?.(e.pointerId);
            }
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            const p = hitPlane(e);
            if (p) backdrop.onDrag?.({ x: p.x - start.current.x, y: p.y - start.current.y, z: p.z - start.current.z }, false);
          }}
          onPointerUp={(e) => {
            if (!start.current) return;
            const p = hitPlane(e);
            const s = start.current;
            start.current = null;
            (e.target as Element).releasePointerCapture?.(e.pointerId);
            backdrop.onDrag?.(p ? { x: p.x - s.x, y: p.y - s.y, z: p.z - s.z } : { x: 0, y: 0, z: 0 }, true);
          }}
        >
          <planeGeometry args={[1000, 1000]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {m && (
        <mesh position={toScene(m)} rotation={SHEET_ROTATION[backdrop.view]} renderOrder={12}>
          <ringGeometry args={[0.12, 0.2, 32]} />
          <meshBasicMaterial color="#dc2626" depthTest={false} transparent />
        </mesh>
      )}
    <mesh position={toScene(backdrop.center)} rotation={SHEET_ROTATION[backdrop.view]} renderOrder={10}>
      <planeGeometry args={[backdrop.width / 1000, backdrop.height / 1000]} />
      <meshBasicMaterial
        map={backdrop.texture}
        transparent
        opacity={backdrop.opacity}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
    </>
  );
}

/** A flat (orthographic) camera square to the sheet, framing the model; pan and zoom only. */
function CompareCamera({ backdrop }: { backdrop: Backdrop }) {
  const size = useThree((s) => s.size);
  const axes = VIEW_AXES[backdrop.view];
  const target = toScene(backdrop.focus);
  const d = 200;
  const position: [number, number, number] = [target[0] + axes.from[0] * d, target[1] + axes.from[1] * d, target[2] + axes.from[2] * d];
  const span = Math.max(backdrop.span / 1000, 4) * 1.35;
  const zoom = Math.min(size.width, size.height) / span;
  return (
    <>
      <OrthographicCamera makeDefault position={position} up={axes.up} zoom={zoom} near={0.1} far={1000} />
      <OrbitControls
        makeDefault
        enableRotate={false}
        enableDamping
        target={target}
        // While moving or aligning the plan, the left button belongs to the plan; pan with the right.
        mouseButtons={{ LEFT: backdrop.mode === 'move' || backdrop.mode === 'align' ? (-1 as THREE.MOUSE) : THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
    </>
  );
}
