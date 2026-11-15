import { useEffect, useState } from 'react';
import { formatLength, parseLength, type UnitSystem } from './units';

interface Props {
  label: string;
  valueMm: number;
  units: UnitSystem;
  onChange: (mm: number) => void;
  min?: number;
  ariaLabel?: string;
}

/**
 * A text field for a length. Shows the value in the current units and accepts
 * either system when typing (e.g. 8' 6", 2600 mm, 2.6 m).
 */
export function LengthInput({ label, valueMm, units, onChange, min, ariaLabel }: Props) {
  const [text, setText] = useState(formatLength(valueMm, units));
  const [error, setError] = useState(false);

  // Re-display when the value or unit system changes from outside.
  useEffect(() => {
    setText(formatLength(valueMm, units));
    setError(false);
  }, [valueMm, units]);

  function commit() {
    const mm = parseLength(text, units);
    if (mm === null || (min !== undefined && mm < min)) {
      setError(true);
      return;
    }
    setError(false);
    onChange(mm);
    setText(formatLength(mm, units));
  }

  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <input
        aria-label={label || ariaLabel}
        className={error ? 'invalid' : undefined}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(formatLength(valueMm, units));
            setError(false);
          }
        }}
        aria-invalid={error}
      />
      {error && (
        <span className="field-error">
          {units === 'imperial' ? `Try 8' 6 1/2" or 102"` : 'Try 2600 mm or 2.6 m'}
        </span>
      )}
    </label>
  );
}
