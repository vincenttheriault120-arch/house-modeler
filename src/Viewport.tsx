import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { Edges, GizmoHelper, GizmoViewcube, Grid, Html, Line, OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { Component } from './model/component';
import type { LengthDimension, LevelMark, Point3 } from './model/dimensions';
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
  units?: UnitSystem;
}

/**
 * The 3D view. Scene units are metres. Y is up and grade is at 0. To reset
 * the camera, remount this component.
 */
export function Viewport({ dark = false, components, gridSpacing, selectedId, onSelect, clay = false, dimensions, units = 'imperial' }: Props) {
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

      {dimensions && <Dimensions {...dimensions} units={units} dark={dark} />}

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

      <OrbitControls makeDefault enableDamping target={view.target} />
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

function Dimensions({ lengths, levels, units, dark }: { lengths: LengthDimension[]; levels: LevelMark[]; units: UnitSystem; dark: boolean }) {
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
            <Line points={[a, b]} color={ink} lineWidth={1.5} />
            <Tick at={a} color={ink} />
            <Tick at={b} color={ink} />
            <Html position={mid} center zIndexRange={[20, 0]}>
              <div className={`${labelClass} ${pill}`}>{formatLength(d.mm, units)}</div>
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
              <div className={`${labelClass} ${pill} -translate-x-[calc(100%+0.75rem)] -translate-y-1/2`}>
                {l.name} <span className="opacity-70">{signed(l.elevation, units)}</span>
              </div>
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
