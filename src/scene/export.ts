import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { Component } from '../model/component';
import { downloadBlob, safeFilename } from '../download';
import { buildExportScene } from './meshes';

/** Download the model as a .glb file (File > Import > glTF 2.0 in Blender). */
export async function exportGlb(components: Component[], projectName: string) {
  const scene = buildExportScene(components, projectName);
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary: true });
  downloadBlob(new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' }), `${safeFilename(projectName)}.glb`);
}
