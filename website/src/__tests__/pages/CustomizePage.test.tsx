import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithMantine, mockAdmin, mockSingleClub } from '../test-utils';
import type { AppData } from '../../types';

// Stub form components to expose onChange triggers without full rendering
vi.mock('../../components/customize/ClubForm', () => ({
  ClubForm: ({ onChange, club }: { onChange: (c: unknown) => void; club: unknown }) => (
    <button data-testid="club-form" onClick={() => onChange({ ...(club as object), name: 'Changed' })}>ClubForm</button>
  ),
}));
vi.mock('../../components/customize/TeamsForm', () => ({
  TeamsForm: ({ onChange }: { onChange: (t: unknown) => void }) => (
    <button data-testid="teams-form" onClick={() => onChange({ sections: [] })}>TeamsForm</button>
  ),
}));
vi.mock('../../components/customize/CommitteeForm', () => ({
  CommitteeForm: ({ onChange }: { onChange: (c: unknown) => void }) => (
    <button data-testid="committee-form" onClick={() => onChange({ committee: [] })}>CommitteeForm</button>
  ),
}));
vi.mock('../../components/customize/NewsForm', () => ({
  NewsForm: ({ onChange }: { onChange: (n: unknown) => void }) => (
    <button data-testid="news-form" onClick={() => onChange([])}>NewsForm</button>
  ),
}));
vi.mock('../../components/customize/RegistrationForm', () => ({
  RegistrationForm: ({ onChange }: { onChange: (r: unknown) => void }) => (
    <button data-testid="reg-form" onClick={() => onChange([])}>RegistrationForm</button>
  ),
}));
vi.mock('../../components/customize/GalleryForm', () => ({
  GalleryForm: ({ onChange }: { onChange: (g: unknown) => void }) => (
    <button data-testid="gallery-form" onClick={() => onChange([])}>GalleryForm</button>
  ),
}));
vi.mock('../../components/customize/MatchdayForm', () => ({
  MatchdayForm: ({ onChange }: { onChange: (m: unknown) => void }) => (
    <button data-testid="matchday-form" onClick={() => onChange([])}>MatchdayForm</button>
  ),
}));
vi.mock('../../components/customize/SaveButton', () => ({
  SaveButton: ({ onSaved }: { onSaved: (c: unknown) => void }) => (
    <button data-testid="save-button" onClick={() => onSaved({ primaryColor: '#ff0000' })}>Save</button>
  ),
}));
vi.mock('../../data', () => ({
  loadFeeds: vi.fn().mockResolvedValue([]),
  loadAllFeedTeams: vi.fn().mockResolvedValue([]),
  loadClubSlugs: vi.fn().mockResolvedValue([]),
}));

import { CustomizePage } from '../../pages/CustomizePage';

const club = {
  slug: 'test-club',
  name: 'Test FC',
  tagline: 'Play hard',
  founded: 1990,
  email: 'info@testfc.com',
  address: { line1: '1 Lane', line2: 'Town', postcode: 'AB1 2CD' },
  what3words: 'abc.def.ghi',
  socials: { facebook: '#', instagram: '#', twitter: '#' },
  about: [],
  history: [],
};

const appData: AppData = {
  club,
  teams: { sections: [] },
  committee: { committee: [] },
  registration: [],
  news: [],
  gallery: [],
  matchday: [],
  clubFeed: null,
  liveTeams: [],
  sidebarFeeds: [],
  visibility: {},
};

