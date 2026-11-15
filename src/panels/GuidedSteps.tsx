import { Check, Circle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Guide {
  id: string;
  title: string;
  detail: string;
  status: 'done' | 'next' | 'todo' | 'soon';
  action?: { label: string; run: () => void };
}

/** The recommended order of work. Each step is still built and checked by you. */
export function GuidedSteps({ guides }: { guides: Guide[] }) {
  return (
    <ol className="grid gap-1">
      {guides.map((g) => (
        <li
          key={g.id}
          className={cn(
            'grid grid-cols-[1.25rem_1fr] gap-x-2 rounded-md px-2 py-1.5',
            g.status === 'next' && 'bg-accent',
            g.status === 'soon' && 'opacity-60',
          )}
        >
          <span className="mt-0.5">
            {g.status === 'done' ? (
              <Check className="size-4 text-success" />
            ) : g.status === 'soon' ? (
              <Clock className="size-4 text-muted-foreground" />
            ) : (
              <Circle className={cn('size-4', g.status === 'next' ? 'text-primary' : 'text-muted-foreground')} />
            )}
          </span>
          <span className="grid gap-0.5">
            <span className={cn('text-sm', g.status === 'done' && 'text-muted-foreground line-through decoration-1')}>{g.title}</span>
            {g.status !== 'done' && <span className="text-xs leading-snug text-muted-foreground">{g.detail}</span>}
            {g.action && g.status === 'next' && (
              <button className="justify-self-start text-xs font-medium text-primary underline-offset-2 hover:underline" onClick={g.action.run}>
                {g.action.label} →
              </button>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Mark the first unfinished step (that isn't "coming soon") as the next one. */
export function withNext(guides: Omit<Guide, 'status'>[], done: Record<string, boolean | 'soon'>): Guide[] {
  let found = false;
  return guides.map((g) => {
    const d = done[g.id];
    if (d === 'soon') return { ...g, status: 'soon' };
    if (d) return { ...g, status: 'done' };
    if (!found) {
      found = true;
      return { ...g, status: 'next' };
    }
    return { ...g, status: 'todo' };
  });
}
