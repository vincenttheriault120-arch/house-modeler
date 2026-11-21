import { useRef, useState } from 'react';
import { ArrowLeft, Check, Circle, FileText, House, Plus, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/Segmented';
import { cn } from '@/lib/utils';
import { LengthInput } from '../LengthInput';
import { coveredKinds, EXPECTED_PLANS, guessKind, PLAN_KINDS, type PlanMeta } from '../plans/store';
import { useViewSettings } from '../settings';
import type { UnitSystem } from '../units';
import { SHAPES, type Shape, type StarterOptions } from './starter';
import type { Location } from './types';

const FT = 304.8;

interface Props {
  folderReady: boolean;
  folderName: string;
  initialWhere: Location;
  onCancel: () => void;
  onFinish: (options: StarterOptions, plans: File[], where: Location) => void;
}

type Step = 1 | 2 | 3;

/** New project in three short steps: name, how to start, then plans or a rough shape. */
export function NewProjectWizard({ folderReady, folderName, initialWhere, onCancel, onFinish }: Props) {
  const [settings, setSettings] = useViewSettings();
  const units = settings.units;
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [where, setWhere] = useState<Location>(initialWhere);
  const [start, setStart] = useState<'plans' | 'scratch'>('plans');
  const [files, setFiles] = useState<File[]>([]);
  const [shape, setShape] = useState<Shape>('rectangle');
  const [width, setWidth] = useState(40 * FT);
  const [depth, setDepth] = useState(30 * FT);
  const [storeys, setStoreys] = useState(2);
  const [basement, setBasement] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);

  const steps: { n: Step; label: string }[] = [
    { n: 1, label: 'Name' },
    { n: 2, label: 'Start from' },
    { n: 3, label: start === 'plans' ? 'Plans' : 'Rough shape' },
  ];

  function addFiles(list: FileList | null) {
    if (!list) return;
    const pdfs = Array.from(list).filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    setFiles((prev) => [...prev, ...pdfs.filter((f) => !prev.some((p) => p.name === f.name))]);
  }

  // The checklist reads plan types from the file names; Claude labels them properly once the project opens.
  const guessed = files.map((f) => ({ kind: guessKind(f.name) }) as PlanMeta);
  const covered = coveredKinds(guessed);

  function finish() {
    onFinish({ name, address, start, shape, width, depth, storeys, basement }, start === 'plans' ? files : [], where);
  }

  return (
    <div className="min-h-full bg-muted/40">
      <header className="flex items-center gap-2 border-b bg-background px-4 py-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <ArrowLeft /> Projects
        </Button>
        <span className="text-sm font-semibold">New project</span>
      </header>

      <main className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8">
        <ol aria-label="Steps" className="flex flex-wrap gap-2">
          {steps.map((s) => (
            <li
              key={s.n}
              aria-current={s.n === step ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium',
                s.n === step ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'grid size-5 place-items-center rounded-full text-xs',
                  s.n === step ? 'bg-primary-foreground text-primary' : s.n < step ? 'bg-success text-white' : 'bg-muted',
                )}
              >
                {s.n < step ? <Check className="size-3" /> : s.n}
              </span>
              {s.label}
            </li>
          ))}
        </ol>

        <section className="grid gap-5 rounded-xl border bg-background p-6">
          {step === 1 && (
            <>
              <h1 className="text-xl font-semibold">Name your project</h1>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="np-name">Project name</Label>
                  <Input id="np-name" autoFocus placeholder="My house" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="np-address">Address (optional)</Label>
                  <Input id="np-address" placeholder="Street, city" value={address} onChange={(e) => setAddress(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Units</span>
                <Segmented<UnitSystem>
                  label="Units"
                  className="w-fit"
                  value={units}
                  onChange={(u) => setSettings({ ...settings, units: u })}
                  options={[
                    { value: 'imperial', label: 'Feet and inches' },
                    { value: 'metric', label: 'Millimetres' },
                  ]}
                />
              </div>
              {folderReady && (
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">Save in</span>
                  <Segmented<Location>
                    label="Save in"
                    className="w-fit"
                    value={where}
                    onChange={setWhere}
                    options={[
                      { value: 'folder', label: `Folder “${folderName}”` },
                      { value: 'browser', label: 'This browser' },
                    ]}
                  />
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-xl font-semibold">How do you want to start?</h1>
              <p className="-mt-2 text-sm text-muted-foreground">
                Both lead to the same phases. You can add plans to a scratch project later.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Choice
                  on={start === 'plans'}
                  onClick={() => setStart('plans')}
                  icon={<FileText className="size-7 text-primary" />}
                  title="From my plans"
                  text="Add your PDF plans. Claude labels each sheet, and the plans guide every measurement you enter."
                />
                <Choice
                  on={start === 'scratch'}
                  onClick={() => setStart('scratch')}
                  icon={<House className="size-7 text-primary" />}
                  title="From scratch"
                  text="Pick a footprint shape, the number of storeys and rough sizes. You refine every measurement in Phase 1."
                />
              </div>
            </>
          )}

          {step === 3 && start === 'plans' && (
            <>
              <div>
                <h1 className="text-xl font-semibold">Add your plans</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  PDF floor plans, elevations and sections. They are saved with this project only.
                </p>
              </div>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  addFiles(e.dataTransfer.files);
                }}
                className="grid min-h-28 place-items-center rounded-lg border-2 border-dashed text-sm text-muted-foreground hover:bg-accent"
              >
                <span className="grid justify-items-center gap-1">
                  <Upload className="size-5" />
                  <span className="font-medium text-foreground">Drop PDFs here or click to choose</span>
                  You can pick several at once.
                </span>
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              {files.length > 0 && (
                <ul className="grid gap-1">
                  {files.map((f) => (
                    <li key={f.name} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {PLAN_KINDS.find((k) => k.value === guessKind(f.name))?.label}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => setFiles((prev) => prev.filter((p) => p !== f))}
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid gap-1 rounded-lg bg-muted/60 p-3">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">What Phase 1 uses</span>
                <ul className="grid gap-0.5 sm:grid-cols-2">
                  {EXPECTED_PLANS.map((e) => (
                    <li key={e.kind} className="flex items-center gap-2 text-sm">
                      {covered.has(e.kind) ? (
                        <Check className="size-4 text-success" />
                      ) : (
                        <Circle className="size-4 text-muted-foreground" />
                      )}
                      {PLAN_KINDS.find((k) => k.value === e.kind)?.label}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Guessed from the file names. With your API key saved, Claude reads each sheet and labels it when the project opens.
                  Missing sheets can be added later.
                </p>
              </div>
            </>
          )}

          {step === 3 && start === 'scratch' && (
            <>
              <h1 className="text-xl font-semibold">Rough out the house</h1>
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Footprint shape</span>
                <div className="grid grid-cols-3 gap-3">
                  {SHAPES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      aria-pressed={shape === s.value}
                      onClick={() => setShape(s.value)}
                      className={cn(
                        'grid justify-items-center gap-2 rounded-lg border p-3 text-sm font-medium hover:bg-accent',
                        shape === s.value && 'border-primary ring-2 ring-primary/20',
                      )}
                    >
                      <svg width="64" height="56" viewBox="0 0 64 56" aria-hidden="true">
                        <path d={s.path} className="fill-muted stroke-foreground" strokeWidth="1.5" />
                      </svg>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <LengthInput label="Overall width" valueMm={width} units={units} min={1} onChange={setWidth} />
                <LengthInput label="Overall depth" valueMm={depth} units={units} min={1} onChange={setDepth} />
                <div className="grid gap-1.5">
                  <span className="text-xs text-muted-foreground">Storeys above grade</span>
                  <Segmented<string>
                    label="Storeys above grade"
                    value={String(storeys)}
                    onChange={(v) => setStoreys(Number(v))}
                    options={[
                      { value: '1', label: '1' },
                      { value: '2', label: '2' },
                      { value: '3', label: '3' },
                    ]}
                  />
                </div>
                <div className="grid gap-1.5">
                  <span className="text-xs text-muted-foreground">Foundation</span>
                  <Segmented<string>
                    label="Foundation"
                    value={basement ? 'basement' : 'slab'}
                    onChange={(v) => setBasement(v === 'basement')}
                    options={[
                      { value: 'basement', label: 'Basement' },
                      { value: 'slab', label: 'Slab on grade' },
                    ]}
                  />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                The footprint becomes your first foundation. Notches start at half the width and depth; adjust every side in Phase 1.
              </p>
            </>
          )}

          <div className="flex justify-between gap-2 pt-2">
            <Button variant="outline" onClick={() => (step === 1 ? onCancel() : setStep((step - 1) as Step))}>
              {step === 1 ? 'Cancel' : 'Back'}
            </Button>
            {step < 3 ? (
              <Button onClick={() => setStep((step + 1) as Step)}>Next</Button>
            ) : (
              <Button onClick={finish}>
                <Plus /> Create and start Phase 1
              </Button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function Choice(props: { on: boolean; onClick: () => void; icon: React.ReactNode; title: string; text: string }) {
  return (
    <button
      type="button"
      aria-pressed={props.on}
      onClick={props.onClick}
      className={cn(
        'grid content-start gap-2 rounded-xl border p-5 text-left transition-colors hover:bg-accent',
        props.on && 'border-primary ring-2 ring-primary/20',
      )}
    >
      {props.icon}
      <span className="text-base font-semibold">{props.title}</span>
      <span className="text-sm text-muted-foreground">{props.text}</span>
    </button>
  );
}
