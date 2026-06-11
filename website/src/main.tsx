import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, Alert } from '@mantine/core';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import App from './App';
import { theme } from './theme';
import { init } from './lib/posthog';
import { PostHogProvider, PostHogErrorBoundary } from '@posthog/react';

init();

function ErrorFallback() {
  return (
    <Alert color="red" title="Something went wrong" m="md">
      An unexpected error occurred. Please refresh the page or try again later.
    </Alert>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PostHogProvider
      apiKey={import.meta.env.VITE_POSTHOG_API_KEY}
      options={{
        api_host: import.meta.env.VITE_POSTHOG_HOST,
      }}
    >
      <PostHogErrorBoundary fallback={<ErrorFallback />}>
        {/* Outer provider supplies defaults (including the loading spinner colour).
            App.tsx wraps content in a nested provider once club data is loaded. */}
        <MantineProvider theme={theme}>
          <App />
        </MantineProvider>
      </PostHogErrorBoundary>
    </PostHogProvider>
  </React.StrictMode>
);
