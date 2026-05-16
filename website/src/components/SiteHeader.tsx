import { Burger, Group, Text, ActionIcon, Badge, Box, Button, Menu, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconBrandFacebook, IconBrandInstagram, IconBrandTwitter, IconUser, IconLogout,
  IconSettings, IconUsers, IconArrowLeft, IconChevronRight,
} from '@tabler/icons-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Club, TeamSection } from '../types';
import { useSection } from '../context/SectionContext';
import { useAuth } from '../context/AuthContext';
import { useClub } from '../context/ClubContext';
import { signOut } from '../auth-client';
import { tablerIcon } from '../utils/icons';

interface Props {
  club: Club;
  sections: TeamSection[];
  navOpen: boolean;
  onNavToggle: () => void;
}

const PAGE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/about': 'About Us',
  '/teams': 'Teams',
  '/fixtures': 'Fixtures & Results',
  '/register': 'Register & Pay',
  '/committee': 'Committee & Staff',
  '/news': 'Club News',
  '/gallery': 'Gallery',
  '/matchday': 'Matchday Info',
  '/contact': 'Contact',
  '/customise': 'Site Admin',
  '/admin/users': 'Manage Users',
  '/admin/payments': 'Payments',
  '/admin/secrets': 'API Secrets',
  '/admin/bookings': 'Booking Requests',
  '/bookings': 'Request a Pitch',
  '/schedule': 'Pitch Schedule',
  '/my-registrations': 'My Registrations',
};

function currentPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  // Longest-prefix match for nested routes (e.g. /teams/.../...)
  const match = Object.keys(PAGE_TITLES)
    .filter(p => p !== '/' && pathname.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  return match ? PAGE_TITLES[match] : '';
}

