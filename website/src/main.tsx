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
      apiKey="phc_CfHQ76a3hqCFjLJKDvvFaowTsnRiUAFCubTvbvzUpzaD"
      options={{
        api_host: 'https://p.touchlinehq.co.uk',
      }}
    >
      <PostHogErrorBoundary fallback={<ErrorFallback />}>
        <MantineProvider theme={theme}>
          <App />
        </MantineProvider>
      </PostHogErrorBoundary>
    </PostHogProvider>
  </React.StrictMode>
);
