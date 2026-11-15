import type { RefObject } from 'react';
import { Check, Circle, Eye, FileText, Loader2, Sparkles, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { coveredKinds, EXPECTED_PLANS, PLAN_KINDS, type PlanKind, type PlanMeta } from './store';

interface Props {
  inputRef: RefObject<HTMLInputElement | null>;
  plans: PlanMeta[];
  error: string | null;
  labeling: Set<string>;
  hasKey: boolean;
  onAdd: (files: FileList) => void;
  onUpdate: (meta: PlanMeta) => void;
  onRemove: (id: string) => void;
  onView: (meta: PlanMeta) => void;
}

/** Upload, label, view and delete the 2D plan PDFs (kept in this browser only). */
export function PlansSection({ inputRef: input, plans, error, labeling, hasKey, onAdd, onUpdate, onRemove, onView }: Props) {
  const covered = coveredKinds(plans);
  const label = (k: PlanKind) => PLAN_KINDS.find((x) => x.value === k)?.label ?? k;
  return (
    <div className="grid gap-2">
      <ul className="grid gap-0.5 rounded-md bg-muted/60 px-2.5 py-2" aria-label="Plans checklist">
        {EXPECTED_PLANS.map((e) => {
          const have = covered.has(e.kind);
          return (
            <li key={e.kind} className="flex min-w-0 items-center gap-2 text-xs" title={e.why}>
              {have ? <Check className="size-3.5 shrink-0 text-success" /> : <Circle className="size-3.5 shrink-0 text-muted-foreground" />}
              <span className={cn('truncate', have ? 'text-muted-foreground' : 'text-foreground')}>{label(e.kind)}</span>
              {!have && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">missing</span>}
            </li>
          );
        })}
      </ul>
      {plans.length > 0 && !hasKey && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Save your API key in Ask Claude and new PDFs will be labeled automatically.
        </p>
      )}
      {plans.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Add your 2D plan PDFs: floor plans, the four elevations and a section. They stay in this browser only;
          Claude labels each one and reads them to suggest measurements and heights.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {plans.map((p) => (
            <li key={p.id} className="grid gap-1.5 rounded-md border p-2">
              <div className="flex items-center gap-1.5">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm" title={p.name}>
                  {p.name}
                </span>
                <Button variant="ghost" size="icon" className="size-7" aria-label={`View ${p.name}`} onClick={() => onView(p)}>
                  <Eye />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => window.confirm(`Remove "${p.name}" from this browser?`) && onRemove(p.id)}
                >
                  <Trash2 />
                </Button>
              </div>
              {labeling.has(p.id) ? (
                <span className="flex h-7 items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Claude is reading it…
                </span>
              ) : (
              <Select value={p.kind} onValueChange={(v) => onUpdate({ ...p, kind: v as PlanKind })}>
                <SelectTrigger size="sm" className="h-7 w-full text-xs" aria-label={`What ${p.name} shows`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              )}
              {!labeling.has(p.id) && (p.labeledBy === 'claude' || (p.contains?.length ?? 0) > 0) && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {p.labeledBy === 'claude' && <Sparkles className="size-3" />}
                  {p.labeledBy === 'claude' ? 'Labeled by Claude' : ''}
                  {(p.contains?.length ?? 0) > 0 && `${p.labeledBy === 'claude' ? ' · ' : ''}also: ${p.contains!.map(label).join(', ')}`}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
        <Upload /> Add plan PDFs
      </Button>
      <input
        ref={input}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        hidden
        data-testid="plan-input"
        onChange={(e) => {
          if (e.target.files?.length) onAdd(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
