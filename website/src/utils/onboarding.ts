import type { AppData } from '../types';

/** One step a new club takes before its site looks live (#85). */
export interface OnboardingStep {
  id: OnboardingStepId;
  label: string;
  /** Where on Customise the admin does it. */
  hint: string;
  done: boolean;
}

export type OnboardingStepId =
  | 'branding'
  | 'teams'
  | 'fixtures'
  | 'committee'
  | 'channel'
  | 'news'
  | 'live';

const has = (s: string | null | undefined) => typeof s === 'string' && s.trim().length > 0;

/**
 * Checklist state, derived only from the club's own data (#85). Nothing here
 * is a stored "done" flag, so it cannot drift from what the site shows.
 */
export function onboardingSteps(data: AppData, published: boolean): OnboardingStep[] {
  const { club } = data;
  return [
    {
      id: 'branding',
      label: 'Upload a club badge and set colours',
      hint: 'Club Info tab',
      done: has(club.badge) && has(club.primaryColor),
    },
    {
      id: 'teams',
      label: 'Add a team section and at least one team',
      hint: 'Teams tab',
      done: data.teams.sections.some(s => s.teams.length > 0),
    },
    {
      id: 'fixtures',
      label: 'Connect a fixture feed or add fixtures',
      hint: 'Club Info tab (feed) or Fixtures tab',
      done: has(club.clubFeedSlug) || (data.manualFixtures ?? []).length > 0,
    },
    {
      id: 'committee',
      label: 'Add committee contacts',
      hint: 'Committee tab',
      done: data.committee.committee.some(m => has(m.name)),
    },
    {
      id: 'channel',
      label: 'Add your WhatsApp Channel link',
      hint: 'Club Info tab',
      done: has(club.channelUrl),
    },
    {
      id: 'news',
      label: 'Write a first news post',
      hint: 'News tab',
      done: data.news.length > 0,
    },
    {
      id: 'live',
      label: 'Go live',
      hint: 'Site visibility, below',
      done: published,
    },
  ];
}

/** Labels of the content steps still to do; "Go live" itself is left out. */
export function incompleteBeforeLive(steps: OnboardingStep[]): string[] {
  return steps.filter(s => s.id !== 'live' && !s.done).map(s => s.label);
}
