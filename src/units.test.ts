import { describe, expect, it } from 'vitest';
import { formatLength, parseLength, MM_PER_FOOT, MM_PER_INCH } from './units';

describe('formatLength', () => {
  it('formats metric in whole millimetres', () => {
    expect(formatLength(2438.4, 'metric')).toBe('2 438 mm');
    expect(formatLength(200, 'metric')).toBe('200 mm');
  });
  it('formats imperial as feet-inches with 1/16 fractions', () => {
    expect(formatLength(8 * MM_PER_FOOT, 'imperial')).toBe(`8' 0"`);
    expect(formatLength(8 * MM_PER_FOOT + 6.5 * MM_PER_INCH, 'imperial')).toBe(`8' 6 1/2"`);
    expect(formatLength(0.75 * MM_PER_INCH, 'imperial')).toBe(`0 3/4"`);
    expect(formatLength(11.999 * MM_PER_INCH, 'imperial')).toBe(`1' 0"`);
  });
});

describe('parseLength', () => {
  const close = (a: number | null, b: number) => {
    expect(a).not.toBeNull();
    expect(a!).toBeCloseTo(b, 3);
  };
  it('parses metric', () => {
    close(parseLength('2400', 'metric'), 2400);
    close(parseLength('240 cm', 'imperial'), 2400);
    close(parseLength('2.4m', 'metric'), 2400);
  });
  it('parses imperial', () => {
    close(parseLength(`8'`, 'metric'), 8 * MM_PER_FOOT);
    close(parseLength(`8' 6"`, 'imperial'), 8 * MM_PER_FOOT + 6 * MM_PER_INCH);
    close(parseLength(`8'6 1/2"`, 'imperial'), 8 * MM_PER_FOOT + 6.5 * MM_PER_INCH);
    close(parseLength(`8 ft 6 in`, 'imperial'), 8 * MM_PER_FOOT + 6 * MM_PER_INCH);
    close(parseLength(`102"`, 'metric'), 102 * MM_PER_INCH);
    close(parseLength(`3/4"`, 'imperial'), 0.75 * MM_PER_INCH);
    close(parseLength(`6 1/2`, 'imperial'), 6.5 * MM_PER_INCH);
    close(parseLength(`102`, 'imperial'), 102 * MM_PER_INCH);
  });
  it('accepts grouped metric digits', () => {
    close(parseLength('2 438 mm', 'metric'), 2438);
  });
  it('rejects nonsense', () => {
    expect(parseLength('', 'metric')).toBeNull();
    expect(parseLength('abc', 'metric')).toBeNull();
    expect(parseLength('5/0"', 'imperial')).toBeNull();
  });
  it('round-trips', () => {
    for (const mm of [0, 12.7, 2438.4, 3000]) {
      close(parseLength(formatLength(mm, 'imperial'), 'imperial'), Math.round((mm / MM_PER_INCH) * 16) / 16 * MM_PER_INCH);
      close(parseLength(formatLength(mm, 'metric'), 'metric'), Math.round(mm));
    }
  });
});
