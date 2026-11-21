import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** The house is built outside in, in the same five phases whether it starts from plans or from scratch. */
export type PhaseId = 1 | 2 | 3 | 4 | 5;

export const PHASES: { id: PhaseId; name: string; blurb: string }[] = [
  { id: 1, name: 'Exterior shell', blurb: 'The whole outside of the house: footprint, levels, storeys, roofs and openings, checked against the plans.' },
  { id: 2, name: 'Interior layout', blurb: 'Interior walls, rooms, doors and stairs, one level at a time, over each floor plan.' },
  { id: 3, name: 'Structure', blurb: 'Footings, slabs, floor systems and framing.' },
  { id: 4, name: 'Finishes', blurb: 'Materials for each surface, lighting fixtures and a sun study.' },
  { id: 5, name: 'Share', blurb: 'Saved views, the component list and the Blender export.' },
];

export function PhaseBar({ phase, onChange }: { phase: PhaseId; onChange: (p: PhaseId) => void }) {
  return (
    <nav aria-label="Phases" className="flex gap-1.5 overflow-x-auto border-b bg-background px-4 py-2">
      {PHASES.map((p) => {
        const on = p.id === phase;
        return (
          <button
            key={p.id}
            onClick={() => onChange(p.id)}
            aria-current={on ? 'step' : undefined}
            className={cn(
              'grid shrink-0 rounded-lg border px-3 py-1.5 text-left transition-colors hover:bg-accent',
              on ? 'border-primary bg-accent' : 'border-transparent',
            )}
          >
            <span className="text-[11px] text-muted-foreground">Phase {p.id}</span>
            <span className="text-sm font-medium">{p.name}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** Shown for phases that aren't built yet. */
export function PhasePlaceholder({ phase, onBack }: { phase: PhaseId; onBack: () => void }) {
  const p = PHASES.find((x) => x.id === phase)!;
  return (
    <div className="grid flex-1 place-items-center p-8">
      <div className="grid max-w-md justify-items-center gap-3 text-center">
        <h2 className="text-xl font-semibold">
          Phase {p.id}: {p.name}
        </h2>
        <p className="text-muted-foreground">{p.blurb}</p>
        <p className="text-sm text-muted-foreground">
          This phase is coming in a later update. Your work so far lives in Phase 1.
        </p>
        <Button onClick={onBack}>
          <Check /> Back to Phase 1
        </Button>
      </div>
    </div>
  );
}
