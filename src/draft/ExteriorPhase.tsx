import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Check, ChevronDown, ChevronRight, ClipboardCheck, FileText, Loader2, Plus, RefreshCw, Sparkles, SquareSplitHorizontal, Trash2, Undo2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { LengthInput } from '../LengthInput';
import { explainError } from '../chat/claude';
import { loadApiKey, saveApiKey } from '../chat/apiKey';
import type { Project } from '../model/types';
import { PlansSection } from '../plans/PlansSection';
import { PLAN_KINDS, type PlanMeta } from '../plans/store';
import { formatLength, type UnitSystem } from '../units';
import { DraftViewport, sourceClass, type ModelView } from './DraftViewport';
import { draftFromSteps } from './fromSteps';
import { generateDraft, type DraftStage } from './generate';
import { PdfPane } from './PdfPane';
import { parseAnswerSheet, scoreDraft, type AnswerSheet, type Score, type Verdict } from './score';
import { confirmView, faceFrame, measures as allMeasures, measuresFor, progress, removePart, setDim, viewProgress, type Measure } from './model';
import { dim, VIEWS, type ExteriorDraft, type Face, type OpeningKind, type PlanConflict, type ViewId } from './types';

interface PlansApi {
  plans: PlanMeta[];
  error: string | null;
  labeling: Set<string>;
  add: (files: FileList | File[]) => Promise<void>;
  update: (meta: PlanMeta) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

interface Props {
  project: Project;
  plans: PlansApi;
  units: UnitSystem;
  dark: boolean;
  onDraft: (draft: ExteriorDraft | undefined) => void;
  /** Draft as soon as the plans are in (a project just created from plans). */
  autoDraft?: boolean;
}

/** The plan sheet that matches a view, if one was added. */
export function planForView(plans: PlanMeta[], view: ViewId): PlanMeta | undefined {
  const kinds = VIEWS.find((v) => v.id === view)?.plan ?? [];
  return plans.find((p) => kinds.includes(p.kind)) ?? plans.find((p) => p.contains?.some((k) => kinds.includes(k)));
}

/**
 * Phase 1: the whole exterior drafted at once from the plans, in white clay
 * with every measurement on it, then checked one drawing at a time.
 */
export function ExteriorPhase({ project, plans, units, dark, onDraft, autoDraft }: Props) {
  const draft = project.exterior;
  const [view, setView] = useState<ModelView>('3d');
  const [beside, setBeside] = useState(true);
  const [planId, setPlanId] = useState<string | null>(null);
  const [activePart, setActivePart] = useState<string | null>(null);
  const [activeMeasure, setActiveMeasure] = useState<string | null>(null);
  const [hoverMeasure, setHoverMeasure] = useState<string | null>(null);
  const [plansOpen, setPlansOpen] = useState(!draft);
  const [gen, setGen] = useState<{ started: number; chars: number; stage?: DraftStage } | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [undo, setUndo] = useState<ExteriorDraft | null>(null);
  const abort = useRef<AbortController | null>(null);
  const planInput = useRef<HTMLInputElement>(null);
  const [, tick] = useState(0);
  const [answerSheet, setAnswerSheet] = useState<AnswerSheet | null>(() => loadAnswerSheet(project.name));
  const [scoreOpen, setScoreOpen] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const sheetInput = useRef<HTMLInputElement>(null);
  const score = useMemo(
    () => (draft && answerSheet ? scoreDraft(draft, answerSheet, (mm) => formatLength(mm, units)) : null),
    [draft, answerSheet, units],
  );

  async function pickAnswerSheet(file: File | undefined) {
    if (!file) return;
    try {
      const s = parseAnswerSheet(await file.text());
      saveAnswerSheet(project.name, s);
      setAnswerSheet(s);
      setScoreError(null);
      setScoreOpen(true);
    } catch (e) {
      setScoreError(e instanceof Error ? e.message : String(e));
      setScoreOpen(true);
    }
  }

  // Show the elapsed time while Claude drafts.
  useEffect(() => {
    if (!gen) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [gen]);

  async function runDraft() {
    const key = loadApiKey();
    if (!key || plans.plans.length === 0) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setGenError(null);
    setGen({ started: Date.now(), chars: 0 });
    try {
      const d = await generateDraft({
        apiKey: key,
        plans: plans.plans,
        units,
        signal: ctl.signal,
        onProgress: (chars, stage) => setGen((g) => (g ? { ...g, chars, stage } : g)),
      });
      if (draft) setUndo(draft);
      onDraft(d);
      setPlansOpen(false);
      setView('3d');
      if (answerSheet) setScoreOpen(true);
    } catch (e) {
      if (!ctl.signal.aborted) setGenError(explainError(e));
    } finally {
      if (abort.current === ctl) setGen(null);
    }
  }

  // A project just made from plans drafts itself once the PDFs are in.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoDraft || autoStarted.current || draft || gen) return;
    if (plans.plans.length === 0 || plans.labeling.size > 0 || !loadApiKey()) return;
    autoStarted.current = true;
    runDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDraft, plans.plans.length, plans.labeling.size]);

