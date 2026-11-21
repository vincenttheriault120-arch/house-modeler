import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, Check, DoorOpen, FlipHorizontal2, FlipVertical2, Footprints, MousePointer2, Ruler, Square, SquareDashed, Trash2 } from 'lucide-react';
import { Segmented } from '@/components/Segmented';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { LengthInput } from '../LengthInput';
import { footprintBounds, sheetPlacement } from '../model/calibration';
import type { Component } from '../model/component';
import {
  DEFAULT_WALL,
  STOREYS,
  formatArea,
  layoutOf,
  roomArea,
  roomSize,
  storeyHeights,
  wallLength,
  withLength,
  stairFit,
  type Door,
  type Heading as StairHeading,
  type StoreyId,
  type StoreyLayout,
} from '../model/interior';
import type { Project } from '../model/types';
import { loadPlanImage } from '../plans/planTexture';
import { PlanViewer } from '../plans/PlanViewer';
import type { PlanMeta } from '../plans/store';
import { formatLength, type UnitSystem } from '../units';
import { Viewport } from '../Viewport';
import { PlanEditor, removeFrom, type Selection, type Tool, type Underlay } from './PlanEditor';
import { ChecksPanel } from '../panels/ChecksPanel';
import { measures, type Check as CheckMark } from '../model/checks';

interface Props {
  project: Project;
  onCheck: (id: string, check: CheckMark | null) => void;
  onLayout: (storey: StoreyId, layout: StoreyLayout) => void;
  plans: PlanMeta[];
  onCalibrate: (meta: PlanMeta) => void;
  components: Component[];
  units: UnitSystem;
  dark: boolean;
}

const TOOLS: { id: Tool; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: 'select', label: 'Select', icon: <MousePointer2 />, hint: 'Click a wall, door, stair or room to edit it. Delete removes it. Drag to move around, scroll to zoom.' },
  {
    id: 'wall',
    label: 'Wall',
    icon: <Square />,
    hint: 'Click where the wall starts, then each corner. It snaps to corners, wall faces and square angles. Double-click or Esc to stop.',
  },
  { id: 'door', label: 'Door', icon: <DoorOpen />, hint: 'Click on a wall where the door goes. Then type its exact position and width.' },
  {
    id: 'stair',
    label: 'Stair',
    icon: <Footprints />,
    hint: 'Click the corner where the stair starts (the bottom step), then the opposite corner at the top. It climbs along its longer side.',
  },
  {
    id: 'room',
    label: 'Room',
    icon: <SquareDashed />,
    hint: 'Click each inside corner of the room, along the wall faces, then click the first corner again (or press Enter) to close it.',
  },
];

/** The plan of this storey, when it has its scale set. */
function storeyPlan(plans: PlanMeta[], storey: StoreyId) {
  const kind = STOREYS.find((s) => s.id === storey)!.plan;
  const all = plans.filter((p) => p.kind === kind || p.contains?.includes(kind));
  return { calibrated: all.find((p) => p.kind === kind && p.calibration) ?? null, any: all[0] ?? null };
}

