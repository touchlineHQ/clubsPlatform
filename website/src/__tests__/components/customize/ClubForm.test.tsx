import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { ClubForm } from '../../../components/customize/ClubForm';
import { renderWithMantine } from '../../test-utils';
import type { Club } from '../../../types';

const mockClub: Club = {
  slug: 'test-club',
  name: 'Test FC',
  tagline: 'Play hard',
  founded: 2000,
  email: 'info@testfc.com',
  address: { line1: '1 Main St', line2: '', postcode: 'AB1 2CD' },
  what3words: 'one.two.three',
  socials: { facebook: '', instagram: '', twitter: '' },
  about: [],
  history: [],
};

describe('ClubForm', () => {
  it('renders without crashing', () => {
    const onChange = vi.fn();
    renderWithMantine(<ClubForm club={mockClub} onChange={onChange} />);
    expect(screen.getByText('Club Identity')).toBeTruthy();
  });

  it('shows club name field with current value', () => {
    const onChange = vi.fn();
    renderWithMantine(<ClubForm club={mockClub} onChange={onChange} />);
    const input = screen.getByDisplayValue('Test FC');
    expect(input).toBeTruthy();
  });

  it('calls onChange when club name changes', () => {
    const onChange = vi.fn();
    renderWithMantine(<ClubForm club={mockClub} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Test FC'), { target: { value: 'New FC' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'New FC' }));
  });

  it('calls onChange when tagline changes', () => {
    const onChange = vi.fn();
    renderWithMantine(<ClubForm club={mockClub} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Play hard'), { target: { value: 'Win more' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tagline: 'Win more' }));
  });

  it('calls onChange when email changes', () => {
    const onChange = vi.fn();
    renderWithMantine(<ClubForm club={mockClub} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('info@testfc.com'), { target: { value: 'new@test.com' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@test.com' }));
  });

  it('calls onChange when address line1 changes', () => {
    const onChange = vi.fn();
    renderWithMantine(<ClubForm club={mockClub} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('1 Main St'), { target: { value: '2 Other St' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ address: expect.objectContaining({ line1: '2 Other St' }) }));
  });

  it('calls onChange when postcode changes', () => {
    const onChange = vi.fn();
    renderWithMantine(<ClubForm club={mockClub} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('AB1 2CD'), { target: { value: 'XY9 8ZZ' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ address: expect.objectContaining({ postcode: 'XY9 8ZZ' }) }));
  });

  it('calls onChange when what3words changes', () => {
    const onChange = vi.fn();
    renderWithMantine(<ClubForm club={mockClub} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('one.two.three'), { target: { value: 'a.b.c' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ what3words: 'a.b.c' }));
  });

  it('calls onChange when tagShort changes', () => {
    const onChange = vi.fn();
    const clubWithTag = { ...mockClub, tagShort: 'TestFC' };
    renderWithMantine(<ClubForm club={clubWithTag} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('TestFC'), { target: { value: 'TFC' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tagShort: 'TFC' }));
  });

  it('calls onChange when address line2 changes', () => {
    const onChange = vi.fn();
    const clubWithLine2 = { ...mockClub, address: { ...mockClub.address, line2: 'Town Centre' } };
    renderWithMantine(<ClubForm club={clubWithLine2} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Town Centre'), { target: { value: 'City' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ address: expect.objectContaining({ line2: 'City' }) }));
  });

  it('calls onChange when instagram URL changes', () => {
    const onChange = vi.fn();
    const clubWithSocials = { ...mockClub, socials: { facebook: '', instagram: 'https://instagram.com/old', twitter: '' } };
    renderWithMantine(<ClubForm club={clubWithSocials} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('https://instagram.com/old'), { target: { value: 'https://instagram.com/new' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ socials: expect.objectContaining({ instagram: 'https://instagram.com/new' }) }));
  });

  it('calls onChange when kit description changes', () => {
    const onChange = vi.fn();
    const clubWithKit = { ...mockClub, kitDescription: 'Blue shirt' };
    renderWithMantine(<ClubForm club={clubWithKit} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Blue shirt'), { target: { value: 'Red shirt' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kitDescription: 'Red shirt' }));
  });

  it('calls onChange when facebook URL changes', () => {
    const onChange = vi.fn();
    const clubWithSocials = { ...mockClub, socials: { facebook: 'https://fb.com/old', instagram: '', twitter: '' } };
    renderWithMantine(<ClubForm club={clubWithSocials} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('https://fb.com/old'), { target: { value: 'https://fb.com/new' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ socials: expect.objectContaining({ facebook: 'https://fb.com/new' }) }));
  });

  it('calls onChange when shop URL changes', () => {
    const onChange = vi.fn();
    const clubWithShop = { ...mockClub, shopUrl: 'https://shop.example.com' };
    renderWithMantine(<ClubForm club={clubWithShop} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('https://shop.example.com'), { target: { value: 'https://new-shop.example.com' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('calls onChange when badge image path changes', () => {
    const onChange = vi.fn();
    const clubWithBadge = { ...mockClub, badge: 'images/badge.png' };
    renderWithMantine(<ClubForm club={clubWithBadge} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('images/badge.png'), { target: { value: 'images/new-badge.png' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ badge: 'images/new-badge.png' }));
  });

  it('calls onChange when colours description changes', () => {
    const onChange = vi.fn();
    const clubWithColors = { ...mockClub, colours: 'Blue and White' };
    renderWithMantine(<ClubForm club={clubWithColors} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Blue and White'), { target: { value: 'Red and Black' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ colours: 'Red and Black' }));
  });

  it('calls onChange when ground image path changes', () => {
    const onChange = vi.fn();
    const clubWithGround = { ...mockClub, groundImage: 'images/ground.jpg' };
    renderWithMantine(<ClubForm club={clubWithGround} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('images/ground.jpg'), { target: { value: 'images/new-ground.jpg' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ groundImage: 'images/new-ground.jpg' }));
  });

  it('shows socials section divider', () => {
    const onChange = vi.fn();
    renderWithMantine(<ClubForm club={mockClub} onChange={onChange} />);
    expect(screen.getByText('Socials & Links')).toBeTruthy();
  });

  it('shows Add About Item button and clicking it calls onChange with new item', () => {
    const onChange = vi.fn();
    renderWithMantine(<ClubForm club={mockClub} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Add About Item/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      about: expect.arrayContaining([expect.objectContaining({ icon: 'fa-star' })]),
    }));
  });

  it('clicking Add Paragraph calls onChange with new history entry', () => {
    const onChange = vi.fn();
    renderWithMantine(<ClubForm club={mockClub} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Add Paragraph/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ history: [''] }));
  });

  it('renders existing about items and remove button calls onChange', () => {
    const onChange = vi.fn();
    const clubWithAbout: Club = {
      ...mockClub,
      about: [{ icon: 'fa-star', title: 'Our Values', text: 'Teamwork' }],
    };
    renderWithMantine(<ClubForm club={clubWithAbout} onChange={onChange} />);
    expect(screen.getByDisplayValue('Our Values')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ about: [] }));
  });

  it('about item title change calls onChange', () => {
    const onChange = vi.fn();
    const clubWithAbout: Club = {
      ...mockClub,
      about: [{ icon: 'fa-star', title: 'Old Title', text: 'Some text' }],
    };
    renderWithMantine(<ClubForm club={clubWithAbout} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Old Title'), { target: { value: 'New Title' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      about: [expect.objectContaining({ title: 'New Title' })],
    }));
  });

  it('renders existing history paragraphs and remove calls onChange', () => {
    const onChange = vi.fn();
    const clubWithHistory: Club = { ...mockClub, history: ['Old para'] };
    renderWithMantine(<ClubForm club={clubWithHistory} onChange={onChange} />);
    expect(screen.getByDisplayValue('Old para')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ history: [] }));
  });

  it('history paragraph textarea change calls onChange', () => {
    const onChange = vi.fn();
    const clubWithHistory: Club = { ...mockClub, history: ['Old para'] };
    renderWithMantine(<ClubForm club={clubWithHistory} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Old para'), { target: { value: 'New para' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ history: ['New para'] }));
  });

  it('calls onChange when founded year changes', () => {
    const onChange = vi.fn();
    renderWithMantine(<ClubForm club={mockClub} onChange={onChange} />);
    const foundedInput = screen.getByDisplayValue('2000');
    fireEvent.change(foundedInput, { target: { value: '1990' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ founded: 1990 }));
  });

  it('calls onChange when twitter URL changes', () => {
    const onChange = vi.fn();
    const clubWithTwitter = { ...mockClub, socials: { ...mockClub.socials, twitter: 'https://x.com/test' } };
    renderWithMantine(<ClubForm club={clubWithTwitter} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('https://x.com/test'), { target: { value: 'https://x.com/new' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ socials: expect.objectContaining({ twitter: 'https://x.com/new' }) }));
  });

  it('calls onChange when club feed slug changes', () => {
    const onChange = vi.fn();
    const clubWithSlug = { ...mockClub, clubFeedSlug: 'test-club-slug' };
    renderWithMantine(<ClubForm club={clubWithSlug} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('test-club-slug'), { target: { value: 'new-club-slug' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ clubFeedSlug: 'new-club-slug' }));
  });

  it('calls onChange when home banner changes', () => {
    const onChange = vi.fn();
    const clubWithBanner = { ...mockClub, homeBanner: 'Welcome to our club!' };
    renderWithMantine(<ClubForm club={clubWithBanner} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Welcome to our club!'), { target: { value: 'Updated banner' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ homeBanner: 'Updated banner' }));
  });

  it('calls onChange when ground image alt text changes', () => {
    const onChange = vi.fn();
    const clubWithAlt = { ...mockClub, groundImageAlt: 'Our home ground' };
    renderWithMantine(<ClubForm club={clubWithAlt} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Our home ground'), { target: { value: 'New alt text' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ groundImageAlt: 'New alt text' }));
  });

  it('about item text textarea change calls onChange', () => {
    const onChange = vi.fn();
    const clubWithAbout: Club = {
      ...mockClub,
      about: [{ icon: 'fa-star', title: 'Values', text: 'We play to win' }],
    };
    renderWithMantine(<ClubForm club={clubWithAbout} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('We play to win'), { target: { value: 'Updated text' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      about: [expect.objectContaining({ text: 'Updated text' })],
    }));
  });
});
