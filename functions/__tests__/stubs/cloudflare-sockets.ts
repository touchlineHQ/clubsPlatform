import type { Socket, SocketAddress, SocketOptions } from '@cloudflare/workers-types';

/**
 * Stands in for the `cloudflare:sockets` built-in under vitest, which has no
 * such module. Aliased in `vitest.config.ts`.
 *
 * It throws rather than pretending to work: every test that reaches SMTP passes
 * its own scripted `connect`, so an actual call here means a test is about to
 * open a real socket, and failing loudly is the point.
 */
export function connect(_address: string | SocketAddress, _options?: SocketOptions): Socket {
  throw new Error(
    'cloudflare:sockets is not available under vitest — pass a scripted connect() ' +
    'to sendSmtpMessage()/getMailer(). See functions/__tests__/lib/fake-smtp-socket.ts.',
  );
}
