import { useEffect, useRef, useState } from 'react';
import { Check, SendHorizontal, Settings, Sparkles, Square, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { Project } from '../model/types';
import type { UnitSystem } from '../units';
import { explainError, runTurn, type ChatMessage } from './claude';
import { forgetApiKey, loadApiKey, saveApiKey } from './apiKey';
import { planDocumentBlocks } from '../draft/generate';
import type { PlanMeta } from '../plans/store';

interface Entry {
  role: 'user' | 'assistant';
  text: string;
  actions: string[];
  /** Project before this assistant turn changed anything, for undo. */
  before?: Project;
  undone?: boolean;
  error?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  set_draft_values: 'Changed measurements of the draft',
  update_draft_volume: 'Changed a volume of the draft',
  add_draft_volume: 'Added a volume to the draft',
  add_draft_foundation: 'Added a foundation to the draft',
  add_draft_opening: 'Added a door or window',
  remove_draft_part: 'Removed a part of the draft',
  add_foundation_step: 'Added a foundation step',
  update_foundation_step: 'Changed foundation measurements',
  update_step_info: 'Updated step details',
  delete_step: 'Deleted a step',
};

interface Props {
  project: Project;
  units: UnitSystem;
  onProjectChange: (p: Project) => void;
  onClose: () => void;
  /** The project's plan PDFs, which Claude reads with the first message. */
  plans?: PlanMeta[];
}

export function ChatPanel({ project, units, onProjectChange, onClose, plans }: Props) {
  const [apiKey, setApiKey] = useState(loadApiKey);
  const [keyDraft, setKeyDraft] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [entries]);

  function saveKey() {
    const k = keyDraft.trim();
    if (!k) return;
    saveApiKey(k);
    setApiKey(k);
    setKeyDraft('');
    setShowSettings(false);
  }

  function forgetKey() {
    forgetApiKey();
    setApiKey('');
  }

  function updateLast(fn: (e: Entry) => Entry) {
    setEntries((list) => list.map((e, i) => (i === list.length - 1 ? fn(e) : e)));
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    setBusy(true);
    const before = projectRef.current;
    setEntries((list) => [...list, { role: 'user', text, actions: [] }, { role: 'assistant', text: '', actions: [] }]);
    abort.current = new AbortController();
    try {
      const next = await runTurn(
        apiKey,
        history,
        text,
        units,
        {
          getProject: () => projectRef.current,
          setProject: (p) => {
            projectRef.current = p;
            onProjectChange(p);
            updateLast((e) => ({ ...e, before: e.before ?? before }));
          },
          onText: (d) => updateLast((e) => ({ ...e, text: e.text + d })),
          onToolUse: (name) => updateLast((e) => ({ ...e, actions: [...e.actions, TOOL_LABELS[name] ?? name] })),
        },
        abort.current.signal,
        plans?.length ? () => planDocumentBlocks(plans) : undefined,
      );
      setHistory(next);
    } catch (e) {
      updateLast((x) => ({ ...x, text: (x.text ? x.text + '\n\n' : '') + explainError(e), error: true }));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  function undo(index: number) {
    const entry = entries[index];
    if (!entry.before) return;
    onProjectChange(entry.before);
    setEntries((list) => list.map((e, i) => (i === index ? { ...e, undone: true } : e)));
    setHistory((h) => [
      ...h,
      { role: 'user', content: '(I undid the changes from your last reply. The current project is what I send next.)' },
      { role: 'assistant', content: 'Understood, those changes are undone.' },
    ]);
  }

  const needsKey = !apiKey || showSettings;

  return (
    <aside
      aria-label="Claude chat"
      className="absolute inset-y-3 right-3 z-10 flex w-[min(24rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Sparkles className="size-4" />
        <span className="text-sm font-semibold">Ask Claude</span>
        <div className="flex-1" />
        {apiKey && (
          <Button variant="ghost" size="icon" className="size-8" aria-label="Chat settings" onClick={() => setShowSettings((s) => !s)}>
            <Settings />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="size-8" aria-label="Close chat" onClick={onClose}>
          <X />
        </Button>
      </div>

      {needsKey ? (
        <div className="grid gap-3 p-4 text-sm">
          <p className="leading-relaxed">
            The chat uses your own Anthropic API key. Create one at{' '}
            <a className="underline underline-offset-4" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>{' '}
            (pay per use; a typical request costs a few cents).
          </p>
          <p className="text-xs text-muted-foreground">
            Your key is stored only in this browser. It is never saved to your project file or the repository.
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="api-key" className="text-xs font-normal text-muted-foreground">
              API key
            </Label>
            <Input
              id="api-key"
              // Not type="password": Chrome would offer to save it as a login.
              // The dots come from CSS instead, and password managers are told to skip it.
              type="text"
              name="anthropic-api-key"
              className="[-webkit-text-security:disc]"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              data-bwignore
              data-form-type="other"
              placeholder="sk-ant-…"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveKey()}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={saveKey} disabled={!keyDraft.trim()}>
              Save key
            </Button>
            {apiKey && (
              <Button size="sm" variant="outline" onClick={() => setShowSettings(false)}>
                Cancel
              </Button>
            )}
            {apiKey && (
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={forgetKey}>
                Forget key
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3" ref={scroller}>
            {entries.length === 0 && (
              <div className="text-sm text-muted-foreground">
                <p className="mb-2">
                  Claude sees your exterior draft{plans?.length ? ` and your ${plans.length} plan sheets` : ''}. Describe a change and it makes it. For
                  example:
                </p>
                <ul className="grid list-disc gap-1 pl-5">
                  <li>"On the right elevation, the first floor wall should be one continuous rectangle. Fix it."</li>
                  <li>"The upper roof dips along the lines on the roof plan. Check the left and front elevations."</li>
                  <li>"Where does the 7' 8" hip roof height come from?"</li>
                </ul>
              </div>
            )}
            {entries.map((e, i) => (
              <div
                key={i}
                className={cn(
                  'max-w-[92%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap',
                  e.role === 'user' ? 'self-end bg-primary text-primary-foreground' : 'self-start bg-muted',
                  e.error && 'bg-destructive/10 text-destructive',
                )}
              >
                {e.text || (busy && i === entries.length - 1 ? <span className="text-muted-foreground">Thinking…</span> : null)}
                {e.actions.length > 0 && (
                  <ul className="mt-1.5 grid gap-0.5 text-xs text-success">
                    {e.actions.map((a, j) => (
                      <li key={j} className="flex items-center gap-1">
                        <Check className="size-3" /> {a}
                      </li>
                    ))}
                  </ul>
                )}
                {e.before && !(busy && i === entries.length - 1) && (
                  <Button variant="link" size="sm" className="mt-1 h-auto p-0 text-xs" disabled={e.undone} onClick={() => undo(i)}>
                    <Undo2 className="size-3" />
                    {e.undone ? 'Changes undone' : 'Undo these changes'}
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-end gap-2 border-t p-3">
            <Textarea
              rows={2}
              className="min-h-0 resize-none"
              placeholder="Ask or describe a change…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {busy ? (
              <Button variant="outline" onClick={() => abort.current?.abort()}>
                <Square /> Stop
              </Button>
            ) : (
              <Button onClick={send} disabled={!draft.trim()} aria-label="Send">
                <SendHorizontal />
              </Button>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
