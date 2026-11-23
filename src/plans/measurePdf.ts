import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { describeMeasures, measureFromVectors, pageVectors, type SheetMeasures } from './measure';
import { getPlanData, type PlanMeta } from './store';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Heights measured from the lines of every elevation and section among the plans, as text
 * for Claude and as data for the app's own checks. Sheets without at least three written levels are skipped. Never throws: a
 * sheet that can't be measured is simply left out.
 */
export async function measurePlans(plans: PlanMeta[]): Promise<{ text: string; sheets: { title: string; m: SheetMeasures }[] }> {
  const out: string[] = [];
  const sheets: { title: string; m: SheetMeasures }[] = [];
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
          if (!m) continue;
          const title = doc.numPages > 1 ? `${plan.name}, page ${n}` : plan.name;
          out.push(describeMeasures(title, m));
          sheets.push({ title, m });
        }
      } finally {
        void task.destroy();
      }
    } catch {
      // Not measurable (scanned image, odd PDF): Claude reads it by eye as before.
    }
  }
  return { text: out.join('\n\n'), sheets };
}
