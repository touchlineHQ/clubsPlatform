import { describe, expect, it } from 'vitest';
import { buildPrivacyNotice } from '../../lib/privacy-notice';

describe('buildPrivacyNotice', () => {
  it('names the club as controller and lists held / not-held aligned with DATA_PROTECTION', () => {
    const notice = buildPrivacyNotice({
      slug: 'riverside-fc',
      name: 'Riverside FC',
      email: 'secretary@riverside.example',
      address: { line1: '1 Pitch Lane', line2: 'Riverside', postcode: 'RS1 1AA' },
    });

    expect(notice.controller.name).toBe('Riverside FC');
    expect(notice.controller.clubSlug).toBe('riverside-fc');
    expect(notice.controller.email).toBe('secretary@riverside.example');
    expect(notice.controller.address).toContain('RS1 1AA');
    expect(notice.hosting.name).toBe('touchlineHQ');
    expect(notice.processor.name).toBe('touchlineHQ');
    expect(notice.held.some((h) => /FAN/i.test(h))).toBe(true);
    expect(notice.held.some((h) => /admin/i.test(h))).toBe(true);
    expect(notice.held.some((h) => /committee/i.test(h))).toBe(true);
    expect(notice.notHeld).toEqual(expect.arrayContaining([
      expect.stringMatching(/Date of birth/i),
      expect.stringMatching(/Phone/i),
      expect.stringMatching(/Medical/i),
      expect.stringMatching(/Safeguarding/i),
    ]));
    expect(notice.payments.toLowerCase()).toContain('gocardless');
    expect(notice.payments.toUpperCase()).toContain('FAN');
    expect(notice.howToContact).toContain('secretary@riverside.example');
    expect(notice.howToContact.toLowerCase()).toMatch(/correct|delete/);
    expect(notice.purposes.some((p) => p.basis === 'Consent')).toBe(true);
    expect(notice.purposes.some((p) => /Membership/.test(p.purpose) && p.basis === 'Contract')).toBe(true);
    expect(notice.rights.length).toBeGreaterThan(3);
    expect(notice.retention.length).toBeGreaterThan(3);
    expect(notice.icoFeeNote.toLowerCase()).toContain('ico');
    expect(notice.icoFeeNote.toLowerCase()).toMatch(/one real club|self-serve|allow_club_self_register/);
  });

  it.each([
    {},
    { email: '  ', address: { line1: ' ', postcode: '' } },
  ])('still returns a notice when contact details are absent or blank', (details) => {
    const notice = buildPrivacyNotice({ slug: 'quiet-fc', name: 'Quiet FC', ...details });
    expect(notice.controller.name).toBe('Quiet FC');
    expect(notice.controller.email).toBeNull();
    expect(notice.howToContact.toLowerCase()).toMatch(/contact page|club official/);
  });

  it.each([
    { email: 'sec@example.test' },
    { address: { line1: '1 Road' } },
  ])('includes whichever controller contact route is present', (details) => {
    const notice = buildPrivacyNotice({ slug: 'quiet-fc', name: 'Quiet FC', ...details });
    expect(notice.controller.name).toBe('Quiet FC');
    if ('email' in details) {
      expect(notice.controller.email).toBe('sec@example.test');
      expect(notice.howToContact).toContain('sec@example.test');
    } else {
      expect(notice.controller.address).toContain('1 Road');
    }
  });
});
