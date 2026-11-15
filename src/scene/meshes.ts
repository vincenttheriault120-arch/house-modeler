import * as THREE from 'three';
import type { Component, MaterialId } from '../model/component';

/** Display colours for each material. Real textures come later. */
export const MATERIALS: Record<MaterialId, { name: string; color: string; roughness: number }> = {
  concrete: { name: 'Concrete (wall)', color: '#b9bcbf', roughness: 0.9 },
  'concrete-footing': { name: 'Concrete (footing)', color: '#9a9ea3', roughness: 0.95 },
  slab: { name: 'Concrete (slab)', color: '#cfd2d4', roughness: 0.85 },
  lumber: { name: 'Lumber', color: '#d9b77e', roughness: 0.8 },
  'lumber-treated': { name: 'Treated lumber', color: '#a8a26a', roughness: 0.85 },
  osb: { name: 'OSB / plywood', color: '#c9a66b', roughness: 0.9 },
  steel: { name: 'Steel', color: '#5f6b75', roughness: 0.45 },
};

const materialCache = new Map<MaterialId, THREE.MeshStandardMaterial>();

export function materialFor(id: MaterialId): THREE.MeshStandardMaterial {
  let m = materialCache.get(id);
  if (!m) {
    const def = MATERIALS[id];
    m = new THREE.MeshStandardMaterial({ color: def.color, roughness: def.roughness, metalness: 0 });
    m.name = def.name;
    materialCache.set(id, m);
  }
  return m;
}

/**
 * Prism geometry for a component, in metres, Y up. Plan X maps to scene X
 * and plan Y (up the page) maps to scene -Z.
 */
export function componentGeometry(c: Component): THREE.BufferGeometry {
  const shape = new THREE.Shape(c.outline.map((p) => new THREE.Vector2(p.x / 1000, p.y / 1000)));
  const depth = Math.max((c.top - c.bottom) / 1000, 0.001);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, c.bottom / 1000, 0);
  geo.computeVertexNormals();
  return geo;
}

/** A standalone scene of the given components, for export. */
export function buildExportScene(components: Component[], name: string): THREE.Scene {
  const scene = new THREE.Scene();
  scene.name = name;
  const groups = new Map<string, THREE.Group>();
  for (const c of components) {
    const groupName = c.name.split(' · ')[0];
    let g = groups.get(c.stepId);
    if (!g) {
      g = new THREE.Group();
      g.name = groupName;
      groups.set(c.stepId, g);
      scene.add(g);
    }
    const mesh = new THREE.Mesh(componentGeometry(c), materialFor(c.material));
    mesh.name = c.name;
    mesh.userData = { kind: c.kind, dimensions_mm: Object.fromEntries(c.dims.map((d) => [d.label, Math.round(d.mm)])) };
    g.add(mesh);
  }
  return scene;
}
