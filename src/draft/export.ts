import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { downloadBlob, safeFilename } from '../download';
import { draftMeshes } from './model';
import type { ExteriorDraft } from './types';

/** The clay draft as a .glb (metres, Y up), one named mesh per wall block, roof and opening. */
export async function exportDraftGlb(draft: ExteriorDraft, projectName: string) {
  const scene = new THREE.Scene();
  scene.name = `${projectName} · exterior draft`;
  const mats = {
    wall: new THREE.MeshStandardMaterial({ color: '#f2f0ec', roughness: 1, name: 'Clay walls' }),
    roof: new THREE.MeshStandardMaterial({ color: '#d9d6d0', roughness: 1, name: 'Clay roof' }),
    opening: new THREE.MeshStandardMaterial({ color: '#4b5563', roughness: 0.6, name: 'Openings' }),
    foundation: new THREE.MeshStandardMaterial({ color: '#b8bbc0', roughness: 1, name: 'Foundations' }),
  };
  for (const m of draftMeshes(draft)) {
    const pos = new Float32Array(m.positions.length);
    for (let i = 0; i < m.positions.length; i += 3) {
      pos[i] = m.positions[i] / 1000;
      pos[i + 1] = m.positions[i + 2] / 1000;
      pos[i + 2] = -m.positions[i + 1] / 1000;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mats[m.kind]);
    mesh.name = m.name;
    scene.add(mesh);
  }
  const result = await new GLTFExporter().parseAsync(scene, { binary: true });
  downloadBlob(new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' }), `${safeFilename(projectName)}-exterior.glb`);
}
