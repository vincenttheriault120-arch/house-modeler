import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Box,
  Eye,
  EyeOff,
  HardDrive,
  House,
  Moon,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Segmented } from '@/components/Segmented';
import { cn } from '@/lib/utils';
import { LengthInput } from './LengthInput';
import { buildComponents, newId, reducer } from './model/project';
import { foundationFields } from './model/foundation';
import type { Project } from './model/types';
import { floorFields } from './model/floor';
import { FloorEditor } from './panels/FloorEditor';
import { useViewSettings } from './settings';
import { useTheme } from './theme';
import { downloadBlob, safeFilename } from './download';
import { exportGlb } from './scene/export';
import { FoundationEditor } from './panels/FoundationEditor';
import { formatLength, type UnitSystem } from './units';
import { Viewport } from './Viewport';
import { ChatPanel } from './chat/ChatPanel';
import { loadApiKey } from './chat/apiKey';
import { applyFoundationType, defaultFoundation } from './model/foundation';
import { GuidedSteps, withNext } from './panels/GuidedSteps';
import { PlansSection } from './plans/PlansSection';
import { PlanViewer } from './plans/PlanViewer';
import { SuggestDialog } from './plans/SuggestDialog';
import { FloorSuggestDialog } from './plans/FloorSuggestDialog';
import { setActivePlanStore, type PlanMeta, type PlanStore } from './plans/store';
import { usePlans } from './plans/usePlans';
import { LevelsSection } from './panels/LevelsSection';
import { LevelsSuggestDialog } from './plans/LevelsSuggestDialog';
import { defaultFloor } from './model/floor';
import { sortLevels } from './model/levels';

function PanelHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</h2>;
}

interface WorkspaceProps {
  initial: Project;
  /** Where the project is kept, shown in the top bar ("This browser" or the folder's name). */
  whereLabel: string;
  onSave: (project: Project) => Promise<void>;
  planStore: PlanStore;
  onHome: () => void;
}

