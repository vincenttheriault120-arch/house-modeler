import type { RefObject } from 'react';
import { Eye, FileText, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PLAN_KINDS, type PlanKind, type PlanMeta } from './store';

interface Props {
  inputRef: RefObject<HTMLInputElement | null>;
  plans: PlanMeta[];
  error: string | null;
  onAdd: (files: FileList) => void;
  onUpdate: (meta: PlanMeta) => void;
  onRemove: (id: string) => void;
  onView: (meta: PlanMeta) => void;
}

/** Upload, label, view and delete the 2D plan PDFs (kept in this browser only). */
export function PlansSection({ inputRef: input, plans, error, onAdd, onUpdate, onRemove, onView }: Props) {
  return (
    <div className="grid gap-2">
      {plans.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Add your 2D plan PDFs. They stay in this browser only and Claude can read them to suggest measurements.
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
