import { describe, expect, it } from 'vitest';
import { mmPerUnit, sheetPlacement, sheetToModel, viewForKind, type Bounds, type Calibration } from './calibration';

const FT = 304.8;
// 1/4" = 1'-0": 18 PDF units (1/4 inch) per foot.
const cal: Calibration = { page: 1, a: { x: 100, y: 500 }, b: { x: 100 + 38.1667 * 18, y: 500 }, mm: 38.1667 * FT };
const bounds: Bounds = { minX: 0, maxX: 38.1667 * FT, minY: 0, maxY: 39.125 * FT };

describe('plan calibration', () => {
  it('gets the scale from two points and a length', () => {
    expect(mmPerUnit(cal)).toBeCloseTo(FT / 18, 6);
  });

  it('ties A to the front-left corner on a floor plan, with up the sheet going to the back', () => {
    expect(sheetToModel('top', cal, bounds, cal.a)).toEqual({ x: 0, y: 0, z: 0 });
    const tenFeetUp = sheetToModel('top', cal, bounds, { x: 100, y: 500 - 180 });
    expect(tenFeetUp.y).toBeCloseTo(10 * FT, 3);
    expect(sheetToModel('top', cal, bounds, cal.b).x).toBeCloseTo(bounds.maxX, 3);
  });

  it('reads heights up an elevation, from grade', () => {
    const roof = sheetToModel('front', cal, bounds, { x: 100, y: 500 - 22.333 * 18 });
    expect(roof.z).toBeCloseTo(22.333 * FT, 2);
    expect(roof.x).toBeCloseTo(0);
  });

  it('runs the back and side elevations the way you see them', () => {
    // Seen from the back, the left end of the drawing is the right side of the house.
    expect(sheetToModel('back', cal, bounds, cal.a).x).toBeCloseTo(bounds.maxX);
    // Seen from the left, the left end of the drawing is the back.
    expect(sheetToModel('left', cal, bounds, cal.a).y).toBeCloseTo(bounds.maxY);
    expect(sheetToModel('right', cal, bounds, cal.a).y).toBeCloseTo(0);
  });

  it('places the whole sheet around its centre', () => {
    const s = sheetPlacement('top', cal, bounds, 1224, 792);
    expect(s.width).toBeCloseTo((1224 * FT) / 18, 3);
    expect(s.center.x).toBeCloseTo(((612 - 100) * FT) / 18, 3);
  });

  it('knows which sheets can be laid over the model', () => {
    expect(viewForKind('ground-floor')).toBe('top');
    expect(viewForKind('elevation-left')).toBe('left');
    expect(viewForKind('section')).toBeNull();
  });
});
