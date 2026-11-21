import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Minus, Plus, Ruler, X } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { anchorHint, viewForKind, type PagePoint } from '../model/calibration';
import { formatLength, parseLength, type UnitSystem } from '../units';
import { getPlanData, type PlanMeta } from './store';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Step = 'a' | 'b' | 'length';

/** Full-size view of one plan PDF, over the 3D area, where its scale can be set. */
export function PlanViewer({
  plan,
  units,
  onClose,
  onCalibrate,
}: {
  plan: PlanMeta;
  units: UnitSystem;
  onClose: () => void;
  onCalibrate: (meta: PlanMeta) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(plan.calibration?.page ?? 1);
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [a, setA] = useState<PagePoint | null>(null);
  const [b, setB] = useState<PagePoint | null>(null);
  const [length, setLength] = useState('');
  const [lengthError, setLengthError] = useState(false);
  const view = viewForKind(plan.kind);
  const cal = plan.calibration;
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
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
      const unit = p.getViewport({ scale: 1 });
      setPageSize({ w: unit.width, h: unit.height });
      const viewport = p.getViewport({ scale: 1.6 * zoom * (window.devicePixelRatio || 1) });
      const c = canvas.current!;
      c.width = viewport.width;
      c.height = viewport.height;
      c.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
      task = p.render({ canvas: c, viewport });
    });
    return () => task?.cancel();
  }, [doc, page, zoom]);

  function startCalibration() {
    setStep('a');
    setA(null);
    setB(null);
    setLength('');
  }

  function pick(e: React.MouseEvent<HTMLDivElement>) {
    if (!step || step === 'length') return;
    const r = e.currentTarget.getBoundingClientRect();
    const pt = { x: (e.clientX - r.left) / (1.6 * zoom), y: (e.clientY - r.top) / (1.6 * zoom) };
    if (step === 'a') {
      setA(pt);
      setStep('b');
    } else {
      setB(pt);
      setStep('length');
    }
  }

  function save() {
    const mm = parseLength(length, units);
    if (!a || !b || mm === null || mm <= 0) {
      setLengthError(true);
      return;
    }
    onCalibrate({ ...plan, calibration: { page, a, b, mm } });
    setStep(null);
  }

  // Points to draw: the ones being picked, else the saved calibration on its page.
  const shownA = step ? a : cal && cal.page === page ? cal.a : null;
  const shownB = step ? b : cal && cal.page === page ? cal.b : null;

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="truncate text-sm font-medium">{plan.name}</span>
        {cal && !step && (
          <span className="flex items-center gap-1 text-xs text-success">
            <Check className="size-3.5" /> Scale set ({formatLength(cal.mm, units)})
          </span>
        )}
        <div className="flex-1" />
        {view && !step && (
          <Button variant="outline" size="sm" onClick={startCalibration}>
            <Ruler /> {cal ? 'Set scale again' : 'Set scale'}
          </Button>
        )}
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
      {step && view && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-accent px-3 py-2 text-sm" role="status">
          <span className="font-medium">
            {step === 'a' && `1. ${anchorHint(view)}`}
            {step === 'b' && '2. Click the other end of a dimension you trust, measured from that point (a width, or a height on an elevation).'}
            {step === 'length' && '3. Type that dimension, as written on the plan.'}
          </span>
          {step === 'length' && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <Input
                autoFocus
                aria-label="Length between the two points"
                aria-invalid={lengthError}
                placeholder={units === 'imperial' ? `38' 2"` : '11633 mm'}
                className="h-8 w-36 bg-background"
                value={length}
                onChange={(e) => {
                  setLength(e.target.value);
                  setLengthError(false);
                }}
              />
              <Button size="sm" type="submit">
                Save scale
              </Button>
            </form>
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => setStep(null)}>
            Cancel
          </Button>
        </div>
      )}
      <div className="flex-1 overflow-auto bg-muted/50 p-4">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div className={`relative mx-auto w-fit ${step === 'a' || step === 'b' ? 'cursor-crosshair' : ''}`} onClick={pick}>
            <canvas ref={canvas} className="block bg-white shadow" />
            {pageSize && (shownA || shownB) && (
              <svg
                className="pointer-events-none absolute inset-0 size-full"
                viewBox={`0 0 ${pageSize.w} ${pageSize.h}`}
                aria-hidden="true"
              >
                {shownA && shownB && (
                  <line x1={shownA.x} y1={shownA.y} x2={shownB.x} y2={shownB.y} stroke="#1d4ed8" strokeWidth={2 / zoom} />
                )}
                {[shownA, shownB].map(
                  (p, i) =>
                    p && (
                      <g key={i}>
                        <circle cx={p.x} cy={p.y} r={6 / zoom} fill="white" stroke="#1d4ed8" strokeWidth={2 / zoom} />
                        <text x={p.x + 9 / zoom} y={p.y - 9 / zoom} fontSize={12 / zoom} fontWeight={600} fill="#1d4ed8">
                          {i === 0 ? 'A' : 'B'}
                        </text>
                      </g>
                    ),
                )}
              </svg>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
