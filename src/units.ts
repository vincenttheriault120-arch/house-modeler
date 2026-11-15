/**
 * Units.
 *
 * Every length in the model is stored in MILLIMETRES. Unit systems only
 * change how numbers are shown and typed, never the model itself.
 */

export type UnitSystem = 'metric' | 'imperial';

export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;

/** Smallest imperial fraction we display: 1/16". */
const IMPERIAL_DENOMINATOR = 16;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Format a length (mm) for display, e.g. 2438.4 -> `8' 0"` or `2438 mm`. */
export function formatLength(mm: number, system: UnitSystem): string {
  if (!Number.isFinite(mm)) return '';
  if (system === 'metric') {
    const rounded = Math.round(mm);
    return `${rounded.toLocaleString('en-US').replace(/,/g, ' ')} mm`;
  }

  const sign = mm < 0 ? '-' : '';
  // Work in 1/16ths of an inch so rounding carries correctly into feet.
  const sixteenths = Math.round((Math.abs(mm) / MM_PER_INCH) * IMPERIAL_DENOMINATOR);
  const totalInches = Math.floor(sixteenths / IMPERIAL_DENOMINATOR);
  let num = sixteenths % IMPERIAL_DENOMINATOR;
  let den = IMPERIAL_DENOMINATOR;
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;

  let fraction = '';
  if (num > 0) {
    const g = gcd(num, den);
    num /= g;
    den /= g;
    fraction = ` ${num}/${den}`;
  }

  if (feet === 0) return `${sign}${inches}${fraction}"`;
  return `${sign}${feet}' ${inches}${fraction}"`;
}

/**
 * Parse what a person typed into a length in mm. Returns null if it can't
 * be understood.
 *
 * Accepts, in either unit system:
 *   metric:   2400, 2400mm, 240 cm, 2.4 m
 *   imperial: 8', 8' 6", 8'6 1/2", 8 ft 6 in, 102", 6 1/2", 3/4"
 * A bare number with no unit uses the current system: mm for metric,
 * inches for imperial.
 */
export function parseLength(input: string, system: UnitSystem): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (s === '') return null;

  const sign = s.startsWith('-') ? -1 : 1;
  const body = s.replace(/^-\s*/, '');

  // Metric with explicit unit.
  // Allow digit grouping with spaces, as we display it ("2 438 mm").
  const metric = body.replace(/(\d) (?=\d{3}(?!\d|\/))/g, '$1').match(/^(\d+(?:\.\d+)?|\.\d+) ?(mm|cm|m)$/);
  if (metric) {
    const v = parseFloat(metric[1]);
    const factor = metric[2] === 'm' ? 1000 : metric[2] === 'cm' ? 10 : 1;
    return sign * v * factor;
  }

  // Bare number: current system's base unit.
  if (/^(\d+(?:\.\d+)?|\.\d+)$/.test(body)) {
    const v = parseFloat(body);
    return sign * (system === 'metric' ? v : v * MM_PER_INCH);
  }

  // Imperial: optional feet part, optional inches part (whole, fraction, or both).
  const imperial = body.match(
    /^(?:(\d+(?:\.\d+)?) ?(?:'|ft|feet|foot) ?-? ?)?(?:(\d+(?:\.\d+)?)?(?: ?(\d+)\/(\d+))? ?(?:"|''|in|inch|inches)?)?$/,
  );
  if (imperial) {
    const [, ft, inWhole, fNum, fDen] = imperial;
    if (ft === undefined && inWhole === undefined && fNum === undefined) return null;
    // A bare fraction or "whole fraction" without a unit marker is inches.
    let inches = 0;
    if (inWhole !== undefined) inches += parseFloat(inWhole);
    if (fNum !== undefined && fDen !== undefined) {
      const d = parseInt(fDen, 10);
      if (d === 0) return null;
      inches += parseInt(fNum, 10) / d;
    }
    const feet = ft !== undefined ? parseFloat(ft) : 0;
    return sign * (feet * MM_PER_FOOT + inches * MM_PER_INCH);
  }

  return null;
}
