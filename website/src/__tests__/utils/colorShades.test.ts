import { describe, it, expect } from 'vitest';
import { generateShades, normalizeToHex, isHexColor, hexLuminance, getSurfaceVars } from '../../utils/colorShades';

describe('isHexColor', () => {
  it('accepts 6-digit hex with or without #', () => {
    expect(isHexColor('#f07820')).toBe(true);
    expect(isHexColor('f07820')).toBe(true);
  });
  it('accepts 3-digit hex shorthand', () => {
    expect(isHexColor('#abc')).toBe(true);
  });
  it('rejects non-hex strings and empty values', () => {
    expect(isHexColor('orange')).toBe(false);
    expect(isHexColor('')).toBe(false);
    expect(isHexColor(null)).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });
});

describe('normalizeToHex', () => {
  it('maps Mantine palette names to a representative hex', () => {
    expect(normalizeToHex('orange')).toBe('#f07820');
    expect(normalizeToHex('blue')).toBe('#228be6');
  });
  it('expands 3-digit hex to 6-digit', () => {
    expect(normalizeToHex('#abc')).toBe('#aabbcc');
  });
  it('returns null for unknown / invalid input', () => {
    expect(normalizeToHex(null)).toBeNull();
    expect(normalizeToHex('not-a-colour')).toBeNull();
  });
});

describe('generateShades', () => {
  it('returns a 10-step tuple', () => {
    expect(generateShades('#f07820')).toHaveLength(10);
  });
  it('places the input hex at index 6 (Mantine primary slot)', () => {
    expect(generateShades('#f07820')[6]).toBe('#f07820');
  });
  it('accepts Mantine palette names as input', () => {
    const shades = generateShades('orange');
    expect(shades[6]).toBe('#f07820');
  });
  it('falls back to a default when input is invalid', () => {
    const shades = generateShades('not-a-colour');
    expect(shades).toHaveLength(10);
    expect(shades[6]).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('hexLuminance', () => {
  it('returns ~1 for white', () => {
    expect(hexLuminance('#ffffff')).toBeCloseTo(1, 2);
  });
  it('returns ~0 for black', () => {
    expect(hexLuminance('#000000')).toBeCloseTo(0, 2);
  });
});

describe('getSurfaceVars', () => {
  it('returns dark surface colour and white text when secondary is dark navy', () => {
    const v = getSurfaceVars('#1a2332');
    expect(v['--cp-surface']).toBe('#1a2332');
    expect(v['--cp-surface-text']).toBe('#ffffff');
    // light overlay (white at low alpha) since text is white
    expect(v['--cp-surface-hover']).toMatch(/rgba\(255,255,255,/);
  });

  it('returns white surface colour and dark text when secondary is white', () => {
    const v = getSurfaceVars('#ffffff');
    expect(v['--cp-surface']).toBe('#ffffff');
    expect(v['--cp-surface-text']).toBe('#0f172a');
    // dark overlay (text colour at low alpha) for hover, so it shows on white
    expect(v['--cp-surface-hover']).toMatch(/rgba\(15,23,42,/);
  });

  it('falls back to the design-system dark navy when input is missing', () => {
    const v = getSurfaceVars(null);
    expect(v['--cp-surface']).toBe('#1a2332');
    expect(v['--cp-surface-text']).toBe('#ffffff');
  });

  it('exposes every variable the chrome needs', () => {
    const v = getSurfaceVars('#f07820');
    expect(Object.keys(v)).toEqual(expect.arrayContaining([
      '--cp-surface', '--cp-surface-end', '--cp-surface-text',
      '--cp-surface-text-dim', '--cp-surface-text-faint', '--cp-surface-text-ghost',
      '--cp-surface-hover', '--cp-surface-active', '--cp-surface-border', '--cp-surface-card',
    ]));
  });
});
