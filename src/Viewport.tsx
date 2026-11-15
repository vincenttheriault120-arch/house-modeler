import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { Edges, GizmoHelper, GizmoViewcube, Grid, OrbitControls } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import type { Component } from './model/component';
import { componentGeometry, materialFor } from './scene/meshes';

interface Props {
  components: Component[];
  /** Grid cell size in mm. */
  gridSpacing: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * The 3D view. Scene units are metres. Y is up and grade is at 0. To reset
 * the camera, remount this component.
 */
export function Viewport({ components, gridSpacing, selectedId, onSelect }: Props) {
  const cell = gridSpacing / 1000;
  const view = useMemo(() => homeView(components), [components.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Canvas
      camera={{ position: view.camera, fov: 45, near: 0.05, far: 2000 }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={['#eef1f4']} />
      <hemisphereLight args={['#ffffff', '#b8c0c8', 1.3]} />
      <directionalLight position={[10, 20, 8]} intensity={1.6} />
      <directionalLight position={[-12, 8, -10]} intensity={0.5} />

      {components.map((c) => (
        <ComponentMesh
          key={c.id + JSON.stringify(c.outline) + c.bottom + c.top}
          component={c}
          selected={c.id === selectedId}
          onSelect={onSelect}
        />
      ))}

      <Grid
        args={[200, 200]}
        cellSize={cell}
        sectionSize={cell * 10}
        cellColor="#c3cad3"
        sectionColor="#8e99a6"
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
}: {
  component: Component;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const geometry = useMemo(() => componentGeometry(component), [component]);
  const material = useMemo(() => {
    if (!selected) return materialFor(component.material);
    const m = materialFor(component.material).clone();
    m.color.set('#f2a93b');
    return m;
  }, [component.material, selected]);

  return (
    <mesh
      geometry={geometry}
      material={material}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect(component.id);
      }}
    >
      <Edges threshold={20} color={selected ? '#b06a00' : '#6b7178'} />
    </mesh>
  );
}

/** Camera position looking at the model's middle from the front-right. */
function homeView(components: Component[]) {
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
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const d = Math.max(size * 1.5, 8);
  return {
    camera: [center.x + d * 0.6, center.y + d * 0.55, center.z + d * 0.75] as [number, number, number],
    target: [center.x, center.y, center.z] as [number, number, number],
  };
}
