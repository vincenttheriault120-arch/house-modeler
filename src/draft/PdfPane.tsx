import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize, Minus, Plus, RotateCw } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Button } from '@/components/ui/button';
import { getPlanData, type PlanMeta } from '../plans/store';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** One plan PDF beside the model: fit to the pane, zoom, scroll, turn. */
export function PdfPane({ plan }: { plan: PlanMeta }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [rotation, setRotation] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [fitTick, setFitTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError(null);
    setPage(1);
    getPlanData(plan.id)
      .then((data) => {
        if (!data) throw new Error('missing');
        return pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
      })
      .then((d) => !cancelled && setDoc(d))
      .catch(() => !cancelled && setError("Couldn't open this PDF."));
    return () => {
      cancelled = true;
    };
  }, [plan.id]);

  useEffect(() => {
    if (!doc || !canvas.current || !box.current) return;
    let task: pdfjs.RenderTask | null = null;
    let cancelled = false;
    doc.getPage(page).then((p) => {
      if (cancelled) return;
      const unit = p.getViewport({ scale: 1, rotation: (p.rotate + rotation) % 360 });
      const el = box.current!;
      const fit = Math.min((el.clientWidth - 16) / unit.width, (el.clientHeight - 16) / unit.height);
      const s = zoom === 'fit' ? fit : fit * zoom;
      setScale(s);
      const dpr = window.devicePixelRatio || 1;
      const vp = p.getViewport({ scale: s * dpr, rotation: (p.rotate + rotation) % 360 });
      const c = canvas.current!;
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      c.style.width = `${vp.width / dpr}px`;
      c.style.height = `${vp.height / dpr}px`;
      task = p.render({ canvas: c, viewport: vp });
      task.promise.catch(() => {});
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, zoom, rotation, fitTick]);

  // Refit when the pane is resized.
  useEffect(() => {
    const el = box.current;
    if (!el || zoom !== 'fit') return;
    const ro = new ResizeObserver(() => setFitTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoom]);

  const z = zoom === 'fit' ? 1 : zoom;
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white dark:bg-stone-200">
      <div className="flex items-center gap-1 border-b bg-background px-2 py-1 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium" title={plan.name}>
          {plan.name}
        </span>
        {doc && doc.numPages > 1 && (
          <>
            <Button variant="ghost" size="icon" className="size-7" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft />
            </Button>
            <span className="tabular-nums">
              {page}/{doc.numPages}
            </span>
            <Button variant="ghost" size="icon" className="size-7" aria-label="Next page" disabled={page >= doc.numPages} onClick={() => setPage(page + 1)}>
              <ChevronRight />
            </Button>
          </>
        )}
        <Button variant="ghost" size="icon" className="size-7" aria-label="Zoom out" onClick={() => setZoom(Math.max(0.5, z / 1.4))}>
          <Minus />
        </Button>
        <span className="w-10 text-center tabular-nums text-muted-foreground">{Math.round(z * 100)}%</span>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Zoom in" onClick={() => setZoom(Math.min(8, z * 1.4))}>
          <Plus />
        </Button>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Fit" onClick={() => setZoom('fit')}>
          <Maximize />
        </Button>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Turn the sheet" onClick={() => setRotation((r) => (r + 90) % 360)}>
          <RotateCw />
        </Button>
      </div>
      <div
        ref={box}
        className="min-h-0 flex-1 overflow-auto"
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          setZoom(Math.min(8, Math.max(0.5, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
        }}
      >
        {error ? (
          <p className="p-4 text-sm text-destructive">{error}</p>
        ) : (
          <div className="grid min-h-full min-w-full place-items-center p-2" data-scale={scale}>
            <canvas ref={canvas} className="shadow-sm" />
          </div>
        )}
      </div>
    </div>
  );
}