/** One open project: build steps, plans and the 3D view. */
export default function Workspace({ initial, whereLabel, onSave, planStore, onHome }: WorkspaceProps) {
  const [settings, setSettings] = useViewSettings();
  const { dark, toggle: toggleTheme } = useTheme();
  const [project, dispatch] = useReducer(reducer, initial);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [selectedStepId, setSelectedStepId] = useState<string | null>(project.steps[0]?.id ?? null);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [viewing, setViewing] = useState<PlanMeta | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestingLevels, setSuggestingLevels] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const planInput = useRef<HTMLInputElement>(null);
  // PlanViewer and Claude's suggestions read plan bytes through the active store.
  setActivePlanStore(planStore);
  useEffect(() => {
    setActivePlanStore(planStore);
    return () => setActivePlanStore(null);
  }, [planStore]);
  const plans = usePlans(planStore);
  const units = settings.units;

  // Save shortly after each change, to wherever this project is kept.
  useEffect(() => {
    if (project === initial) return; // just opened: nothing to save
    setSaveState('saving');
    const t = setTimeout(() => {
      onSave(project).then(
        () => setSaveState('saved'),
        () => setSaveState('error'),
      );
    }, 400);
    return () => clearTimeout(t);
  }, [project, initial, onSave]);

  const allComponents = useMemo(() => buildComponents(project), [project]);
  const visibleSteps = new Set(project.steps.filter((s) => s.visible).map((s) => s.id));
  const components = allComponents.filter(
    (c) => visibleSteps.has(c.stepId) && (settings.showSubfloor || c.kind !== 'subfloor'),
  );
  const selectedStep = project.steps.find((s) => s.id === selectedStepId) ?? null;
  const selectedComponent = allComponents.find((c) => c.id === selectedComponentId) ?? null;
  const componentStep = selectedComponent ? (project.steps.find((s) => s.id === selectedComponent.stepId) ?? null) : null;

  function selectComponent(id: string | null) {
    setSelectedComponentId(id);
    const c = allComponents.find((x) => x.id === id);
    if (c) setSelectedStepId(c.stepId);
  }

  function addFoundation(preset?: 'basement' | 'garage') {
    const id = newId();
    dispatch({ type: 'add-foundation', id });
    if (preset === 'basement') dispatch({ type: 'update-step', id, patch: { label: 'Basement' } });
    if (preset === 'garage') dispatch({ type: 'update-step', id, patch: { label: 'Garage slab', level: 'Ground floor' } });
    // Start from the right height: follow the matching level when there is one.
    const params = preset === 'garage' ? applyFoundationType(defaultFoundation(), 'slab-on-grade') : defaultFoundation();
    const level = project.levels.find((l) => l.kind === (preset === 'garage' ? 'garage-slab' : 'foundation-top'));
    if (preset === 'garage' || level) {
      dispatch({ type: 'update-foundation', id, params: level ? { ...params, topLevelId: level.id, topElevation: level.elevation } : params });
    }
    setSelectedStepId(id);
    setSelectedComponentId(null);
    setViewKey((k) => k + 1);
  }

  function addFloor(supportId: string) {
    const id = newId();
    dispatch({ type: 'add-floor', id, supportId });
    // Check it against the lowest finished-floor level above grade (the ground floor).
    const target = sortLevels(project.levels).find((l) => l.kind === 'floor' && l.elevation > 0);
    const support = project.steps.find((s) => s.id === supportId);
    if (target && support?.kind === 'foundation') {
      dispatch({ type: 'update-floor', id, params: { ...defaultFloor(supportId, support.params), levelId: target.id } });
    }
    setSelectedStepId(id);
    setSelectedComponentId(null);
  }

  function startLevelsSuggest() {
    if (!loadApiKey()) {
      setChatOpen(true);
      return;
    }
    if (plans.plans.length === 0) {
      planInput.current?.click();
      return;
    }
    setSuggestingLevels(true);
  }

  function startSuggest() {
    if (!loadApiKey()) {
      setNotice('Claude needs your API key first. Add it in the Ask Claude panel (it stays in this browser), then try again.');
      setChatOpen(true);
      return;
    }
    if (plans.plans.length === 0) {
      setNotice('Add your plan PDFs first (left panel, under Plans).');
      return;
    }
    setNotice(null);
    setSuggesting(true);
  }

  /** From the guide: add the step, then go straight to Claude's suggestions when plans and a key are ready. */
  function addAndSuggest(add: () => void) {
    add();
    if (plans.plans.length > 0 && loadApiKey()) {
      setNotice(null);
      setSuggesting(true);
    }
  }

  const foundations = project.steps.flatMap((s) => (s.kind === 'foundation' ? [s] : []));
  const basement = foundations.find((s) => s.params.type === 'basement');
  const hasFloorOverBasement = !!basement && project.steps.some((s) => s.kind === 'floor' && s.params.supportId === basement.id);
  /** Foundation to put a new floor on: the selected one, else the basement, else the first. */
  const floorTarget =
    (selectedStep?.kind === 'foundation' ? selectedStep : undefined) ?? basement ?? foundations[0];
  const guides = withNext(
    [
      {
        id: 'plans',
        title: 'Import your plans',
        detail: 'Floor plans, the four elevations and a section. Claude labels each one.',
        action: { label: 'Add plan PDFs', run: () => planInput.current?.click() },
      },
      {
        id: 'levels',
        title: 'Set the levels',
        detail: 'Grade, top of foundation, each floor and the roof ridge, read from the elevations. Every step starts from these.',
        action: { label: 'Suggest from elevations', run: startLevelsSuggest },
      },
      {
        id: 'basement',
        title: 'Basement foundation',
        detail: 'Outline, walls, footing and slab. Claude reads your plans and suggests each value; you review before anything changes.',
        action: { label: 'Add the basement', run: () => addAndSuggest(() => addFoundation('basement')) },
      },
      {
        id: 'slab',
        title: 'Garage slab on grade',
        detail: 'Frost walls and the slab beside the basement.',
        action: { label: 'Add the garage slab', run: () => addAndSuggest(() => addFoundation('garage')) },
      },
      {
        id: 'floor0',
        title: 'Floor over the basement',
        detail: 'Sill plate, joists, beam and posts, subfloor. Sets the ground floor height.',
        action: basement ? { label: 'Add the floor', run: () => addAndSuggest(() => addFloor(basement.id)) } : undefined,
      },
      { id: 'walls0', title: 'Ground floor walls', detail: 'Exterior walls, openings. Coming next.' },
      { id: 'floor1', title: 'First floor, with the cantilever', detail: 'Over the garage, overhanging at the back. Coming soon.' },
      { id: 'roof', title: 'Roofs and the green roof', detail: 'Including the mini green roof over the garage door. Coming soon.' },
    ],
    {
      plans: plans.plans.length > 0,
      levels: project.levels.length > 0,
      basement: foundations.some((s) => s.params.type === 'basement'),
      slab: foundations.some((s) => s.params.type === 'slab-on-grade'),
      floor0: hasFloorOverBasement,
      walls0: 'soon',
      floor1: 'soon',
      roof: 'soon',
    },
  );

  return (
    <div
      className={cn(
        'grid h-full grid-rows-[auto_1fr] grid-cols-1 md:grid-cols-[18rem_1fr]',
        selectedStep && 'lg:grid-cols-[18rem_1fr_22rem]',
      )}
    >
      {/* Top bar */}
      <header className="col-span-full flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2">
        <Button variant="ghost" size="sm" onClick={onHome} aria-label="All projects">
          <House /> Projects
        </Button>
        <span className="text-muted-foreground" aria-hidden="true">
          /
        </span>
        <Input
          className="h-8 w-44 border-transparent text-muted-foreground shadow-none hover:border-input focus-visible:text-foreground"
          value={project.name}
          aria-label="Project name"
          onChange={(e) => dispatch({ type: 'rename-project', name: e.target.value })}
        />
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-1">
          <span
            className={cn('flex items-center gap-1.5 px-2 text-xs', saveState === 'error' ? 'text-destructive' : 'text-muted-foreground')}
            title={saveState === 'error' ? 'Use Save to file to keep a copy.' : undefined}
          >
            <HardDrive className="size-3.5" />
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? "Couldn't save" : `Saved · ${whereLabel}`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              downloadBlob(
                new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }),
                `${safeFilename(project.name)}.house.json`,
              )
            }
          >
            <Save /> Save to file
          </Button>
          <Button variant="ghost" size="sm" onClick={() => exportGlb(components, project.name)} disabled={components.length === 0}>
            <Box /> Export to Blender
          </Button>
        </div>
        <Separator orientation="vertical" className="mx-1 !h-6" />
        <Button variant={chatOpen ? 'default' : 'outline'} size="sm" onClick={() => setChatOpen((o) => !o)}>
          <Sparkles /> Ask Claude
        </Button>
        <Segmented<UnitSystem>
          label="Units"
          value={units}
          onChange={(u) => setSettings({ ...settings, units: u })}
          options={[
            { value: 'imperial', label: 'ft-in' },
            { value: 'metric', label: 'mm' },
          ]}
        />
        <Button variant="ghost" size="icon" className="size-8" onClick={toggleTheme} aria-label={dark ? 'Light theme' : 'Dark theme'}>
          {dark ? <Sun /> : <Moon />}
        </Button>
      </header>

      {/* Left: steps and components */}
      <aside className="grid min-w-0 content-start gap-5 overflow-x-hidden overflow-y-auto border-b bg-background p-4 md:border-r md:border-b-0 [&>*]:min-w-0">
        <section className="grid gap-2">
          <PanelHeading>Guide</PanelHeading>
          <GuidedSteps guides={guides} />
        </section>

        <Separator />

        <section className="grid gap-3">
          <div className="flex items-center gap-2">
            <PanelHeading>Plans</PanelHeading>
            {plans.plans.length > 0 && <Badge variant="secondary">{plans.plans.length}</Badge>}
          </div>
          <PlansSection
            inputRef={planInput}
            plans={plans.plans}
            error={plans.error}
            labeling={plans.labeling}
            hasKey={!!loadApiKey()}
            onAdd={(f) => {
              setNotice(null);
              plans.add(f);
            }}
            onUpdate={plans.update}
            onRemove={plans.remove}
            onView={setViewing}
          />
        </section>

        <Separator />

        <section className="grid gap-3">
          <div className="flex items-center gap-2">
            <PanelHeading>Levels</PanelHeading>
            {project.levels.length > 0 && <Badge variant="secondary">{project.levels.length}</Badge>}
          </div>
          <LevelsSection
            project={project}
            units={units}
            onChange={(levels) => dispatch({ type: 'set-levels', levels })}
            onSuggest={startLevelsSuggest}
          />
        </section>

        <Separator />

        <section className="grid gap-3">
          <PanelHeading>Build steps</PanelHeading>
          {project.steps.length === 0 && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              No steps yet, so the 3D view is empty. The model is built from these steps: follow the{' '}
              <strong className="text-foreground">Guide</strong> above, starting with the basement.
            </p>
          )}
          <ol className="grid gap-1.5">
            {project.steps.map((s, i) => (
              <li key={s.id} className="flex items-center gap-1">
                <button
                  className={cn(
                    'flex flex-1 items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent',
                    s.id === selectedStepId && 'border-primary bg-accent',
                    !s.visible && 'opacity-60',
                  )}
                  onClick={() => setSelectedStepId(s.id)}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs text-primary-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <span className="grid min-w-0">
                    <span className="truncate text-sm font-medium">{s.label}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {s.level}
                      {s.kind === 'foundation' && ` · ${s.params.type === 'slab-on-grade' ? 'Slab on grade' : 'Basement'}`}
                      {s.kind === 'floor' && ' · Floor system'}
                    </span>
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={s.visible ? `Hide ${s.label}` : `Show ${s.label}`}
                  onClick={() => dispatch({ type: 'update-step', id: s.id, patch: { visible: !s.visible } })}
                >
                  {s.visible ? <Eye /> : <EyeOff />}
                </Button>
              </li>
            ))}
          </ol>
          <Button variant={project.steps.length ? 'outline' : 'default'} onClick={() => addFoundation()}>
            <Plus /> Add foundation
          </Button>
          {floorTarget && (
            <Button variant="outline" onClick={() => addFloor(floorTarget.id)}>
              <Plus /> Add floor on {floorTarget.label}
            </Button>
          )}
        </section>

        <Separator />

        <section className="grid gap-3">
          <div className="flex items-center gap-2">
            <PanelHeading>Components</PanelHeading>
            <Badge variant="secondary">{components.length}</Badge>
          </div>
          {components.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every wall, footing and slab you build will be listed here.</p>
          ) : (
            <ul className="grid gap-1">
              {components.map((c) => (
                <li key={c.id}>
                  <button
                    className={cn(
                      'grid w-full gap-0.5 rounded-md border border-transparent px-3 py-1.5 text-left transition-colors hover:bg-accent',
                      c.id === selectedComponentId && 'border-highlight bg-highlight-soft hover:bg-highlight-soft',
                    )}
                    onClick={() => selectComponent(c.id === selectedComponentId ? null : c.id)}
                  >
                    <span className="text-sm">{c.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {c.dims.map((d) => `${d.label} ${formatLength(d.mm, units)}`).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Separator />

        <section className="grid gap-3">
          <PanelHeading>View</PanelHeading>
          <LengthInput
            label="Grid spacing"
            valueMm={settings.gridSpacing}
            units={units}
            min={10}
            onChange={(mm) => setSettings({ ...settings, gridSpacing: mm })}
          />
          <label className="grid cursor-pointer grid-cols-[auto_1fr] items-center gap-x-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={settings.showSubfloor}
              onChange={(e) => setSettings({ ...settings, showSubfloor: e.target.checked })}
            />
            <span>Show subfloors</span>
            <span className="col-start-2 text-xs text-muted-foreground">Untick to see the joists</span>
          </label>
          <Button variant="outline" size="sm" onClick={() => setViewKey((k) => k + 1)}>
            <RotateCcw /> Reset camera
          </Button>
        </section>
      </aside>

      {/* Center: 3D */}
      <main className="relative min-h-[60vh] min-w-0 bg-viewport md:min-h-0">
        <Viewport
          key={viewKey}
          dark={dark}
          components={components}
          gridSpacing={settings.gridSpacing}
          selectedId={selectedComponentId}
          onSelect={selectComponent}
        />
        {chatOpen && (
          <ChatPanel
            project={project}
            units={units}
            onProjectChange={(p) => dispatch({ type: 'replace', project: p })}
            onClose={() => setChatOpen(false)}
          />
        )}
        {viewing && <PlanViewer plan={viewing} onClose={() => setViewing(null)} />}
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-background/85 px-2.5 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
          Left-drag: rotate · Right-drag: pan · Scroll: zoom · Click a piece to select it
        </div>
      </main>

      {/* Right: inspector */}
      {selectedStep && (
        <aside className="col-span-full grid content-start gap-5 overflow-y-auto border-t bg-background p-4 lg:col-span-1 lg:border-t-0 lg:border-l">
          <div className="flex items-center gap-2">
            <Input
              className="h-9 flex-1 border-transparent text-base font-semibold shadow-none hover:border-input"
              value={selectedStep.label}
              aria-label="Step name"
              onChange={(e) => dispatch({ type: 'update-step', id: selectedStep.id, patch: { label: e.target.value } })}
            />
            <Button variant="ghost" size="icon" className="size-8" aria-label="Close editor" onClick={() => setSelectedStepId(null)}>
              <X />
            </Button>
          </div>

          {selectedComponent && componentStep && componentStep.id === selectedStep.id && (
            <div className="grid gap-3 rounded-lg border border-highlight bg-highlight-soft p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{selectedComponent.name}</span>
                <div className="flex-1" />
                <Button variant="ghost" size="icon" className="size-7" aria-label="Deselect piece" onClick={() => setSelectedComponentId(null)}>
                  <X />
                </Button>
              </div>
              {componentStep.kind === 'foundation' &&
                foundationFields(componentStep.params, selectedComponent).map((f) => (
                  <LengthInput
                    key={f.label}
                    label={f.label}
                    hint={f.scope}
                    valueMm={f.mm}
                    units={units}
                    min={f.min}
                    onChange={(mm) =>
                      dispatch({ type: 'update-foundation', id: componentStep.id, params: f.apply(componentStep.params, mm) })
                    }
                  />
                ))}
              {componentStep.kind === 'floor' &&
                floorFields(componentStep.params, selectedComponent).map((f) => (
                  <LengthInput
                    key={f.label}
                    label={f.label}
                    hint={f.scope}
                    valueMm={f.mm}
                    units={units}
                    min={f.min}
                    onChange={(mm) => dispatch({ type: 'update-floor', id: componentStep.id, params: f.apply(componentStep.params, mm) })}
                  />
                ))}
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="step-level" className="text-xs font-normal text-muted-foreground">
              Level
            </Label>
            <Input
              id="step-level"
              className="h-8"
              value={selectedStep.level}
              onChange={(e) => dispatch({ type: 'update-step', id: selectedStep.id, patch: { level: e.target.value } })}
            />
          </div>

          <div className="grid gap-2">
            <Button variant="outline" onClick={startSuggest}>
              <Sparkles /> Suggest from plans
            </Button>
            {notice && <p className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed">{notice}</p>}
          </div>

          {selectedStep.kind === 'foundation' && (
            <FoundationEditor
              step={selectedStep}
              levels={project.levels}
              units={units}
              onChange={(params) => dispatch({ type: 'update-foundation', id: selectedStep.id, params })}
            />
          )}
          {selectedStep.kind === 'floor' && (
            <FloorEditor
              project={project}
              step={selectedStep}
              units={units}
              onChange={(params) => dispatch({ type: 'update-floor', id: selectedStep.id, params })}
              onRaiseSupport={(by) => {
                const sup = project.steps.find((x) => x.id === selectedStep.params.supportId);
                if (sup?.kind !== 'foundation') return;
                const lvl = project.levels.find((l) => l.id === sup.params.topLevelId);
                // A foundation that follows a level moves by moving its level.
                if (lvl)
                  dispatch({
                    type: 'set-levels',
                    levels: project.levels.map((l) => (l.id === lvl.id ? { ...l, elevation: l.elevation + by, source: 'Adjusted to meet the floor' } : l)),
                  });
                else dispatch({ type: 'update-foundation', id: sup.id, params: { ...sup.params, topElevation: sup.params.topElevation + by } });
              }}
            />
          )}

          <Separator />

          <div className="grid gap-1.5">
            <Label htmlFor="step-notes" className="text-xs font-normal text-muted-foreground">
              Notes (specs, materials, questions)
            </Label>
            <Textarea
              id="step-notes"
              rows={3}
              value={selectedStep.notes}
              onChange={(e) => dispatch({ type: 'update-step', id: selectedStep.id, patch: { notes: e.target.value } })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'move-step', id: selectedStep.id, by: -1 })}>
              <ArrowUp /> Move up
            </Button>
            <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'move-step', id: selectedStep.id, by: 1 })}>
              <ArrowDown /> Move down
            </Button>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (window.confirm(`Delete "${selectedStep.label}"?`)) {
                  dispatch({ type: 'delete-step', id: selectedStep.id });
                  setSelectedStepId(null);
                }
              }}
            >
              <Trash2 /> Delete step
            </Button>
          </div>
        </aside>
      )}

      {suggestingLevels && (
        <LevelsSuggestDialog
          apiKey={loadApiKey()}
          plans={plans.plans}
          project={project}
          units={units}
          onApply={(levels) => dispatch({ type: 'set-levels', levels })}
          onClose={() => setSuggestingLevels(false)}
        />
      )}
      {suggesting && selectedStep?.kind === 'foundation' && (
        <SuggestDialog
          apiKey={loadApiKey()}
          plans={plans.plans}
          project={project}
          step={selectedStep}
          units={units}
          onApply={(params) => {
            dispatch({ type: 'update-foundation', id: selectedStep.id, params });
            setViewKey((k) => k + 1);
          }}
          onClose={() => setSuggesting(false)}
        />
      )}
      {suggesting && selectedStep?.kind === 'floor' && (
        <FloorSuggestDialog
          apiKey={loadApiKey()}
          plans={plans.plans}
          project={project}
          step={selectedStep}
          units={units}
          onApply={(params) => dispatch({ type: 'update-floor', id: selectedStep.id, params })}
          onClose={() => setSuggesting(false)}
        />
      )}
    </div>
  );
}
