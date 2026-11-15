import { useEffect, useRef, useState } from 'react';
import type { Project } from '../model/types';
import type { UnitSystem } from '../units';
import { explainError, runTurn, type ChatMessage } from './claude';

const KEY_STORAGE = 'house-modeler:anthropic-key';

function loadKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

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
}

export function ChatPanel({ project, units, onProjectChange, onClose }: Props) {
  const [apiKey, setApiKey] = useState(loadKey);
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
    try {
      localStorage.setItem(KEY_STORAGE, k);
    } catch {
      // Not remembered, but usable for this visit.
    }
    setApiKey(k);
    setKeyDraft('');
    setShowSettings(false);
  }

  function forgetKey() {
    try {
      localStorage.removeItem(KEY_STORAGE);
    } catch {
      // ignore
    }
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
    <aside className="chat" aria-label="Claude chat">
      <div className="chat-head">
        <strong>Ask Claude</strong>
        <div className="spacer" />
        {apiKey && (
          <button className="icon" title="Chat settings" aria-label="Chat settings" onClick={() => setShowSettings((s) => !s)}>
            ⚙
          </button>
        )}
        <button className="icon" aria-label="Close chat" onClick={onClose}>
          ×
        </button>
      </div>

      {needsKey ? (
        <div className="chat-setup">
          <p>
            The chat uses your own Anthropic API key. Create one at{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>{' '}
            (pay per use; a typical request costs a few cents).
          </p>
          <p className="help">Your key is stored only in this browser. It is never saved to your project file or the repository.</p>
          <label className="field">
            <span className="field-label">API key</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="sk-ant-…"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveKey()}
            />
          </label>
          <div className="row">
            <button className="primary" onClick={saveKey} disabled={!keyDraft.trim()}>
              Save key
            </button>
            {apiKey && <button onClick={() => setShowSettings(false)}>Cancel</button>}
            {apiKey && (
              <button className="danger" onClick={forgetKey}>
                Forget key
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="chat-log" ref={scroller}>
            {entries.length === 0 && (
              <div className="chat-empty">
                <p>Describe a change and Claude will make it. For example:</p>
                <ul>
                  <li>"Make the garage a slab on grade, 18' 1" by 39' 1 1/2", starting 20' 1" to the right."</li>
                  <li>"Change the basement walls to 10" thick."</li>
                  <li>"What's the top elevation of the basement slab?"</li>
                </ul>
              </div>
            )}
            {entries.map((e, i) => (
              <div key={i} className={`bubble ${e.role} ${e.error ? 'error' : ''}`}>
                {e.text || (busy && i === entries.length - 1 ? <span className="typing">Thinking…</span> : null)}
                {e.actions.length > 0 && (
                  <ul className="actions">
                    {e.actions.map((a, j) => (
                      <li key={j}>✓ {a}</li>
                    ))}
                  </ul>
                )}
                {e.before && !(busy && i === entries.length - 1) && (
                  <button className="link" disabled={e.undone} onClick={() => undo(i)}>
                    {e.undone ? 'Changes undone' : 'Undo these changes'}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="chat-input">
            <textarea
              rows={2}
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
              <button onClick={() => abort.current?.abort()}>Stop</button>
            ) : (
              <button className="primary" onClick={send} disabled={!draft.trim()}>
                Send
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
