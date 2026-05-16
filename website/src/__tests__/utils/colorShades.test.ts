import { describe, it, expect } from 'vitest';
import { generateShades, normalizeToHex, isHexColor } from '../../utils/colorShades';

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
