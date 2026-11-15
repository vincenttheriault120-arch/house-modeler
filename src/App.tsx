import { useState } from 'react';
import { LengthInput } from './LengthInput';
import { emptyProject } from './model/types';
import { useViewSettings } from './settings';
import type { UnitSystem } from './units';
import { Viewport } from './Viewport';

export default function App() {
  const [settings, setSettings] = useViewSettings();
  const [project] = useState(emptyProject);
  const [viewKey, setViewKey] = useState(0);
  const units = settings.units;

  return (
    <div className="app">
      <header className="topbar">
        <h1>House Modeler</h1>
        <span className="project-name">{project.name}</span>
        <div className="spacer" />
        <div className="segmented" role="group" aria-label="Units">
          {(['imperial', 'metric'] as UnitSystem[]).map((u) => (
            <button
              key={u}
              className={units === u ? 'active' : undefined}
              aria-pressed={units === u}
              onClick={() => setSettings({ ...settings, units: u })}
            >
              {u === 'imperial' ? 'Imperial (ft-in)' : 'Metric (mm)'}
            </button>
          ))}
        </div>
      </header>

      <aside className="sidebar">
        <section>
          <h2>Build steps</h2>
          {project.steps.length === 0 ? (
            <p className="empty">
              No steps yet. Your first step will be the <strong>foundation</strong>: footprint,
              wall thickness, footing and top elevation.
            </p>
          ) : null}
          <button className="primary" disabled title="Coming in the next update">
            + Add foundation
          </button>
        </section>

        <section>
          <h2>Components</h2>
          <p className="empty">Every wall, slab and footing you build will be listed here.</p>
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
        <Viewport key={viewKey} gridSpacing={settings.gridSpacing} />
        <div className="hint">Left-drag: rotate · Right-drag: pan · Scroll: zoom</div>
      </main>
    </div>
  );
}
