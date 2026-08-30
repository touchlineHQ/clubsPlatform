import React from 'react';
import ReactDOM from 'react-dom/client';
import posthog from 'posthog-js';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import App from './App';
import { theme } from './theme';
import { init } from './lib/posthog';
import { ErrorFallback } from './components/ErrorFallback';
import { PostHogProvider, PostHogErrorBoundary } from '@posthog/react';

init();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* `client` rather than `apiKey`: init() above already configured the
        singleton. Passing an apiKey here made the provider run its own
        initialisation path, and because the VITE_ vars were undefined at build
        time it fell through to the global with a console warning. */}
    <PostHogProvider client={posthog}>
      {/* MantineProvider must sit OUTSIDE the error boundary so the fallback
          can still render after a fault below it. App.tsx nests another
          provider once club data is loaded; this outer one supplies defaults
          such as the loading spinner colour. */}
      <MantineProvider theme={theme}>
        <PostHogErrorBoundary fallback={<ErrorFallback />}>
          <App />
        </PostHogErrorBoundary>
      </MantineProvider>
    </PostHogProvider>
  </React.StrictMode>
);
