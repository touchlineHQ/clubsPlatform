import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { OnboardingChecklist } from '../../../components/customize/OnboardingChecklist';
import { PublishToggle } from '../../../components/customize/PublishToggle';
import { renderWithMantine, mockSingleClub } from '../../test-utils';
import { captureEvent } from '../../../lib/posthog';
import type { OnboardingStep } from '../../../utils/onboarding';

vi.mock('../../../lib/posthog', () => ({ captureError: vi.fn(), captureEvent: vi.fn() }));

const steps = (overrides: Partial<Record<OnboardingStep['id'], boolean>> = {}): OnboardingStep[] =>
  (['branding', 'teams', 'fixtures', 'committee', 'channel', 'news', 'live'] as const).map(id => ({
    id, label: `Step ${id}`, hint: 'somewhere', done: overrides[id] ?? false,
  }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(captureEvent).mockClear();
});

describe('OnboardingChecklist (#85)', () => {
  it('shows live completion state', () => {
    renderWithMantine(<OnboardingChecklist steps={steps({ branding: true })} />, { clubValue: mockSingleClub });
    expect(screen.getByText('1 of 7 done')).toBeTruthy();
    expect(screen.getByTestId('onboarding-step-branding').getAttribute('data-done')).toBe('true');
    expect(screen.getByTestId('onboarding-step-teams').getAttribute('data-done')).toBe('false');
    expect(screen.getByText(/second admin to your WhatsApp Channel/i)).toBeTruthy();
    expect(screen.getByText(/Register with the ICO/i)).toBeTruthy();
  });

  it('renders nothing once every step is done', () => {
    const all = Object.fromEntries(steps().map(s => [s.id, true]));
    renderWithMantine(<OnboardingChecklist steps={steps(all)} />, { clubValue: mockSingleClub });
    expect(screen.queryByText(/Get your club site ready/)).toBeNull();
  });

  it('hides when dismissed, remembers it per club, and reports the dismissal', () => {
    const { unmount } = renderWithMantine(<OnboardingChecklist steps={steps()} />, { clubValue: mockSingleClub });
    fireEvent.click(screen.getByRole('button', { name: /Hide checklist/i }));
    expect(screen.queryByText(/Get your club site ready/)).toBeNull();
    expect(captureEvent).toHaveBeenCalledWith('onboarding checklist dismissed', { club_slug: 'test-club', done_count: 0 });
    unmount();
    renderWithMantine(<OnboardingChecklist steps={steps()} />, { clubValue: mockSingleClub });
    expect(screen.queryByText(/Get your club site ready/)).toBeNull();
  });

  it('reports a step only when it flips to done during the visit', () => {
    const { rerender } = renderWithMantine(<OnboardingChecklist steps={steps({ branding: true })} />, { clubValue: mockSingleClub });
    expect(captureEvent).not.toHaveBeenCalled();
    rerender(<OnboardingChecklist steps={steps({ branding: true, news: true })} />);
    expect(captureEvent).toHaveBeenCalledTimes(1);
    expect(captureEvent).toHaveBeenCalledWith('onboarding step completed', { club_slug: 'test-club', step: 'news' });
  });
});

describe('PublishToggle with incomplete steps (#85)', () => {
  it('explains what is still incomplete while private', () => {
    renderWithMantine(
      <PublishToggle published={false} onPublishedChange={vi.fn()} incomplete={['Add committee contacts', 'Write a first news post']} />,
      { clubValue: mockSingleClub },
    );
    expect(screen.getByTestId('publish-incomplete').textContent).toContain('Add committee contacts; Write a first news post');
    expect(screen.getByRole('button', { name: /^Go live$/i })).toBeTruthy();
  });

  it('says nothing about setup once live', () => {
    renderWithMantine(
      <PublishToggle published onPublishedChange={vi.fn()} incomplete={['Add committee contacts']} />,
      { clubValue: mockSingleClub },
    );
    expect(screen.queryByTestId('publish-incomplete')).toBeNull();
  });
});