describe('CustomizePage', () => {
  const defaultProps = {
    originalData: appData,
    editingData: appData,
    onEditingChange: vi.fn(),
    onApplyPreview: vi.fn(),
    onResetPreview: vi.fn(),
    previewActive: false,
  };

  it('renders the Site Admin page header', () => {
    renderWithMantine(<CustomizePage {...defaultProps} />, { authValue: mockAdmin, clubValue: mockSingleClub });
    expect(screen.getByText('Site Admin')).toBeTruthy();
  });

  it('renders the Club Info tab by default', () => {
    renderWithMantine(<CustomizePage {...defaultProps} />, { authValue: mockAdmin, clubValue: mockSingleClub });
    expect(screen.getByRole('tab', { name: /Club Info/i })).toBeTruthy();
  });

  it('shows the save button', () => {
    renderWithMantine(<CustomizePage {...defaultProps} />, { authValue: mockAdmin, clubValue: mockSingleClub });
    expect(screen.getByTestId('save-button')).toBeTruthy();
  });

  it('ClubForm onChange triggers onEditingChange via set', () => {
    const onEditingChange = vi.fn();
    renderWithMantine(
      <CustomizePage {...defaultProps} onEditingChange={onEditingChange} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    fireEvent.click(screen.getByTestId('club-form'));
    expect(onEditingChange).toHaveBeenCalledWith(expect.objectContaining({ club: expect.objectContaining({ name: 'Changed' }) }));
  });

  it('clicking Teams tab shows TeamsForm', () => {
    renderWithMantine(<CustomizePage {...defaultProps} />, { authValue: mockAdmin, clubValue: mockSingleClub });
    fireEvent.click(screen.getByRole('tab', { name: /Teams/i }));
    expect(screen.getByTestId('teams-form')).toBeTruthy();
  });

  it('TeamsForm onChange triggers onEditingChange', () => {
    const onEditingChange = vi.fn();
    renderWithMantine(
      <CustomizePage {...defaultProps} onEditingChange={onEditingChange} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    fireEvent.click(screen.getByRole('tab', { name: /Teams/i }));
    fireEvent.click(screen.getByTestId('teams-form'));
    expect(onEditingChange).toHaveBeenCalledWith(expect.objectContaining({ teams: { sections: [] } }));
  });

  it('clicking Committee tab shows CommitteeForm', () => {
    renderWithMantine(<CustomizePage {...defaultProps} />, { authValue: mockAdmin, clubValue: mockSingleClub });
    fireEvent.click(screen.getByRole('tab', { name: /Committee/i }));
    expect(screen.getByTestId('committee-form')).toBeTruthy();
  });

  it('CommitteeForm onChange triggers onEditingChange', () => {
    const onEditingChange = vi.fn();
    renderWithMantine(
      <CustomizePage {...defaultProps} onEditingChange={onEditingChange} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    fireEvent.click(screen.getByRole('tab', { name: /Committee/i }));
    fireEvent.click(screen.getByTestId('committee-form'));
    expect(onEditingChange).toHaveBeenCalledWith(expect.objectContaining({ committee: { committee: [] } }));
  });

  it('SaveButton onSaved triggers onPrimaryColorSaved when provided', () => {
    const onPrimaryColorSaved = vi.fn();
    renderWithMantine(
      <CustomizePage {...defaultProps} onPrimaryColorSaved={onPrimaryColorSaved} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    fireEvent.click(screen.getByTestId('save-button'));
    expect(onPrimaryColorSaved).toHaveBeenCalledWith('#ff0000');
  });

  it('Apply Preview button is visible', () => {
    renderWithMantine(<CustomizePage {...defaultProps} />, { authValue: mockAdmin, clubValue: mockSingleClub });
    expect(screen.getByRole('button', { name: /Apply Preview/i })).toBeTruthy();
  });

  it('shows previewActive badge when previewActive is true', () => {
    renderWithMantine(
      <CustomizePage {...defaultProps} previewActive />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    expect(screen.getAllByText(/Preview active/i).length).toBeGreaterThan(0);
  });

  it('NewsForm onChange triggers onEditingChange', () => {
    const onEditingChange = vi.fn();
    renderWithMantine(
      <CustomizePage {...defaultProps} onEditingChange={onEditingChange} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    fireEvent.click(screen.getByRole('tab', { name: /News/i }));
    fireEvent.click(screen.getByTestId('news-form'));
    expect(onEditingChange).toHaveBeenCalled();
  });

  it('RegistrationForm onChange triggers onEditingChange', () => {
    const onEditingChange = vi.fn();
    renderWithMantine(
      <CustomizePage {...defaultProps} onEditingChange={onEditingChange} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    fireEvent.click(screen.getByRole('tab', { name: /Registration/i }));
    fireEvent.click(screen.getByTestId('reg-form'));
    expect(onEditingChange).toHaveBeenCalled();
  });

  it('GalleryForm onChange triggers onEditingChange', () => {
    const onEditingChange = vi.fn();
    renderWithMantine(
      <CustomizePage {...defaultProps} onEditingChange={onEditingChange} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    fireEvent.click(screen.getByRole('tab', { name: /Gallery/i }));
    fireEvent.click(screen.getByTestId('gallery-form'));
    expect(onEditingChange).toHaveBeenCalled();
  });

  it('MatchdayForm onChange triggers onEditingChange', () => {
    const onEditingChange = vi.fn();
    renderWithMantine(
      <CustomizePage {...defaultProps} onEditingChange={onEditingChange} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    fireEvent.click(screen.getByRole('tab', { name: /Matchday/i }));
    fireEvent.click(screen.getByTestId('matchday-form'));
    expect(onEditingChange).toHaveBeenCalled();
  });

  it('clicking Apply Preview triggers onApplyPreview', async () => {
    const onApplyPreview = vi.fn();
    renderWithMantine(
      <CustomizePage {...defaultProps} onApplyPreview={onApplyPreview} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    fireEvent.click(screen.getByRole('button', { name: /Apply Preview/i }));
    await waitFor(() => {
      expect(onApplyPreview).toHaveBeenCalledWith(appData);
    });
  });
});
