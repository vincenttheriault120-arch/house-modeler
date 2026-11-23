import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { describeMeasures, measureFromVectors, pageVectors } from './measure';
import { getPlanData, type PlanMeta } from './store';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Heights measured from the lines of every elevation and section among the plans, as text
 * for Claude. Sheets without at least three written levels are skipped. Never throws: a
 * sheet that can't be measured is simply left out.
 */
export async function measurePlans(plans: PlanMeta[]): Promise<string> {
  const out: string[] = [];
  for (const plan of plans) {
    try {
      const data = await getPlanData(plan.id);
      if (!data) continue;
      // pdf.js takes ownership of the buffer it is given, so hand it a copy.
      const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
      const doc = await task.promise;
      try {
        for (let n = 1; n <= Math.min(doc.numPages, 20); n++) {
          const page = await doc.getPage(n);
          const { texts, segs } = await pageVectors(page, pdfjs.OPS);
          const m = measureFromVectors(texts, segs);
          if (m) out.push(describeMeasures(doc.numPages > 1 ? `${plan.name}, page ${n}` : plan.name, m));
        }
      } finally {
        void task.destroy();
      }
    } catch {
      // Not measurable (scanned image, odd PDF): Claude reads it by eye as before.
    }
  }
  return out.join('\n\n');
}
