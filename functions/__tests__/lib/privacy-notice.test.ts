import { describe, expect, it } from 'vitest';
import { buildPrivacyNotice } from '../../lib/privacy-notice';

describe('buildPrivacyNotice', () => {
  it('names the club as controller and touchlineHQ as processor', () => {
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
    expect(notice.processor.name).toBe('touchlineHQ');
    expect(notice.purposes.some((p) => p.basis === 'Consent')).toBe(true);
    expect(notice.purposes.some((p) => /Membership/.test(p.purpose) && p.basis === 'Contract')).toBe(true);
    expect(notice.rights.length).toBeGreaterThan(3);
    expect(notice.retention.length).toBeGreaterThan(3);
    expect(notice.marketingConsent.toLowerCase()).toContain('consent');
    expect(notice.icoFeeNote.toLowerCase()).toContain('ico');
  });

  it('tolerates missing email and address', () => {
    const notice = buildPrivacyNotice({ slug: 'quiet-fc', name: 'Quiet FC' });
    expect(notice.controller.email).toBeNull();
    expect(notice.controller.address).toBeNull();
  });
});
