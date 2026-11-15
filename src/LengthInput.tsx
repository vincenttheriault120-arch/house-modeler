import { useEffect, useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { formatLength, parseLength, type UnitSystem } from './units';

interface Props {
  label: string;
  valueMm: number;
  units: UnitSystem;
  onChange: (mm: number) => void;
  min?: number;
  ariaLabel?: string;
  hint?: string;
  className?: string;
}

/**
 * A text field for a length. Shows the value in the current units and accepts
 * either system when typing (e.g. 8' 6", 2600 mm, 2.6 m).
 */
export function LengthInput({ label, valueMm, units, onChange, min, ariaLabel, hint, className }: Props) {
  const id = useId();
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
    <div className={cn('grid gap-1.5', className)}>
      {label && (
        <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
          {label}
        </Label>
      )}
      <Input
        id={id}
        aria-label={label || ariaLabel}
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
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
        className="h-8 tabular-nums"
      />
      {error ? (
        <span className="text-xs text-destructive">
          {units === 'imperial' ? `Try 8' 6 1/2" or 102"` : 'Try 2600 mm or 2.6 m'}
        </span>
      ) : (
        hint && <span className="text-[11px] text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}