  useEffect(() => () => abort.current?.abort(), []);

  const ms = useMemo(() => (draft ? (view === '3d' ? allMeasures(draft) : measuresFor(draft, view)) : []), [draft, view]);
  const sheet =
    view === '3d' ? undefined : (plans.plans.find((p) => p.id === planId) ?? planForView(plans.plans, view) ?? plans.plans[0]);

  function pickView(v: ModelView) {
    setView(v);
    setPlanId(null);
    setActiveMeasure(null);
    setActivePart(null);
  }

  return (
    <div
      className={cn(
        'grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[16rem_1fr] md:grid-rows-[minmax(0,1fr)]',
        draft && 'xl:grid-cols-[16rem_1fr_21rem]',
      )}
    >
      {/* Left: three plain steps */}
      <aside className="grid min-w-0 content-start gap-1 overflow-x-hidden overflow-y-auto border-b bg-background p-3 md:border-r md:border-b-0 [&>*]:min-w-0" aria-label="Steps">
        <StepRow n={1} title="Plans" done={plans.plans.length > 0} meta={plans.plans.length ? `${plans.plans.length} sheets` : undefined} open={plansOpen} onClick={() => setPlansOpen((o) => !o)} />
        {plansOpen && (
          <div className="mb-2 ml-2 min-w-0">
            <PlansSection
              inputRef={planInput}
              plans={plans.plans}
              error={plans.error}
              labeling={plans.labeling}
              hasKey={!!loadApiKey()}
              onAdd={(f) => plans.add(f)}
              onUpdate={plans.update}
              onRemove={plans.remove}
              onView={(p) => {
                setPlanId(p.id);
                if (view === '3d') setView('front');
                setBeside(true);
              }}
            />
          </div>
        )}
        <StepRow
          n={2}
          title="Draft the exterior"
          done={!!draft}
          busy={!!gen}
          meta={draft ? `${draft.blocks.length} volumes · ${draft.openings.length} openings` : undefined}
          active={view === '3d' && !!draft}
          onClick={() => pickView('3d')}
        />
        <StepRow n={3} title="Check each drawing" done={!!draft && progress(draft).views === VIEWS.length} />
        {draft && (
          <ol className="ml-8 grid gap-0.5">
            {VIEWS.map((v) => {
              const p = viewProgress(draft, v.id);
              const has = !!planForView(plans.plans, v.id);
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => pickView(v.id)}
                    aria-current={view === v.id ? 'step' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                      view === v.id && 'bg-accent font-medium',
                    )}
                  >
                    {p.done ? <Check className="size-4 shrink-0 text-success" /> : <span className="size-4 shrink-0 rounded-full border" />}
                    <span className={cn('min-w-0 flex-1 truncate', !has && 'text-muted-foreground')}>{v.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {p.ok}/{p.total}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {draft && (
          <div className="mt-4 grid gap-1.5 rounded-md bg-muted/60 p-2.5 text-xs">
            <span className="flex items-center gap-2">
              <span className="font-semibold tabular-nums">12&apos;&nbsp;0&quot;</span> From your plans
            </span>
            <span className="flex items-center gap-2">
              <span className={cn('font-semibold tabular-nums', sourceClass('ai', dark))}>12&apos;&nbsp;0&quot;</span> Inferred by Claude: check it
            </span>
            <span className="flex items-center gap-2">
              <span className="font-semibold text-green-600">✓</span> Checked by you
            </span>
          </div>
        )}
      </aside>

      {/* Centre: the model, and the plan beside it */}
      <main className="relative flex min-h-[70vh] min-w-0 flex-col bg-viewport md:min-h-0">
        {!draft ? (
          <DraftStart
            project={project}
            plans={plans.plans}
            labeling={plans.labeling.size > 0}
            gen={gen}
            error={genError}
            onDraft={runDraft}
            onCancel={() => {
              abort.current?.abort();
              setGen(null);
            }}
            onAddPlans={() => {
              setPlansOpen(true);
              planInput.current?.click();
            }}
            onFromFootprint={() => onDraft(draftFromSteps(project))}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5 border-b bg-background px-3 py-1.5">
              <div role="tablist" aria-label="View" className="flex flex-wrap gap-1">
                <ViewTab on={view === '3d'} onClick={() => pickView('3d')}>
                  <Box className="size-3.5" /> 3D
                </ViewTab>
                {VIEWS.map((v) => (
                  <ViewTab key={v.id} on={view === v.id} onClick={() => pickView(v.id)}>
                    {v.name.replace(' elevation', '').replace(' plan', '').replace('Roof (top view)', 'Roof')}
                  </ViewTab>
                ))}
              </div>
              <div className="flex-1" />
              <input
                ref={sheetInput}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => (pickAnswerSheet(e.target.files?.[0]), (e.target.value = ''))}
              />
              <Button
                size="sm"
                variant={scoreOpen ? 'default' : 'ghost'}
                aria-pressed={scoreOpen}
                title="Compare this draft with an answer sheet of values confirmed from your plans"
                onClick={() => (answerSheet || scoreOpen ? setScoreOpen((o) => !o) : sheetInput.current?.click())}
              >
                <ClipboardCheck /> Score{score && ` ${score.counts.right}/${score.rows.length}`}
              </Button>
              {view !== '3d' && (
                <Button size="sm" variant={beside ? 'default' : 'outline'} aria-pressed={beside} onClick={() => setBeside((b) => !b)}>
                  <SquareSplitHorizontal /> Plan beside
                </Button>
              )}
              {gen ? (
                <span className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Redrafting… {Math.round((Date.now() - gen.started) / 1000)}s
                </span>
              ) : undo ? (
                <Button size="sm" variant="outline" onClick={() => (onDraft(undo), setUndo(null))}>
                  <Undo2 /> Undo redraft
                </Button>
              ) : (
                plans.plans.length > 0 &&
                loadApiKey() && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => window.confirm('Draft the whole exterior again from your plans? Your checks and changes are replaced (you can undo).') && runDraft()}
                  >
                    <RefreshCw /> Redraft
                  </Button>
                )
              )}
            </div>
            {genError && <p className="border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{genError}</p>}
            <div className={cn('grid min-h-0 flex-1', view !== '3d' && beside && 'lg:grid-cols-2')}>
              <div className="relative min-h-[50vh] min-w-0 lg:min-h-0">
                <DraftViewport
                  draft={draft}
                  view={view}
                  measures={ms}
                  units={units}
                  dark={dark}
                  activePart={activePart}
                  activeMeasure={activeMeasure}
                  hoverMeasure={hoverMeasure}
                  onHoverMeasure={setHoverMeasure}
                  onPickPart={(p) => {
                    setActivePart(p);
                    setActiveMeasure(null);
                  }}
                  onPickMeasure={(id) => {
                    setActiveMeasure(id);
                    setActivePart(ms.find((m) => m.id === id)?.part ?? null);
                  }}
                />
                {scoreOpen && (
                  <ScorePanel
                    score={score}
                    error={scoreError}
                    onLoad={() => sheetInput.current?.click()}
                    onForget={() => {
                      saveAnswerSheet(project.name, null);
                      setAnswerSheet(null);
                      setScoreOpen(false);
                    }}
                    onClose={() => setScoreOpen(false)}
                  />
                )}
                <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-background/85 px-2 py-0.5 text-xs text-muted-foreground shadow-sm">
                  {view === '3d'
                    ? activePart
                      ? 'Drag: rotate · Right-drag: pan · Scroll: zoom · Click empty space to clear'
                      : 'Click a part to see its measurements · Drag: rotate · Right-drag: pan · Scroll: zoom'
                    : 'Drag: pan · Scroll: zoom · Click a number to check it'}
                </span>
              </div>
              {view !== '3d' && beside && (
                <div className="flex min-h-[50vh] min-w-0 flex-col border-t lg:min-h-0 lg:border-t-0 lg:border-l">
                  {plans.plans.length > 0 && (
                    <div className="flex items-center gap-2 border-b bg-background px-2 py-1">
                      <FileText className="size-3.5 text-muted-foreground" />
                      <select
                        aria-label="Plan shown beside the model"
                        className="h-7 min-w-0 flex-1 rounded border bg-background px-1 text-xs"
                        value={sheet?.id ?? ''}
                        onChange={(e) => setPlanId(e.target.value)}
                      >
                        {plans.plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({PLAN_KINDS.find((k) => k.value === p.kind)?.label})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {sheet ? (
                    <div className="min-h-0 flex-1">
                      <PdfPane plan={sheet} />
                    </div>
                  ) : (
                    <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
                      No plan matches this view yet. Add it under Plans, on the left.
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* Right: the measurements of this view, to confirm or correct */}
      {draft && (
        <CheckPanel
          draft={draft}
          view={view}
          measures={ms}
          units={units}
          dark={dark}
          activePart={activePart}
          activeMeasure={activeMeasure}
          hoverMeasure={hoverMeasure}
          onHover={setHoverMeasure}
          onPick={(id, part) => {
            setActiveMeasure(id);
            setActivePart(part);
          }}
          onChange={(d) => {
            setUndo(null);
            onDraft(d);
          }}
        />
      )}
    </div>
  );
}

function StepRow(props: { n: number; title: string; done: boolean; busy?: boolean; meta?: string; open?: boolean; active?: boolean; onClick?: () => void }) {
  const Chevron = props.open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={!props.onClick}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2 py-2 text-left enabled:hover:bg-accent disabled:cursor-default',
        props.active && 'bg-accent',
      )}
    >
      <span
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
          props.done ? 'bg-success text-white' : 'bg-primary text-primary-foreground',
        )}
      >
        {props.busy ? <Loader2 className="size-3.5 animate-spin" /> : props.done ? <Check className="size-3.5" /> : props.n}
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="text-sm font-medium">{props.title}</span>
        {props.meta && <span className="truncate text-xs text-muted-foreground">{props.meta}</span>}
      </span>
      {props.open !== undefined && <Chevron className="size-4 text-muted-foreground" />}
    </button>
  );
}

function ViewTab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={cn(
        'flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors',
        on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

/** Before there is a draft: one button, and what it needs. */
function DraftStart(props: {
  project: Project;
  plans: PlanMeta[];
  labeling: boolean;
  gen: { started: number; chars: number; stage?: DraftStage } | null;
  error: string | null;
  onDraft: () => void;
  onCancel: () => void;
  onAddPlans: () => void;
  onFromFootprint: () => void;
}) {
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(!!loadApiKey());
  const secs = props.gen ? Math.round((Date.now() - props.gen.started) / 1000) : 0;
  return (
    <div className="grid flex-1 place-items-center overflow-y-auto p-6">
      <div className="grid w-full max-w-lg gap-4 rounded-xl border bg-background p-6 shadow-sm">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Draft the whole exterior</h2>
          <p className="text-sm text-muted-foreground">
            Claude reads all your plans at once and builds the outside of the house in white clay: every wall, roof, door and window,
            with its measurements written on it. Numbers from your plans are in black; numbers Claude had to work out are in{' '}
            <span className="font-medium text-red-600">red</span>. You then check them one drawing at a time.
          </p>
        </div>
        {props.gen ? (
          <div className="grid gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin text-primary" />
              {props.gen.stage === 'check'
                ? 'Claude is double-checking its draft against the drawings…'
                : props.gen.stage === 'draft'
                  ? 'Claude is drafting each part and checking it on every sheet…'
                  : `Claude is taking stock of ${props.plans.length} sheets and every part of the house…`} {secs}s
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full animate-pulse rounded-full bg-primary transition-all" style={{ width: `${Math.min(95, 8 + secs / 1.8)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">This usually takes two to five minutes. You can leave this page open and come back.</p>
            <Button variant="outline" size="sm" className="justify-self-start" onClick={props.onCancel}>
              Stop
            </Button>
          </div>
        ) : (
          <>
            {props.plans.length === 0 ? (
              <div className="grid gap-2">
                <Button onClick={props.onAddPlans}>
                  <Plus /> Add your plan PDFs
                </Button>
                <p className="text-xs text-muted-foreground">Floor plans, the four elevations and the roof plan give the most complete draft.</p>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm">
                <Check className="size-4 text-success" /> {props.plans.length} plan sheets ready
                {props.labeling && <span className="text-muted-foreground">(Claude is labeling them…)</span>}
              </p>
            )}
            {!hasKey && (
              <form
                className="grid gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!key.trim()) return;
                  saveApiKey(key.trim());
                  setHasKey(true);
                }}
              >
                <label className="text-sm font-medium" htmlFor="draft-key">
                  Your Anthropic API key
                </label>
                <div className="flex gap-2">
                  <Input id="draft-key" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
                  <Button type="submit" variant="outline">
                    Save
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground">Stays in this browser only. Create one at console.anthropic.com.</span>
              </form>
            )}
            <Button size="lg" disabled={!hasKey || props.plans.length === 0} onClick={props.onDraft}>
              <Sparkles /> Draft the exterior from my plans
            </Button>
            {props.error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{props.error}</p>}
            {props.project.start === 'scratch' && (
              <button type="button" className="justify-self-start text-sm text-primary underline-offset-2 hover:underline" onClick={props.onFromFootprint}>
                No plans? Start from the footprint you entered →
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The measurements of one view, grouped by part: confirm each, or type the plan's value. */
function CheckPanel({
  draft,
  view,
  measures,
  units,
  dark,
  activePart,
  activeMeasure,
  hoverMeasure,
  onHover,
  onPick,
  onChange,
}: {
  draft: ExteriorDraft;
  view: ModelView;
  measures: Measure[];
  units: UnitSystem;
  dark: boolean;
  activePart: string | null;
  activeMeasure: string | null;
  hoverMeasure: string | null;
  onHover: (id: string | null) => void;
  onPick: (id: string | null, part: string | null) => void;
  onChange: (d: ExteriorDraft) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => {
    const g = new Map<string, { name: string; items: Measure[] }>();
    for (const m of measures) {
      if (!g.has(m.part)) g.set(m.part, { name: m.partName, items: [] });
      g.get(m.part)!.items.push(m);
    }
    return [...g.entries()];
  }, [measures]);

  useEffect(() => {
    const key = activeMeasure ?? activePart;
    if (!key) return;
    listRef.current?.querySelector(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeMeasure, activePart]);

  const p = view === '3d' ? null : viewProgress(draft, view);
  const all = progress(draft);
  const viewName = view === '3d' ? 'The whole draft' : VIEWS.find((v) => v.id === view)!.name;
  // In 3D, the picked part (and its roof, drawn with it) only.
  const shownGroups = view === '3d' && activePart ? groups.filter(([part]) => part === activePart || part === `${activePart}:roof`) : groups;

  return (
    <aside className="col-span-full flex min-h-0 flex-col border-t bg-background xl:col-span-1 xl:border-t-0 xl:border-l" aria-label="Measurements">
      <div className="grid max-h-[45vh] shrink-0 gap-2 overflow-y-auto border-b p-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">{viewName}</h2>
          {p?.done && <Badge className="bg-success text-white">Checked</Badge>}
        </div>
        {view === '3d' ? (
          <>
            <p className="text-xs text-muted-foreground">
              {all.ok} of {all.total} measurements checked · <span className="text-red-600">{all.ai} inferred</span>. Pick a drawing on the left to check it
              against your plan.
            </p>
            {draft.summary && <DraftSummary summary={draft.summary} />}
            {draft.conflicts && draft.conflicts.length > 0 && <PlansDisagree conflicts={draft.conflicts} />}
          </>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Compare each number with the plan beside the model. Press ✓ when it matches, or type the plan&apos;s value.
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`${p!.ok} of ${p!.total} checked`}>
              <div className="h-full rounded-full bg-success transition-all" style={{ width: `${p!.total ? (100 * p!.ok) / p!.total : 0}%` }} />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {p!.ok} of {p!.total} checked{p!.ai > 0 && <span className="text-red-600"> · {p!.ai} inferred left</span>}
            </span>
          </>
        )}
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {shownGroups.length === 0 && view !== '3d' && <p className="p-2 text-sm text-muted-foreground">Nothing in the draft shows in this view.</p>}
        {view === '3d' && !activePart && (
          <p className="px-2 pb-2 text-xs text-muted-foreground">Click a part of the model to see only its measurements.</p>
        )}
        {shownGroups.map(([part, g]) => (
          <section
            key={part}
            data-key={part}
            className={cn('mb-2 rounded-lg border p-2', part === activePart && 'border-amber-500 bg-amber-50/60 dark:bg-amber-950/30')}
          >
            <div className="flex items-center gap-1">
              <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-medium" onClick={() => onPick(null, part)}>
                {g.name}
              </button>
              {part !== 'levels' && !part.endsWith(':roof') && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${g.name}`}
                  title="Not on the plans? Remove it."
                  onClick={() => window.confirm(`Remove "${g.name}" from the draft?`) && onChange(removePart(draft, part))}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
            <ul className="grid gap-1">
              {g.items.map((m) => (
                <MeasureRow
                  key={m.id}
                  m={m}
                  units={units}
                  dark={dark}
                  active={m.id === activeMeasure}
                  hovered={m.id === hoverMeasure}
                  onHover={onHover}
                  onFocus={() => onPick(m.id, m.part)}
                  onOk={() => onChange(setDim(draft, m.id, { ok: !m.dim.ok }))}
                  onValue={(mm) => onChange(setDim(draft, m.id, { mm }))}
                />
              ))}
            </ul>
          </section>
        ))}
        {(view === 'front' || view === 'back' || view === 'left' || view === 'right') && (
          <AddOpening draft={draft} face={view} onAdd={onChange} />
        )}
      </div>
      {view !== '3d' && p && !p.done && p.total > 0 && (
        <div className="border-t p-3">
          <Button className="w-full" variant="outline" onClick={() => onChange(confirmView(draft, view))}>
            <Check /> Everything else matches this plan
          </Button>
        </div>
      )}
    </aside>
  );
}

function MeasureRow({
  m,
  units,
  dark,
  active,
  hovered,
  onHover,
  onFocus,
  onOk,
  onValue,
}: {
  m: Measure;
  units: UnitSystem;
  dark: boolean;
  active: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onFocus: () => void;
  onOk: () => void;
  onValue: (mm: number) => void;
}) {
  const tag = m.dim.source === 'plan' ? 'from plans' : m.dim.source === 'ai' ? 'inferred' : 'yours';
  return (
    <li
      data-key={m.id}
      className={cn('grid grid-cols-[1fr_7.5rem_auto] items-center gap-x-1.5 rounded-md px-1 py-1', hovered && !active && 'bg-accent', active && 'bg-blue-50 ring-1 ring-blue-700 dark:bg-blue-950')}
      onPointerEnter={() => onHover(m.id)}
      onPointerLeave={() => onHover(null)}
      onFocusCapture={onFocus}
      onClick={onFocus}
    >
      <span className="grid min-w-0">
        <span className="truncate text-xs">{m.label}</span>
        <span className={cn('truncate text-[11px]', m.dim.source === 'ai' ? 'text-red-600' : 'text-muted-foreground')} title={m.dim.ref}>
          {tag}
          {m.dim.ref ? ` · ${m.dim.ref}` : ''}
        </span>
      </span>
      <LengthInput
        label=""
        ariaLabel={`${m.partName}: ${m.label}`}
        valueMm={m.dim.mm}
        units={units}
        onChange={onValue}
        inputClassName={cn('h-7 text-xs font-semibold', sourceClass(m.dim.source, dark))}
      />
      <Button
        size="icon"
        variant={m.dim.ok ? 'default' : 'outline'}
        className={cn('size-7', m.dim.ok && 'bg-success hover:bg-success/90')}
        aria-pressed={!!m.dim.ok}
        aria-label={m.dim.ok ? `${m.label}: checked (undo)` : `${m.label} matches the plan`}
        title={m.dim.ok ? 'Checked. Click to undo.' : `Matches the plan (${formatLength(m.dim.mm, units)})`}
        onClick={(e) => {
          e.stopPropagation();
          onOk();
        }}
      >
        <Check />
      </Button>
    </li>
  );
}

/** Add a door or window the draft missed, on this side of the house. */
function AddOpening({ draft, face, onAdd }: { draft: ExteriorDraft; face: Face; onAdd: (d: ExteriorDraft) => void }) {
  const [kind, setKind] = useState<OpeningKind>('window');
  const blocks = draft.blocks;
  const [blockId, setBlockId] = useState(blocks[0]?.id ?? '');
  if (!blocks.length) return null;
  const b = blocks.find((x) => x.id === blockId) ?? blocks[0];
  return (
    <div className="mt-2 grid gap-1.5 rounded-lg border border-dashed p-2">
      <span className="text-xs font-medium">Missing a door or window on this side?</span>
      <div className="flex gap-1.5">
        <select aria-label="Kind" className="h-7 rounded border bg-background px-1 text-xs" value={kind} onChange={(e) => setKind(e.target.value as OpeningKind)}>
          <option value="window">Window</option>
          <option value="door">Door</option>
          <option value="patio-door">Patio door</option>
          <option value="garage-door">Garage door</option>
        </select>
        <select aria-label="In" className="h-7 min-w-0 flex-1 rounded border bg-background px-1 text-xs" value={b.id} onChange={(e) => setBlockId(e.target.value)}>
          {blocks.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          onClick={() => {
            const f = faceFrame(b, face);
            const door = kind !== 'window';
            const w = kind === 'garage-door' ? 2743 : kind === 'patio-door' ? 1829 : door ? 914 : 1219;
            const h = kind === 'garage-door' ? 2134 : door ? 2134 : 1219;
            onAdd({
              ...draft,
              openings: [
                ...draft.openings,
                {
                  id: `op-${Math.random().toString(36).slice(2, 8)}`,
                  blockId: b.id,
                  face,
                  kind,
                  offset: dim(Math.max(0, (f.length - w) / 2)),
                  sill: dim(door ? 0 : 914),
                  width: dim(w),
                  height: dim(h),
                },
              ],
            });
          }}
        >
          <Plus /> Add
        </Button>
      </div>
    </div>
  );
}

const SHEET_KEY = 'house-modeler:answer-sheet:';

function loadAnswerSheet(projectName: string): AnswerSheet | null {
  try {
    const raw = localStorage.getItem(SHEET_KEY + projectName);
    return raw ? parseAnswerSheet(raw) : null;
  } catch {
    return null;
  }
}

function saveAnswerSheet(projectName: string, sheet: AnswerSheet | null) {
  try {
    if (sheet) localStorage.setItem(SHEET_KEY + projectName, JSON.stringify(sheet));
    else localStorage.removeItem(SHEET_KEY + projectName);
  } catch {
    // Storage full or blocked: the score still shows for this session.
  }
}

const VERDICT_STYLE: Record<Verdict, string> = {
  right: 'text-success',
  close: 'text-amber-600',
  wrong: 'text-red-600',
  missing: 'text-red-600',
};

/** How the draft compares with the answer sheet, part by part. */
function ScorePanel(props: { score: Score | null; error: string | null; onLoad: () => void; onForget: () => void; onClose: () => void }) {
  const { score } = props;
  const parts = useMemo(() => {
    const g = new Map<string, NonNullable<typeof score>['rows']>();
    for (const r of score?.rows ?? []) {
      if (!g.has(r.part)) g.set(r.part, []);
      g.get(r.part)!.push(r);
    }
    return [...g.entries()];
  }, [score]);
  return (
    <section
      aria-label="Score against the answer sheet"
      className="absolute top-2 right-2 z-30 flex max-h-[calc(100%-1rem)] w-[min(26rem,calc(100%-1rem))] flex-col rounded-lg border bg-background shadow-lg"
    >
      <div className="flex items-start gap-2 border-b p-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{score ? `Score against ${score.sheet}` : 'Score against an answer sheet'}</h2>
          {score && (
            <p className="text-xs text-muted-foreground tabular-nums">
              <span className={VERDICT_STYLE.right}>{score.counts.right} right</span> ·{' '}
              <span className={VERDICT_STYLE.close}>{score.counts.close} close</span> ·{' '}
              <span className={VERDICT_STYLE.wrong}>{score.counts.wrong} wrong</span> ·{' '}
              <span className={VERDICT_STYLE.missing}>{score.counts.missing} missing</span>
            </p>
          )}
          {score && <p className="text-xs text-muted-foreground">Each row shows your plans, then this draft.</p>}
        </div>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Close score" onClick={props.onClose}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
        {props.error && <p className="mb-2 text-destructive">{props.error}</p>}
        {!score && !props.error && (
          <p className="text-muted-foreground">
            Load an answer sheet: a JSON file of values you confirmed from your plans. The draft is scored against it after every Redraft.
          </p>
        )}
        {parts.map(([part, rows]) => (
          <div key={part} className="mb-3">
            <h3 className="mb-1 font-medium">{part}</h3>
            <table className="w-full tabular-nums">
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t first:border-t-0">
                    <td className="py-0.5 pr-2">{r.label}</td>
                    <td className="py-0.5 pr-2 text-right text-muted-foreground">{r.expected}</td>
                    <td className="py-0.5 pr-2 text-right">{r.got}</td>
                    <td className={cn('py-0.5 text-right font-medium', VERDICT_STYLE[r.verdict])}>{r.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {score && score.extra.length > 0 && (
          <p className="text-muted-foreground">Drafted but not on the answer sheet: {score.extra.join(', ')}.</p>
        )}
      </div>
      <div className="flex gap-2 border-t p-2">
        <Button size="sm" variant="outline" onClick={props.onLoad}>
          {score ? 'Load another sheet' : 'Load answer sheet'}
        </Button>
        {score && (
          <Button size="sm" variant="ghost" onClick={props.onForget}>
            Forget sheet
          </Button>
        )}
      </div>
    </section>
  );
}

/** Where the drawings gave different values for the same thing, and which one the draft uses. */
function PlansDisagree({ conflicts }: { conflicts: PlanConflict[] }) {
  // Closed by default so the measurements stay in reach.
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50/70 p-2 text-xs dark:border-amber-800 dark:bg-amber-950/30">
      <button type="button" className="flex w-full items-center gap-1 text-left font-medium" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        Plans disagree ({conflicts.length})
      </button>
      {open && (
        <ul className="mt-1 grid gap-1.5">
          {conflicts.map((c, i) => (
            <li key={i}>
              <span className="font-medium">{c.about}:</span> {c.values.join(' · ')}. <span className="text-muted-foreground">Used {c.used}.</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Claude's description of the draft: one line, opens to the full text. */
function DraftSummary({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border p-2 text-xs">
      <button type="button" className="flex w-full items-center gap-1 text-left font-medium" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
        About this draft
      </button>
      <p className={cn('mt-1 leading-relaxed text-muted-foreground', !open && 'line-clamp-2')}>{summary}</p>
    </div>
  );
}