/** Phase 2: interior walls and rooms, one storey at a time, over its floor plan. */
export function InteriorPhase({ project, onCheck, onLayout, plans, onCalibrate, components, units, dark }: Props) {
  const hasBasement = project.steps.some((s) => s.kind === 'foundation' && s.params.type === 'basement');
  const [storey, setStorey] = useState<StoreyId>(hasBasement ? 'basement' : 'ground-floor');
  const [tool, setTool] = useState<Tool>('wall');
  const [thickness, setThickness] = useState(DEFAULT_WALL);
  const [doorKind, setDoorKind] = useState<Door['kind']>('door');
  const [selected, setSelected] = useState<Selection>(null);
  const [planOpacity, setPlanOpacity] = useState(0.7);
  const [show3d, setShow3d] = useState(true);
  const [viewing, setViewing] = useState<PlanMeta | null>(null);
  const [nameFocus, setNameFocus] = useState<string | null>(null);

  const layout = layoutOf(project, storey);
  const setLayout = (l: StoreyLayout) => onLayout(storey, l);
  const { calibrated, any } = storeyPlan(plans, storey);

  // The storey's plan as an image under the drawing.
  const [image, setImage] = useState<{ key: string; url: string; width: number; height: number } | null>(null);
  const imageKey = calibrated ? `${calibrated.id}:${calibrated.calibration!.page}` : null;
  useEffect(() => {
    if (!calibrated || !imageKey) return;
    let cancelled = false;
    let url: string | null = null;
    loadPlanImage(calibrated.id, calibrated.calibration!.page).then(
      (img) => {
        url = img.url;
        if (cancelled) URL.revokeObjectURL(img.url);
        else setImage({ key: imageKey, ...img });
      },
      () => {},
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey]);

  const underlay = useMemo((): Underlay | null => {
    if (!calibrated || !image || image.key !== imageKey) return null;
    const place = sheetPlacement('top', calibrated.calibration!, footprintBounds(project), image.width, image.height);
    return { url: image.url, minX: place.center.x - place.width / 2, minY: place.center.y - place.height / 2, width: place.width, height: place.height, opacity: planOpacity };
  }, [calibrated, image, imageKey, project, planOpacity]);

  // The 3D cutaway: everything up to this storey's ceiling.
  const { top } = storeyHeights(project, storey);
  const cutaway = useMemo(() => components.filter((c) => c.bottom < top - 1), [components, top]);

  const wall = selected?.type === 'wall' ? layout.walls.find((w) => w.id === selected.id) : undefined;
  const room = selected?.type === 'room' ? layout.rooms.find((r) => r.id === selected.id) : undefined;
  const door = selected?.type === 'door' ? layout.doors?.find((d) => d.id === selected.id) : undefined;
  const doorWall = door ? layout.walls.find((w) => w.id === door.wallId) : undefined;
  const stair = selected?.type === 'stair' ? layout.stairs?.find((x) => x.id === selected.id) : undefined;
  const fit = stair ? stairFit(project, storey, stair) : null;
  const updateDoor = (patch: Partial<Door>) => door && setLayout({ ...layout, doors: (layout.doors ?? []).map((d) => (d.id === door.id ? { ...d, ...patch } : d)) });
  const updateStair = (patch: Partial<NonNullable<typeof stair>>) => stair && setLayout({ ...layout, stairs: (layout.stairs ?? []).map((x) => (x.id === stair.id ? { ...x, ...patch } : x)) });
  const roomMeasures = useMemo(() => measures(project).filter((m) => m.group === 'rooms' && m.storey === storey), [project, storey]);
  const [activeCheck, setActiveCheck] = useState<string | null>(null);
  const totalArea = layout.rooms.reduce((a, r) => a + roomArea(r), 0);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[18rem_1fr] md:grid-rows-[minmax(0,1fr)]">
      <aside className="grid min-w-0 content-start gap-5 overflow-y-auto border-b bg-background p-4 md:border-r md:border-b-0">
        <section className="grid gap-2">
          <Heading>Storey</Heading>
          <ol className="grid gap-1">
            {STOREYS.map((s) => {
              const l = layoutOf(project, s.id);
              const on = s.id === storey;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => {
                      setStorey(s.id);
                      setSelected(null);
                    }}
                    aria-current={on ? 'step' : undefined}
                    className={cn('grid w-full grid-cols-[1.25rem_1fr] gap-x-2 rounded-md px-2 py-1.5 text-left hover:bg-accent', on && 'bg-accent')}
                  >
                    <span className="mt-0.5">{l.verified ? <Check className="size-4 text-success" /> : <span className={cn('block size-4 rounded-full border-2', on ? 'border-primary' : 'border-muted-foreground/50')} />}</span>
                    <span className="grid">
                      <span className="text-sm font-medium">{s.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {l.walls.length} wall{l.walls.length === 1 ? '' : 's'} · {l.rooms.length} room{l.rooms.length === 1 ? '' : 's'}
                        {l.verified ? ' · verified' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="grid gap-2">
          <Heading>Draw</Heading>
          <div className="grid grid-cols-3 gap-1" role="toolbar" aria-label="Drawing tools">
            {TOOLS.map((t) => (
              <Button key={t.id} size="sm" variant={tool === t.id ? 'default' : 'outline'} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>
                {t.icon} {t.label}
              </Button>
            ))}
          </div>
          <p className="text-xs leading-snug text-muted-foreground">{TOOLS.find((t) => t.id === tool)!.hint}</p>
          {tool === 'door' && (
            <Segmented<Door['kind']>
              label="What the Door tool places"
              value={doorKind}
              onChange={setDoorKind}
              options={[
                { value: 'door', label: 'Door' },
                { value: 'opening', label: 'Opening' },
              ]}
            />
          )}
          {tool === 'wall' && <LengthInput label="New wall thickness" valueMm={thickness} units={units} onChange={setThickness} min={25} hint="4 1/2&quot; is a 2x4 wall with drywall both sides." />}
        </section>

        {wall && (
          <section className="grid gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <Heading>Selected wall</Heading>
              <Button variant="ghost" size="icon" className="size-7" aria-label="Delete wall" onClick={() => (setLayout(removeFrom(layout, { type: 'wall', id: wall.id })), setSelected(null))}>
                <Trash2 />
              </Button>
            </div>
            <LengthInput
              label="Length (centre line)"
              valueMm={wallLength(wall)}
              units={units}
              min={25}
              onChange={(mm) => setLayout({ ...layout, walls: layout.walls.map((w) => (w.id === wall.id ? withLength(w, mm) : w)) })}
              hint="The far end moves; the start stays put."
            />
            <LengthInput
              label="Thickness"
              valueMm={wall.thickness}
              units={units}
              min={25}
              onChange={(mm) => setLayout({ ...layout, walls: layout.walls.map((w) => (w.id === wall.id ? { ...w, thickness: mm } : w)) })}
            />
          </section>
        )}

        {door && doorWall && (
          <section className="grid gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <Heading>Selected {door.kind}</Heading>
              <Button variant="ghost" size="icon" className="size-7" aria-label={`Delete ${door.kind}`} onClick={() => (setLayout(removeFrom(layout, { type: 'door', id: door.id })), setSelected(null))}>
                <Trash2 />
              </Button>
            </div>
            <Segmented<Door['kind']>
              label="Door or opening"
              value={door.kind}
              onChange={(kind) => updateDoor({ kind })}
              options={[
                { value: 'door', label: 'Door' },
                { value: 'opening', label: 'Opening' },
              ]}
            />
            <LengthInput label="Rough opening width" valueMm={door.width} units={units} min={100} onChange={(width) => updateDoor({ width: Math.min(width, wallLength(doorWall)) })} hint='A 32" door needs about 34".' />
            <LengthInput label="Height" valueMm={door.height} units={units} min={100} onChange={(height) => updateDoor({ height })} />
            <LengthInput
              label="From the wall's start to the opening"
              valueMm={door.at - door.width / 2}
              units={units}
              min={0}
              onChange={(mm) => updateDoor({ at: Math.min(wallLength(doorWall) - door.width / 2, mm + door.width / 2) })}
              hint="Measured along the wall, to the near edge of the opening."
            />
            {door.kind === 'door' && (
              <div className="grid grid-cols-2 gap-1.5">
                <Button size="sm" variant="outline" onClick={() => updateDoor({ swing: door.swing === -1 ? 1 : -1 })}>
                  <FlipVertical2 /> Swing side
                </Button>
                <Button size="sm" variant="outline" onClick={() => updateDoor({ hinge: door.hinge === 'end' ? 'start' : 'end' })}>
                  <FlipHorizontal2 /> Hinge side
                </Button>
              </div>
            )}
          </section>
        )}

        {stair && fit && (
          <section className="grid gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <Heading>Selected stair</Heading>
              <Button variant="ghost" size="icon" className="size-7" aria-label="Delete stair" onClick={() => (setLayout(removeFrom(layout, { type: 'stair', id: stair.id })), setSelected(null))}>
                <Trash2 />
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-1" role="group" aria-label="Which way is up">
              {(
                [
                  ['up', <ArrowUp key="u" />, 'Up the plan'],
                  ['down', <ArrowDown key="d" />, 'Down the plan'],
                  ['left', <ArrowLeft key="l" />, 'To the left'],
                  ['right', <ArrowRight key="r" />, 'To the right'],
                ] as [StairHeading, React.ReactNode, string][]
              ).map(([h, icon, label]) => (
                <Button key={h} size="sm" variant={stair.heading === h ? 'default' : 'outline'} aria-label={`Climbs ${label.toLowerCase()}`} aria-pressed={stair.heading === h} onClick={() => updateStair({ heading: h })}>
                  {icon}
                </Button>
              ))}
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Total rise</dt>
              <dd className="tabular-nums">{formatLength(fit.rise, units)}</dd>
              <dt className="text-muted-foreground">Steps (risers)</dt>
              <dd className="tabular-nums">{fit.risers}</dd>
              <dt className="text-muted-foreground">Each step</dt>
              <dd className="tabular-nums">{formatLength(fit.riserHeight, units)}</dd>
              <dt className="text-muted-foreground">Tread depth</dt>
              <dd className="tabular-nums">{formatLength(fit.tread, units)}</dd>
              <dt className="text-muted-foreground">Width</dt>
              <dd className="tabular-nums">{formatLength(fit.width, units)}</dd>
            </dl>
            <p className={cn('text-xs leading-snug', fit.ok ? 'text-success' : 'text-destructive')}>
              {fit.ok ? 'Meets the code for a house stair (rise 7 7/8" max, tread 8 1/4" min).' : fit.problems.join(' ')}
            </p>
            <label className="grid gap-1 text-xs">
              <span className="text-muted-foreground">Number of risers (from the plan)</span>
              <Input
                type="number"
                min={2}
                className="h-8"
                value={stair.risers ?? ''}
                placeholder={`${fit.risers} (worked out)`}
                onChange={(e) => updateStair({ risers: e.target.value ? Math.max(2, Math.round(Number(e.target.value))) : undefined })}
              />
            </label>
            <LengthInput
              label="Length (along the climb)"
              valueMm={fit.length}
              units={units}
              min={300}
              onChange={(mm) => updateStair(stair.heading === 'up' || stair.heading === 'down' ? { sy: mm } : { sx: mm })}
            />
            <LengthInput
              label="Width"
              valueMm={fit.width}
              units={units}
              min={300}
              onChange={(mm) => updateStair(stair.heading === 'up' || stair.heading === 'down' ? { sx: mm } : { sy: mm })}
            />
          </section>
        )}

        <section className="grid gap-2">
          <div className="flex items-baseline justify-between">
            <Heading>Rooms</Heading>
            {layout.rooms.length > 0 && <span className="text-xs text-muted-foreground">{formatArea(totalArea, units)} in all</span>}
          </div>
          {layout.rooms.length === 0 ? (
            <p className="text-xs text-muted-foreground">No rooms yet. Use the Room tool and click each inside corner.</p>
          ) : (
            <ul className="grid gap-1">
              {layout.rooms.map((r) => {
                const { width, depth } = roomSize(r);
                const on = room?.id === r.id;
                return (
                  <li key={r.id} className={cn('grid gap-1 rounded-md px-2 py-1.5', on && 'bg-accent')} onClick={() => setSelected({ type: 'room', id: r.id })}>
                    <div className="flex items-center gap-1">
                      <Input
                        className="h-7 text-sm"
                        aria-label="Room name"
                        value={r.name}
                        autoFocus={nameFocus === r.id}
                        onFocus={(e) => {
                          if (nameFocus === r.id) e.target.select();
                          setNameFocus(null);
                        }}
                        onChange={(e) => setLayout({ ...layout, rooms: layout.rooms.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)) })}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        aria-label={`Delete ${r.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setLayout({ ...layout, rooms: layout.rooms.filter((x) => x.id !== r.id) });
                          if (on) setSelected(null);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <span className="px-1 text-xs text-muted-foreground tabular-nums">
                      {formatArea(roomArea(r), units)} · {formatLength(width, units)} × {formatLength(depth, units)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {roomMeasures.length > 0 && (
          <section className="grid gap-2">
            <Heading>Check room sizes</Heading>
            <ChecksPanel
              measures={roomMeasures}
              checks={project.checks ?? {}}
              plans={plans}
              units={units}
              activeId={activeCheck}
              comparePlanId={calibrated?.id ?? null}
              onActivate={(id) => {
                setActiveCheck(id);
                const m = roomMeasures.find((x) => x.id === id);
                if (m?.roomId) setSelected({ type: 'room', id: m.roomId });
              }}
              onCheck={onCheck}
              groups={['rooms']}
            />
          </section>
        )}

        <section className="grid gap-2">
          <Heading>Plan underneath</Heading>
          {calibrated ? (
            <>
              <p className="text-xs text-muted-foreground">{calibrated.name}, in blue under the drawing.</p>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Strength
                <input type="range" min={0} max={1} step={0.05} value={planOpacity} aria-label="Plan strength" onChange={(e) => setPlanOpacity(Number(e.target.value))} className="flex-1 accent-blue-700" />
              </label>
            </>
          ) : any ? (
            <>
              <p className="text-xs text-muted-foreground">Set the scale of {any.name} to trace over it.</p>
              <Button size="sm" variant="outline" onClick={() => setViewing(any)}>
                <Ruler /> Set its scale
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No {STOREYS.find((s) => s.id === storey)!.name.toLowerCase()} plan yet. Add it under Plans in Phase 1 to trace over it.</p>
          )}
        </section>

        <section className="grid gap-2">
          <Heading>Done with this storey?</Heading>
          <Button variant={layout.verified ? 'default' : 'outline'} aria-pressed={!!layout.verified} onClick={() => setLayout({ ...layout, verified: !layout.verified })}>
            <Check /> {layout.verified ? 'Verified against the plan' : 'Mark as verified'}
          </Button>
        </section>
      </aside>

      <main className="relative min-h-[60vh] min-w-0 bg-viewport md:min-h-0">
        <PlanEditor
          key={storey}
          project={project}
          layout={layout}
          onChange={setLayout}
          tool={tool}
          wallThickness={thickness}
          doorKind={doorKind}
          stairSteps={(st) => stairFit(project, storey, st).risers}
          selected={selected}
          onSelect={setSelected}
          onRoomCreated={(id) => setNameFocus(id)}
          underlay={underlay}
          units={units}
          dark={dark}
        />
        <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
          <Button size="sm" variant={show3d ? 'default' : 'outline'} className={cn(!show3d && 'bg-background')} onClick={() => setShow3d(!show3d)} aria-pressed={show3d}>
            <Box /> 3D
          </Button>
          {show3d && (
            <div className="h-56 w-72 overflow-hidden rounded-lg border bg-viewport shadow-md max-md:hidden">
              <Viewport key={storey} dark={dark} components={cutaway} gridSpacing={1219.2} selectedId={null} onSelect={() => {}} clay units={units} />
            </div>
          )}
        </div>
        {viewing && (
          <PlanViewer
            plan={viewing}
            units={units}
            onClose={() => setViewing(null)}
            onCalibrate={(meta) => {
              onCalibrate(meta);
              setViewing(meta);
            }}
          />
        )}
      </main>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</h2>;
}