export function SiteHeader({ club, sections, navOpen, onNavToggle }: Props) {
  const clubShort = club.tagShort ?? club.name.replace(/ FC$/i, '');
  const showFcSuffix = !club.tagShort && / FC$/i.test(club.name);

  const { activeSection, setActiveSection } = useSection();
  const { user, isAdmin, isPlatformAdmin, loading: authLoading } = useAuth();
  const { isMultiClub, clubSlug, clubs } = useClub();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isMobile = useMediaQuery('(max-width: 768px)') ?? false;

  const belongsToClub = !isMultiClub || isPlatformAdmin || user?.clubSlug === clubSlug;
  const canAdmin = isAdmin && belongsToClub;

  const userClub = isMultiClub && user && !belongsToClub
    ? clubs.find(c => c.slug === user.clubSlug) ?? null
    : null;
  const activeData = activeSection !== 'all'
    ? sections.find(s => s.id === activeSection)
    : null;

  const logosToShow = activeSection === 'all'
    ? sections.filter(s => s.logo)
    : sections.filter(s => s.id === activeSection && s.logo);

  const handleLogout = async () => {
    await signOut();
    window.location.reload();
  };

  const pageTitle = currentPageTitle(pathname);

  // ── Mobile: surface bar matching the sidebar ─────────────────────────────
  if (isMobile) {
    return (
      <Group
        h="100%"
        px={14}
        gap={12}
        wrap="nowrap"
        style={{
          background: 'var(--cp-surface)',
          color: 'var(--cp-surface-text)',
          borderBottom: '1px solid var(--cp-surface-border)',
        }}
      >
        <UnstyledButton
          onClick={onNavToggle}
          aria-label="Open menu"
          style={{
            background: 'var(--cp-surface-active)',
            width: 38,
            height: 38,
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: 'var(--cp-surface-text)',
          }}
        >
          <Burger opened={navOpen} color="var(--cp-surface-text)" size="sm" />
        </UnstyledButton>

        <Group gap={10} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          {club.badge && (
            <img
              src={club.badge}
              alt=""
              width={32}
              height={32}
              style={{ objectFit: 'contain', flexShrink: 0 }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Text
              component={Link}
              to="/"
              fw={800}
              size="sm"
              c="var(--cp-surface-text)"
              lh={1.1}
              style={{
                fontFamily: 'var(--mantine-h-font-family, inherit)',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: 'block',
              }}
            >
              {clubShort}{showFcSuffix ? ' FC' : ''}
            </Text>
            {pageTitle && (
              <Text size="10px" c="var(--cp-surface-text-faint)" truncate>
                {pageTitle}
              </Text>
            )}
          </Box>
        </Group>

        {!authLoading && !user && (
          <UnstyledButton
            component={Link}
            to="/login"
            aria-label="Log in"
            style={{
              background: 'var(--cp-surface-active)',
              width: 38,
              height: 38,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: 'var(--cp-surface-text)',
            }}
          >
            <IconUser size={18} />
          </UnstyledButton>
        )}

        {!authLoading && user && (
          <Menu shadow="md" width={220} position="bottom-end">
            <Menu.Target>
              <UnstyledButton
                aria-label={`Account menu for ${user.name}`}
                style={{
                  background: 'var(--cp-surface-active)',
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  color: 'var(--cp-surface-text)',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                }}
              >
                {user.name.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || <IconUser size={18} />}
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              {canAdmin && (
                <>
                  <Menu.Item leftSection={<IconSettings size={14} />} onClick={() => navigate('/customise')}>
                    Site Admin
                  </Menu.Item>
                  <Menu.Item leftSection={<IconUsers size={14} />} onClick={() => navigate('/admin/users')}>
                    Manage Users
                  </Menu.Item>
                </>
              )}
              {userClub && (
                <Menu.Item leftSection={<IconArrowLeft size={14} />} component="a" href={`/${userClub.slug}/`}>
                  Go to {userClub.name}
                </Menu.Item>
              )}
              <Menu.Item leftSection={<IconLogout size={14} />} onClick={handleLogout} color="red">
                Logout
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
    );
  }

  // ── Desktop: white frosted bar with breadcrumb ────────────────────────────
  return (
    <Group
      h="100%"
      px="lg"
      gap="md"
      wrap="nowrap"
      justify="space-between"
      style={{
        background: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--mantine-color-gray-2)',
      }}
    >
      <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
        {isMultiClub && (
          <ActionIcon
            component="a"
            href="/"
            variant="subtle"
            aria-label="All clubs"
            title="All clubs"
          >
            <IconArrowLeft size={16} />
          </ActionIcon>
        )}
        <Text size="xs" c="dimmed">clubsPlatform</Text>
        <IconChevronRight size={12} color="var(--mantine-color-gray-4)" />
        <Text
          component={Link}
          to="/"
          size="xs"
          fw={600}
          c="var(--mantine-color-gray-7)"
          style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          {clubShort}{showFcSuffix && (
            <Text component="span" fw={400} c="dimmed"> FC</Text>
          )}
        </Text>
        {pageTitle && (
          <>
            <IconChevronRight size={12} color="var(--mantine-color-gray-4)" />
            <Text size="xs" fw={600} c="var(--mantine-primary-color-filled)" truncate>
              {pageTitle}
            </Text>
          </>
        )}
      </Group>

      <Group gap="sm" wrap="nowrap">
        {activeData && (
          <Box visibleFrom="md">
            <Badge
              variant="filled"
              size="md"
              leftSection={tablerIcon(activeData.icon)}
              style={{ cursor: 'pointer' }}
              onClick={() => setActiveSection('all')}
              title="Click to show all sections"
            >
              {activeData.name} {activeData.subtitle}
            </Badge>
          </Box>
        )}

        {club.socials.facebook && club.socials.facebook !== '#' && (
          <ActionIcon
            component="a"
            href={club.socials.facebook}
            target="_blank"
            rel="noopener noreferrer"
            variant="subtle"
            aria-label="Facebook"
          >
            <IconBrandFacebook size={18} />
          </ActionIcon>
        )}
        {club.socials.instagram && club.socials.instagram !== '#' && (
          <ActionIcon
            component="a"
            href={club.socials.instagram}
            target="_blank"
            rel="noopener noreferrer"
            variant="subtle"
            aria-label="Instagram"
          >
            <IconBrandInstagram size={18} />
          </ActionIcon>
        )}
        {club.socials.twitter && club.socials.twitter !== '#' && (
          <ActionIcon
            component="a"
            href={club.socials.twitter}
            target="_blank"
            rel="noopener noreferrer"
            variant="subtle"
            aria-label="Twitter / X"
          >
            <IconBrandTwitter size={18} />
          </ActionIcon>
        )}

        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          {logosToShow.map(s => (
            <img
              key={s.id}
              src={s.logo}
              alt={`${s.name} logo`}
              height={32}
              width={32}
              style={{ objectFit: 'contain', display: 'block', flexShrink: 0 }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ))}
        </Group>

        {!authLoading && !user && (
          <Button
            component={Link}
            to="/login"
            variant="subtle"
            size="compact-sm"
            leftSection={<IconUser size={14} />}
          >
            Login
          </Button>
        )}

        {!authLoading && user && (
          <Menu shadow="md" width={200}>
            <Menu.Target>
              <Button variant="subtle" size="compact-sm" leftSection={<IconUser size={14} />}>
                {user.name}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {canAdmin && (
                <>
                  <Menu.Item
                    leftSection={<IconSettings size={14} />}
                    onClick={() => navigate('/customise')}
                  >
                    Site Admin
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconUsers size={14} />}
                    onClick={() => navigate('/admin/users')}
                  >
                    Manage Users
                  </Menu.Item>
                </>
              )}
              {userClub && (
                <Menu.Item
                  leftSection={<IconArrowLeft size={14} />}
                  component="a"
                  href={`/${userClub.slug}/`}
                >
                  Go to {userClub.name}
                </Menu.Item>
              )}
              <Menu.Item
                leftSection={<IconLogout size={14} />}
                onClick={handleLogout}
                color="red"
              >
                Logout
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
    </Group>
  );
}
