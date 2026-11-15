import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { LengthInput } from './LengthInput';
import { buildComponents, loadAutosave, newId, parseProject, reducer, saveAutosave } from './model/project';
import { useViewSettings } from './settings';
import { downloadBlob, safeFilename } from './download';
import { exportGlb } from './scene/export';
import { FoundationEditor } from './panels/FoundationEditor';
import { foundationFields } from './model/foundation';
import { formatLength, type UnitSystem } from './units';
import { Viewport } from './Viewport';

export default function App() {
  const [settings, setSettings] = useViewSettings();
  const [project, dispatch] = useReducer(reducer, undefined, loadAutosave);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(project.steps[0]?.id ?? null);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const units = settings.units;

  useEffect(() => saveAutosave(project), [project]);

  const allComponents = useMemo(() => buildComponents(project), [project]);
  const visibleSteps = new Set(project.steps.filter((s) => s.visible).map((s) => s.id));
  const components = allComponents.filter((c) => visibleSteps.has(c.stepId));
  const selectedStep = project.steps.find((s) => s.id === selectedStepId) ?? null;
  const selectedComponent = allComponents.find((c) => c.id === selectedComponentId) ?? null;
  const componentStep = selectedComponent ? project.steps.find((s) => s.id === selectedComponent.stepId) ?? null : null;

  function selectComponent(id: string | null) {
    setSelectedComponentId(id);
    const c = allComponents.find((x) => x.id === id);
    if (c) setSelectedStepId(c.stepId);
  }

  function addFoundation() {
    const id = newId();
    dispatch({ type: 'add-foundation', id });
    setSelectedStepId(id);
    setViewKey((k) => k + 1);
  }

  async function openFile(file: File) {
    try {
      const p = parseProject(await file.text());
      dispatch({ type: 'replace', project: p });
      setSelectedStepId(p.steps[0]?.id ?? null);
      setSelectedComponentId(null);
      setViewKey((k) => k + 1);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not open that file.');
    }
  }

  function newProject() {
    if (project.steps.length && !window.confirm('Start a new, empty project? Save this one to a file first if you want to keep it.')) return;
    dispatch({ type: 'replace', project: { version: 1, name: 'My house', steps: [] } });
    setSelectedStepId(null);
    setSelectedComponentId(null);
    setViewKey((k) => k + 1);
  }

  return (
    <div className={`app ${selectedStep ? 'with-editor' : ''}`}>
      <header className="topbar">
        <h1>House Modeler</h1>
        <input
          className="project-name"
          value={project.name}
          aria-label="Project name"
          onChange={(e) => dispatch({ type: 'rename-project', name: e.target.value })}
        />
        <div className="spacer" />
        <div className="menu">
          <button onClick={newProject}>New</button>
          <button onClick={() => fileInput.current?.click()}>Open…</button>
          <button
            onClick={() =>
              downloadBlob(
                new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }),
                `${safeFilename(project.name)}.house.json`,
              )
            }
          >
            Save to file
          </button>
          <button onClick={() => exportGlb(components, project.name)} disabled={components.length === 0}>
            Export to Blender
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) openFile(f);
              e.target.value = '';
            }}
          />
        </div>
        <div className="segmented" role="group" aria-label="Units">
          {(['imperial', 'metric'] as UnitSystem[]).map((u) => (
            <button
              key={u}
              className={units === u ? 'active' : undefined}
              aria-pressed={units === u}
              onClick={() => setSettings({ ...settings, units: u })}
            >
              {u === 'imperial' ? 'ft-in' : 'mm'}
            </button>
          ))}
        </div>
      </header>

      <aside className="sidebar">
        <section>
          <h2>Build steps</h2>
          {project.steps.length === 0 && (
            <p className="empty">
              No steps yet. Start with the <strong>foundation</strong>: its outline, walls, footing and slab.
            </p>
          )}
          <ol className="steps">
            {project.steps.map((s, i) => (
              <li key={s.id} className={s.id === selectedStepId ? 'selected' : undefined}>
                <button className="step-main" onClick={() => setSelectedStepId(s.id)}>
                  <span className="step-num">{i + 1}</span>
                  <span className="step-text">
                    <span className="step-label">{s.label}</span>
                    <span className="step-level">{s.level}</span>
                  </span>
                </button>
                <button
                  className="icon"
                  title={s.visible ? 'Hide' : 'Show'}
                  aria-label={s.visible ? `Hide ${s.label}` : `Show ${s.label}`}
                  onClick={() => dispatch({ type: 'update-step', id: s.id, patch: { visible: !s.visible } })}
                >
                  {s.visible ? '👁' : '⊘'}
                </button>
              </li>
            ))}
          </ol>
          <button className="primary" onClick={addFoundation}>
            + Add foundation
          </button>
        </section>

        <section>
          <h2>Components ({components.length})</h2>
          {components.length === 0 ? (
            <p className="empty">Every wall, footing and slab you build will be listed here.</p>
          ) : (
            <ul className="components">
              {components.map((c) => (
                <li key={c.id}>
                  <button
                    className={c.id === selectedComponentId ? 'selected' : undefined}
                    onClick={() => selectComponent(c.id === selectedComponentId ? null : c.id)}
                  >
                    <span className="comp-name">{c.name}</span>
                    <span className="comp-dims">
                      {c.dims.map((d) => `${d.label} ${formatLength(d.mm, units)}`).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>View</h2>
          <LengthInput
            label="Grid spacing"
            valueMm={settings.gridSpacing}
            units={units}
            min={10}
            onChange={(mm) => setSettings({ ...settings, gridSpacing: mm })}
          />
          <button onClick={() => setViewKey((k) => k + 1)}>Reset camera</button>
        </section>
      </aside>

      <main className="viewport">
        <Viewport
          key={viewKey}
          components={components}
          gridSpacing={settings.gridSpacing}
          selectedId={selectedComponentId}
          onSelect={selectComponent}
        />
        <div className="hint">Left-drag: rotate · Right-drag: pan · Scroll: zoom · Click a piece to select it</div>
      </main>

      {selectedStep && (
        <aside className="inspector">
          <div className="inspector-head">
            <input
              className="step-title"
              value={selectedStep.label}
              aria-label="Step name"
              onChange={(e) => dispatch({ type: 'update-step', id: selectedStep.id, patch: { label: e.target.value } })}
            />
            <button className="icon" aria-label="Close editor" onClick={() => setSelectedStepId(null)}>
              ×
            </button>
          </div>
          {selectedComponent && componentStep && componentStep.id === selectedStep.id && (
            <div className="selected-piece">
              <div className="row">
                <strong>{selectedComponent.name}</strong>
                <div className="spacer" />
                <button className="icon" aria-label="Deselect piece" onClick={() => setSelectedComponentId(null)}>
                  ×
                </button>
              </div>
              {foundationFields(componentStep.params, selectedComponent).map((f) => (
                <div key={f.label}>
                  <LengthInput
                    label={f.label}
                    valueMm={f.mm}
                    units={units}
                    min={f.min}
                    onChange={(mm) =>
                      dispatch({ type: 'update-foundation', id: componentStep.id, params: f.apply(componentStep.params, mm) })
                    }
                  />
                  {f.scope && <span className="scope">{f.scope}</span>}
                </div>
              ))}
            </div>
          )}

          <label className="field">
            <span className="field-label">Level</span>
            <input
              value={selectedStep.level}
              onChange={(e) => dispatch({ type: 'update-step', id: selectedStep.id, patch: { level: e.target.value } })}
            />
          </label>

          <FoundationEditor
            step={selectedStep}
            units={units}
            onChange={(params) => dispatch({ type: 'update-foundation', id: selectedStep.id, params })}
          />

          <label className="field">
            <span className="field-label">Notes (specs, materials, questions)</span>
            <textarea
              rows={3}
              value={selectedStep.notes}
              onChange={(e) => dispatch({ type: 'update-step', id: selectedStep.id, patch: { notes: e.target.value } })}
            />
          </label>

          <div className="row">
            <button onClick={() => dispatch({ type: 'move-step', id: selectedStep.id, by: -1 })}>Move up</button>
            <button onClick={() => dispatch({ type: 'move-step', id: selectedStep.id, by: 1 })}>Move down</button>
            <div className="spacer" />
            <button
              className="danger"
              onClick={() => {
                if (window.confirm(`Delete "${selectedStep.label}"?`)) {
                  dispatch({ type: 'delete-step', id: selectedStep.id });
                  setSelectedStepId(null);
                }
              }}
            >
              Delete step
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
