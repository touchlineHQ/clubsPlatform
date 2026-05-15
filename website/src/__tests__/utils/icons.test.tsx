import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import React from 'react';
import { tablerIcon } from '../../utils/icons';

function renderIcon(node: React.ReactNode) {
  return render(<MantineProvider>{node as React.ReactElement}</MantineProvider>);
}

describe('tablerIcon', () => {
  it('returns a React element for fa-star', () => {
    const icon = tablerIcon('fa-star');
    const { container } = renderIcon(icon);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('returns a React element for fa-users', () => {
    const icon = tablerIcon('fa-users');
    const { container } = renderIcon(icon);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('returns a React element for fa-home', () => {
    const icon = tablerIcon('fa-home');
    const { container } = renderIcon(icon);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('returns a React element for fa-envelope', () => {
    const icon = tablerIcon('fa-envelope');
    const { container } = renderIcon(icon);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('returns a help icon for an unknown class', () => {
    const icon = tablerIcon('fa-definitely-unknown-icon-xyz');
    const { container } = renderIcon(icon);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('accepts a custom size', () => {
    const icon = tablerIcon('fa-star', 32);
    const { container } = renderIcon(icon);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('width')).toBe('32');
  });
});
