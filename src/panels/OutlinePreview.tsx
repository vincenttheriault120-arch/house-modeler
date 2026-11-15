import { runsToPoints, type Run, type Vec2 } from '../model/geometry';

/** Small top-down sketch of an outline, with side numbers, to compare against the plan. */
export function OutlinePreview({ runs, origin }: { runs: Run[]; origin: Vec2 }) {
  const pts = runsToPoints(runs, origin);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const pad = span * 0.12;
  // SVG y grows downward; plan y grows up the page.
  const view = `${minX - pad} ${-maxY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  const start = pts[0];
  const end = pts[pts.length - 1];
  const open = Math.hypot(end.x - start.x, end.y - start.y) > 0.5;
  const fontSize = span * 0.055;

  return (
    <svg className="outline-preview" viewBox={view} role="img" aria-label="Outline preview">
      <polyline
        points={pts.map((p) => `${p.x},${-p.y}`).join(' ')}
        fill={open ? 'none' : 'rgba(47,111,222,0.10)'}
        stroke="#2f6fde"
        strokeWidth={span * 0.012}
        strokeLinejoin="round"
      />
      {open && (
        <line
          x1={end.x}
          y1={-end.y}
          x2={start.x}
          y2={-start.y}
          stroke="#c93a3a"
          strokeWidth={span * 0.008}
          strokeDasharray={`${span * 0.03} ${span * 0.02}`}
        />
      )}
      <circle cx={start.x} cy={-start.y} r={span * 0.018} fill="#1d232a" />
      {runs.map((_, i) => {
        const a = pts[i];
        const b = pts[i + 1];
        return (
          <text
            key={i}
            x={(a.x + b.x) / 2}
            y={-(a.y + b.y) / 2}
            fontSize={fontSize}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#1d232a"
            stroke="#fff"
            strokeWidth={fontSize * 0.25}
            paintOrder="stroke"
          >
            {i + 1}
          </text>
        );
      })}
    </svg>
  );
}
