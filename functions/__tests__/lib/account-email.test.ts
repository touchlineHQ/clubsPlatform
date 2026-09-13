import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  invitationMessage,
  resetPasswordMessage,
  verifyEmailMessage,
} from '../../lib/account-email';

const LINK = 'https://clubs.example/east-leake/#/reset-password?token=abc123';

describe('escapeHtml', () => {
  it('escapes everything that could open a tag or close an attribute', () => {
    expect(escapeHtml(`<script>"x"&'y'`))
      .toBe('&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;');
  });
});

describe('every message', () => {
  const messages = [
    ['reset', resetPasswordMessage('East Leake FC', LINK)],
    ['verify', verifyEmailMessage('East Leake FC', LINK)],
    ['invitation', invitationMessage('East Leake FC', LINK, 7)],
  ] as const;

  for (const [name, message] of messages) {
    it(`${name}: carries the link in both the HTML and the plain text`, () => {
      // Plenty of parents read mail as plain text, and filters distrust
      // HTML-only messages.
      expect(message.html).toContain(LINK);
      expect(message.text).toContain(LINK);
    });

    it(`${name}: names the club in the subject`, () => {
      expect(message.subject).toContain('East Leake FC');
    });

    it(`${name}: keeps the subject to a single line`, () => {
      expect(message.subject).not.toMatch(/[\r\n]/);
    });
  }
});

describe('club names are admin-editable text', () => {
  it('never lands raw in the HTML body', () => {
    const message = resetPasswordMessage('<img src=x onerror=alert(1)>', LINK);
    expect(message.html).not.toContain('<img');
    expect(message.html).toContain('&lt;img');
  });
});

describe('invitation wording', () => {
  it('says where the account came from, since the reader never asked for it', () => {
    const message = invitationMessage('East Leake FC', LINK, 7);
    expect(message.text).toMatch(/registration records/i);
  });

  it('states the expiry, and says day rather than days for one', () => {
    expect(invitationMessage('C', LINK, 7).text).toContain('7 days');
    expect(invitationMessage('C', LINK, 1).text).toContain('1 day');
  });
});
