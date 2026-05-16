import type { MantineColorsTuple } from '@mantine/core';

const NAMED_COLOR_HEX: Record<string, string> = {
  red: '#fa5252',
  pink: '#e64980',
  grape: '#be4bdb',
  violet: '#7950f2',
  indigo: '#4c6ef5',
  blue: '#228be6',
  cyan: '#15aabf',
  teal: '#12b886',
  green: '#40c057',
  lime: '#82c91e',
  yellow: '#fab005',
  orange: '#f07820',
};

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: string | null | undefined): boolean {
  return !!value && HEX_RE.test(value.trim());
}

export function normalizeToHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (NAMED_COLOR_HEX[trimmed]) return NAMED_COLOR_HEX[trimmed];
  if (!HEX_RE.test(trimmed)) return null;
  let hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  return `#${hex}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map(n => clamp(n).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rN = r / 255, gN = g / 255, bN = b / 255;
  const max = Math.max(rN, gN, bN), min = Math.min(rN, gN, bN);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case rN: h = ((gN - bN) / d + (gN < bN ? 6 : 0)) / 6; break;
    case gN: h = ((bN - rN) / d + 2) / 6; break;
    default: h = ((rN - gN) / d + 4) / 6;
  }
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hN = (h % 360 + 360) % 360 / 360;
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    hue2rgb(hN + 1 / 3) * 255,
    hue2rgb(hN) * 255,
    hue2rgb(hN - 1 / 3) * 255,
  ];
}

/**
 * Generate a Mantine 10-shade tuple from a base hex.
 *
 * Shade 6 is the input colour; shades 0–5 lighten progressively, shades 7–9
 * darken. Saturation is gently lowered at the lightest end to avoid pastels
 * looking like sickly tints, and lifted slightly in the dark range so the
 * deepest shade stays vivid.
 */
export function generateShades(input: string): MantineColorsTuple {
  const hex = normalizeToHex(input) ?? '#228be6';
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);

  // Target lightness for each Mantine shade index (Mantine convention: 6 is the
  // primary, lower indices are lighter, higher are darker).
  const targetLightness = [0.96, 0.91, 0.82, 0.72, 0.62, 0.52, l, Math.max(0.06, l * 0.78), Math.max(0.05, l * 0.6), Math.max(0.04, l * 0.45)];
  const targetSaturation = [s * 0.55, s * 0.7, s * 0.85, s * 0.95, s, s, s, Math.min(1, s * 1.05), Math.min(1, s * 1.1), Math.min(1, s * 1.15)];

  const out = targetLightness.map((tl, i) => {
    const ts = i === 6 ? s : targetSaturation[i];
    const [rr, gg, bb] = hslToRgb(h, ts, tl);
    return rgbToHex(rr, gg, bb);
  });
  out[6] = hex;
  return out as unknown as MantineColorsTuple;
}
