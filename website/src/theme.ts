import { createTheme } from '@mantine/core';
import type { MantineColorsTuple } from '@mantine/core';

const ORANGE_SHADES: MantineColorsTuple = [
  '#fff4eb',
  '#ffe8d2',
  '#ffd0a8',
  '#ffb578',
  '#f89445',
  '#f07820',
  '#e96a1a',
  '#c85510',
  '#a8440d',
  '#8a350b',
];

const HEADING_FONT = '"Plus Jakarta Sans", "Inter", system-ui, -apple-system, sans-serif';
const BODY_FONT = '"Inter", system-ui, -apple-system, sans-serif';

export function createClubTheme(primaryColor = 'blue') {
  return createTheme({
    primaryColor,
    ...(primaryColor === 'orange' ? { colors: { orange: ORANGE_SHADES } } : {}),
    fontFamily: BODY_FONT,
    headings: {
      fontFamily: HEADING_FONT,
      fontWeight: '700',
    },
    defaultRadius: 'md',
  });
}

export function createLandingTheme() {
  return createTheme({
    primaryColor: 'orange',
    colors: { orange: ORANGE_SHADES },
    fontFamily: BODY_FONT,
    headings: {
      fontFamily: HEADING_FONT,
      fontWeight: '700',
    },
    defaultRadius: 'md',
  });
}

export const theme = createClubTheme();

/* Shared design tokens used by club page redesigned components.
   Mirrors the design system palette: dark navy gradients, neutral surfaces,
   rounded radii and consistent fonts. */
export const clubDesign = {
  font: {
    heading: HEADING_FONT,
    body: BODY_FONT,
  },
  color: {
    dark: '#1a2332',
    dark2: '#273347',
    dark3: '#2d3d52',
    n1: '#f8fafc',
    n2: '#f1f5f9',
    n3: '#e2e8f0',
    n4: '#cbd5e1',
    n5: '#94a3b8',
    n6: '#64748b',
    n7: '#475569',
    n8: '#334155',
    n9: '#1e293b',
  },
  gradient: {
    dark: 'linear-gradient(135deg, #1a2332 0%, #273347 100%)',
  },
  radius: {
    card: 14,
    pill: 9999,
  },
} as const;
