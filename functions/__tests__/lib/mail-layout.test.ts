import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { applyMailLayout, FOOTER_MARKER, renderFooter } from '../../lib/mail-layout';
import { getMailer, withMailLayout, type ProviderMessage } from '../../lib/email';

describe('mail footer (#135)', () => {
  it('transactional mail names the club and offers no false unsubscribe', () => {
    const f = renderFooter({ kind: 'transactional', clubName: 'Test FC', preferencesUrl: 'https://x/prefs' });
    expect(f.html).toContain('Sent by Test FC');
    expect(f.html).toContain('no unsubscribe');
    expect(f.html).toContain('https://x/prefs');
    expect(f.text).toContain('https://x/prefs');
    expect(f.headers).toEqual({});
    const bare = renderFooter({ kind: 'transactional', clubName: '' });
    expect(bare.html).toContain('Sent by Your club');
    expect(bare.html).not.toContain('preferences');
  });

  it('operational and marketing carry RFC 8058 headers and say which kind they are', () => {
    const op = renderFooter({ kind: 'operational', clubName: 'Test FC', unsubscribeUrl: 'https://x/u?t=1' });
    expect(op.headers).toEqual({
      'List-Unsubscribe': '<https://x/u?t=1>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(op.html).toContain('not marketing');
    const mk = renderFooter({ kind: 'marketing', clubName: 'A & B <FC>', unsubscribeUrl: 'https://x/u?t=1&b=2' });
    expect(mk.html).toContain('A &amp; B &lt;FC&gt;');
    expect(mk.html).toContain('https://x/u?t=1&amp;b=2');
    expect(mk.text).toContain('safety messages are not affected');
  });

  it('strips CR/LF from the header URL', () => {
    const f = renderFooter({ kind: 'marketing', clubName: 'C', unsubscribeUrl: 'https://x/u\r\nBcc: e@x' });
    expect(f.headers['List-Unsubscribe']).toBe('<https://x/uBcc: e@x>');
  });

  it('inserts before </body> in a document and appends to fragments', () => {
    const footer = { kind: 'transactional' as const, clubName: 'C' };
    const doc = applyMailLayout({ html: '<html><body><p>Hi</p></BODY></html>', text: 'Hi\n\n', footer });
    expect(doc.html.indexOf(FOOTER_MARKER)).toBeLessThan(doc.html.indexOf('</BODY>'));
    expect(doc.text).toMatch(/^Hi\n\n--\nSent by C/);
    const frag = applyMailLayout({ html: '<p>Hi</p>', text: 'Hi', footer });
    expect(frag.html.startsWith('<p>Hi</p>')).toBe(true);
    expect(frag.html).toContain(FOOTER_MARKER);
  });

  it('getMailer always delivers the footer and headers to the provider', async () => {
    const fetchMock = async (_url: string, init: RequestInit) =>
      new Response(JSON.stringify({ id: 'r1', echo: init.body }), { status: 200 });
    const calls: string[] = [];
    const mailer = getMailer(
      { RESEND_API_KEY: 'k', FROM_EMAIL: 'club@mail.example' },
      { fetch: (async (url: string, init: RequestInit) => { calls.push(String(init.body)); return fetchMock(url, init); }) as unknown as typeof fetch },
    );
    await mailer!.send({
      to: 'p@example.com', subject: 'S', html: '<p>B</p>', text: 'B',
      footer: { kind: 'marketing', clubName: 'Test FC', unsubscribeUrl: 'https://x/u' },
    });
    const body = JSON.parse(calls[0]);
    expect(body.html).toContain(FOOTER_MARKER);
    expect(body.text).toContain('Unsubscribe from club marketing');
    expect(body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('withMailLayout passes a laid-out message to any provider', async () => {
    const seen: ProviderMessage[] = [];
    const mailer = withMailLayout({ send: async (m) => { seen.push(m); return {}; } });
    await mailer.send({ to: 'a@b.c', subject: 's', html: 'h', text: 't', footer: { kind: 'transactional', clubName: 'C' } });
    expect(seen[0].html).toContain(FOOTER_MARKER);
    expect(seen[0].headers).toEqual({});
  });
});

/**
 * Structural guarantee: no send path can produce a message without the footer.
 * Footer is a required field on OutboundMessage (the typecheck enforces it),
 * and the only Mailer anyone can obtain is getMailer()'s layout-wrapped one —
 * so the raw provider must never be imported outside lib/email.ts.
 */
describe('no send path bypasses the layout', () => {
  const ROOT = resolve(__dirname, '../..');
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (name === '__tests__' || name === 'node_modules') return [];
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
  }
  const files = walk(ROOT);

  it('only lib/email.ts reaches a raw provider', () => {
    const offenders = files
      .filter((f) => /from\s+["'][^"']*mailers\//.test(readFileSync(f, 'utf8')) || /createResendMailer\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f))
      .filter((f) => f !== 'lib/email.ts' && !f.startsWith('lib/mailers/'));
    expect(offenders).toEqual([]);
  });

  it('every .send( call to a mailer passes a footer', () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const re = /mailer!?\.send\(\{([\s\S]*?)\}\);/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (!/footer/.test(m[1])) missing.push(relative(ROOT, f));
      }
      if (/mailer!?\.send\((?!\{)(\w+)\)/.test(src) && !/footer[,:]/.test(src)) missing.push(relative(ROOT, f));
    }
    expect(missing).toEqual([]);
  });
});
