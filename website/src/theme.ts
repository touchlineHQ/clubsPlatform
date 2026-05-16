import { createTheme, Tabs } from '@mantine/core';
import type { MantineColorsTuple, MantineTheme } from '@mantine/core';
import { generateShades, isHexColor, getSurfaceVars, normalizeToHex } from './utils/colorShades';

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

const DEFAULT_SECONDARY_HEX = '#1a2332';

const HEADING_FONT = '"Plus Jakarta Sans", "Inter", system-ui, -apple-system, sans-serif';
const BODY_FONT = '"Inter", system-ui, -apple-system, sans-serif';

const TABS_OVERRIDE = Tabs.extend({
  styles: {
    list: {
      flexWrap: 'nowrap',
      overflowX: 'auto',
      overflowY: 'hidden',
      scrollbarWidth: 'thin',
    },
    tab: {
      flex: '0 0 auto',
      whiteSpace: 'nowrap',
    },
  },
});

/**
 * Build a Mantine theme for a club.
 *
 * `primaryColor` may be a Mantine palette name ('orange', 'blue', …) for
 * back-compat with rows saved before hex picking, OR a hex string ('#f07820').
 * Hex inputs are expanded into a full 10-shade tuple and registered as the
 * named Mantine palette 'primary', so `var(--mantine-primary-color-*)` and
 * `var(--mantine-color-primary-N)` both work.
 *
 * `secondaryColor` is always treated as a hex string; if absent we fall back
 * to the dark navy from the design system so dark surfaces still themselves
 * with shades rather than hard-coded greys.
 */
export function createClubTheme(
  primaryColor: string | null | undefined = 'blue',
  secondaryColor: string | null | undefined = null,
) {
  const primaryInput = primaryColor ?? 'blue';
  const secondaryInput = normalizeToHex(secondaryColor) ?? DEFAULT_SECONDARY_HEX;

  const useHexPrimary = isHexColor(primaryInput);
  const primaryShades = useHexPrimary ? generateShades(primaryInput) : null;
  const secondaryShades = generateShades(secondaryInput);

  const colors: Record<string, MantineColorsTuple> = {
    secondary: secondaryShades,
  };

  if (useHexPrimary && primaryShades) {
    colors.primary = primaryShades;
  } else if (primaryInput === 'orange') {
    colors.orange = ORANGE_SHADES;
  }

  return createTheme({
    primaryColor: useHexPrimary ? 'primary' : primaryInput,
    colors,
    fontFamily: BODY_FONT,
    headings: {
      fontFamily: HEADING_FONT,
      fontWeight: '700',
    },
    defaultRadius: 'md',
    components: {
      Tabs: TABS_OVERRIDE,
    },
    other: {
      secondaryHex: secondaryInput,
    },
  });
}

/**
 * MantineProvider `cssVariablesResolver` — exposes a stable
 * `--cp-surface-*` set derived from the club's secondary colour so the dark
 * chrome (sidebar, mobile header) adapts whether the secondary is dark navy,
 * white, or any colour in between.
 */
export function clubCssVariablesResolver(theme: MantineTheme) {
  const secondaryHex = (theme.other?.secondaryHex as string | undefined) ?? DEFAULT_SECONDARY_HEX;
  return {
    variables: getSurfaceVars(secondaryHex),
    light: {},
    dark: {},
  };
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
    components: {
      Tabs: TABS_OVERRIDE,
    },
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
