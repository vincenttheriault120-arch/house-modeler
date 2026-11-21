import { describe, expect, it } from 'vitest';
import { inkToAlpha } from './planTexture';

describe('inkToAlpha', () => {
  it('drops white paper and keeps dark lines opaque in the line colour', () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255]);
    inkToAlpha(px, [1, 2, 3]);
    expect(Array.from(px.slice(0, 4))).toEqual([1, 2, 3, 0]);
    expect(Array.from(px.slice(4, 8))).toEqual([1, 2, 3, 255]);
    expect(px[11]).toBeGreaterThan(150);
    expect(px[11]).toBeLessThan(255);
  });
});
