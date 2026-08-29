/**
 * Last-resort UI rendered by the top-level error boundary.
 *
 * Deliberately plain markup with inline styles: this renders *because*
 * something below it threw, so it must not depend on any provider, theme or
 * component library. A Mantine <Alert> here previously threw "MantineProvider
 * was not found in component tree" on top of the original error — the boundary
 * sat outside MantineProvider — turning a recoverable fault into a blank page.
 *
 * Keep this component dependency-free.
 */
export function ErrorFallback() {
  return (
    <div
      role="alert"
      style={{
        margin: '1rem',
        padding: '1rem 1.25rem',
        border: '1px solid #f0b4a8',
        borderRadius: 8,
        background: '#fdf1ee',
        color: '#7a2617',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        lineHeight: 1.5,
      }}
    >
      <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Something went wrong</strong>
      An unexpected error occurred. Please refresh the page or try again later.
    </div>
  );
}
