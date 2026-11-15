import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus, X } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Button } from '@/components/ui/button';
import { getPlanData, type PlanMeta } from './store';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Full-size view of one plan PDF, over the 3D area. */
export function PlanViewer({ plan, onClose }: { plan: PlanMeta; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
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
    if (!doc || !canvas.current) return;
    let task: pdfjs.RenderTask | null = null;
    doc.getPage(page).then((p) => {
      const viewport = p.getViewport({ scale: 1.6 * zoom * (window.devicePixelRatio || 1) });
      const c = canvas.current!;
      c.width = viewport.width;
      c.height = viewport.height;
      c.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
      task = p.render({ canvas: c, viewport });
    });
    return () => task?.cancel();
  }, [doc, page, zoom]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="truncate text-sm font-medium">{plan.name}</span>
        <div className="flex-1" />
        {doc && doc.numPages > 1 && (
          <>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft />
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {page} / {doc.numPages}
            </span>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Next page" disabled={page >= doc.numPages} onClick={() => setPage(page + 1)}>
              <ChevronRight />
            </Button>
          </>
        )}
        <Button variant="ghost" size="icon" className="size-8" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}>
          <Minus />
        </Button>
        <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z * 1.25))}>
          <Plus />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Close plan" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="flex-1 overflow-auto bg-muted/50 p-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : <canvas ref={canvas} className="mx-auto bg-white shadow" />}
      </div>
    </div>
  );
}
