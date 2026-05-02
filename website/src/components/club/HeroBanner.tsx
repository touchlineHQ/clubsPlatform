import type { CSSProperties, ReactNode } from 'react';
import { Box } from '@mantine/core';
import { clubDesign } from '../../theme';

interface HeroBannerProps {
  children: ReactNode;
  /** Adds a soft accent-coloured circular glow to the top-right corner. */
  accentGlow?: boolean;
  style?: CSSProperties;
  padding?: number | string;
}

/**
 * Dark navy gradient hero used by the home page, news featured card, and other
 * spotlight sections in the design system. The accent glow uses the active
 * Mantine primary colour so it adapts to per-club theming.
 */
export function HeroBanner({
  children,
  accentGlow = true,
  style,
  padding,
}: HeroBannerProps) {
  return (
    <Box
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: clubDesign.gradient.dark,
        color: '#fff',
        borderRadius: clubDesign.radius.card,
        padding: padding ?? '32px 32px 28px',
        ...style,
      }}
    >
      {accentGlow && (
        <Box
          aria-hidden
          style={{
            position: 'absolute',
            top: -60,
            right: -60,
            width: 240,
            height: 240,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, var(--mantine-primary-color-filled) 0%, transparent 70%)',
            opacity: 0.18,
            pointerEvents: 'none',
          }}
        />
      )}
      <div style={{ position: 'relative' }}>{children}</div>
    </Box>
  );
}
