import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as THREE from 'three';
import { getPlanData } from './store';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** The colour plan lines take when laid over the model. */
export const PLAN_LINE_COLOR: [number, number, number] = [29, 78, 216];

/**
 * Turn a white sheet into coloured lines on a clear background: darker ink
 * becomes more opaque, white paper disappears, so the model shows through.
 */
export function inkToAlpha(data: Uint8ClampedArray, color = PLAN_LINE_COLOR) {
  for (let i = 0; i < data.length; i += 4) {
    const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    const ink = Math.min(1, (1 - lum) * 1.6);
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = Math.round(ink * 255);
  }
}

/** One page of a plan as a texture of its lines, plus the page size in PDF units. */
export async function loadPlanTexture(planId: string, pageNumber: number) {
  const data = await getPlanData(planId);
  if (!data) throw new Error('This plan is no longer stored with the project.');
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(pageNumber);
    const unit = page.getViewport({ scale: 1 });
    const scale = Math.min(4096 / Math.max(unit.width, unit.height), 5);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, viewport }).promise;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    inkToAlpha(img.data);
    ctx.putImageData(img, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return { texture, width: unit.width, height: unit.height };
  } finally {
    task.destroy();
  }
}
