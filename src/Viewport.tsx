import { Canvas } from '@react-three/fiber';
import { GizmoHelper, GizmoViewcube, Grid, OrbitControls } from '@react-three/drei';

interface Props {
  /** Grid cell size in mm. */
  gridSpacing: number;
}

const HOME_CAMERA: [number, number, number] = [14, 11, 16];

/**
 * The 3D view. Scene units are metres (the model's mm values are divided by
 * 1000 when drawn). Y is up. To reset the camera, remount this component.
 */
export function Viewport({ gridSpacing }: Props) {
  const cell = gridSpacing / 1000;

  return (
    <Canvas camera={{ position: HOME_CAMERA, fov: 45, near: 0.05, far: 2000 }} shadows>
      <color attach="background" args={['#eef1f4']} />
      <hemisphereLight args={['#ffffff', '#b8c0c8', 1.2]} />
      <directionalLight position={[10, 20, 8]} intensity={1.5} castShadow />

      <Grid
        args={[200, 200]}
        cellSize={cell}
        sectionSize={cell * 10}
        cellColor="#c3cad3"
        sectionColor="#8e99a6"
        cellThickness={0.6}
        sectionThickness={1.1}
        fadeDistance={120}
        side={2}
        infiniteGrid
      />
      <axesHelper args={[1]} />

      <OrbitControls makeDefault enableDamping target={[0, 0, 0]} />
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewcube />
      </GizmoHelper>
    </Canvas>
  );
}
