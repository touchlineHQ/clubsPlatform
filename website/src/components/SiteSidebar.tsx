import { NavLink, Stack, Text, Divider, Badge, Group, Paper, Button } from '@mantine/core';
import { useLocation, Link } from 'react-router-dom';
import { IconCalendar, IconClipboardList, IconFileUpload, IconSettings, IconShirt, IconShoppingBag, IconUsers } from '@tabler/icons-react';
import type { Club, NavItem, TeamFeed, TeamSection } from '../types';
import { useSection } from '../context/SectionContext';
import { useAuth } from '../context/AuthContext';
import { tablerIcon } from '../utils/icons';

const DEFAULT_NAV: NavItem[] = [
  { to: '/',          label: 'Home',               icon: 'fa-home' },
  { to: '/about',     label: 'About Us',           icon: 'fa-info-circle' },
  { to: '/teams',     label: 'Teams',              icon: 'fa-users' },
  { to: '/fixtures',  label: 'Fixtures & Results', icon: 'fa-calendar' },
  { to: '/register',  label: 'Register & Pay',     icon: 'fa-credit-card' },
  { to: '/committee', label: 'Committee & Staff',  icon: 'fa-id-card' },
  { to: '/news',      label: 'Club News',          icon: 'fa-newspaper' },
  { to: '/gallery',   label: 'Gallery',            icon: 'fa-images' },
  { to: '/matchday',  label: 'Matchday Info',      icon: 'fa-map-marker-alt' },
  { to: '/contact',   label: 'Contact',            icon: 'fa-envelope' },
];

function NextTeamFixture({ feed, label }: { feed: TeamFeed; label: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = feed.fixtures
    .filter((f) => f.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const next = upcoming[0];
  if (!next) return null;
  const d = new Date(next.date + 'T00:00:00');
  const dateStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <>
      <Divider my="sm" mx="md" />
      <Text fw={600} size="xs" tt="uppercase" c="dimmed" px="md" pb="xs">
        {label}
      </Text>
      <Paper mx="md" p="sm" withBorder radius="md">
        <Badge variant="light" size="xs" mb="xs">{next.division}</Badge>
        <Text fw={700} size="sm" ta="center" lh={1.3}>
          {next.home_team}
        </Text>
        <Text size="xs" c="dimmed" ta="center">vs</Text>
        <Text fw={700} size="sm" ta="center" lh={1.3} mb="xs">
          {next.away_team}
        </Text>
        <Group gap="xs" justify="center" wrap="nowrap">
          <IconCalendar size={12} />
          <Text size="xs" c="dimmed">{dateStr} · {next.time}</Text>
        </Group>
        <Text size="xs" c="dimmed" ta="center">{next.venue}</Text>
      </Paper>
    </>
  );
}

interface Props {
  club: Club;
  sections: TeamSection[];
  sidebarFeeds?: { feed: TeamFeed; label: string; sectionId: string }[];
  onNavClick: () => void;
  pitchBookings?: boolean;
  visibility?: Record<string, boolean>;
}

export const SiteSidebar = ({ club, sections, sidebarFeeds, onNavClick, pitchBookings, visibility }: Props) => {
  const { pathname } = useLocation();
  const { activeSection, setActiveSection } = useSection();
  const { user, isAdmin, isManager } = useAuth();

  const navItems = (club.nav ?? DEFAULT_NAV).filter(
    ({ to }) => visibility === undefined || !(to in visibility) || visibility[to]
  );

  const visibleFeeds = sidebarFeeds?.filter(
    f => activeSection === 'all' || f.sectionId === activeSection
  );

  return (
    <Stack gap={0} h="100%" style={{ overflowY: 'auto' }}>
      {sections.length > 0 && (
        <>
          <Text fw={600} size="xs" tt="uppercase" c="dimmed" px="md" pt="md" pb="xs">
            View
          </Text>
          <Group gap={4} px="md" pb="sm" wrap="wrap">
            <Button
              size="compact-xs"
              variant={activeSection === 'all' ? 'filled' : 'outline'}
              onClick={() => setActiveSection('all')}
            >
              All
            </Button>
            {sections.map(s => (
              <Button
                key={s.id}
                size="compact-xs"
                variant={activeSection === s.id ? 'filled' : 'outline'}
                onClick={() => setActiveSection(s.id)}
              >
                {s.name}{s.subtitle ? ` ${s.subtitle}` : ''}
              </Button>
            ))}
          </Group>
          <Divider mx="md" mb="xs" />
        </>
      )}

      <Text fw={600} size="xs" tt="uppercase" c="dimmed" px="md" pb="xs">
        Menu
      </Text>

      {navItems.map(({ to, label, icon }) => (
        <NavLink
          key={to}
          component={Link}
          to={to}
          label={label}
          leftSection={tablerIcon(icon, 16)}
          active={to === '/' ? pathname === '/' : pathname.startsWith(to)}
          onClick={onNavClick}
        />
      ))}
      {club.shopUrl && (
        <NavLink
          component="a"
          href={club.shopUrl}
          target="_blank"
          rel="noopener noreferrer"
          label="Club Shop"
          leftSection={<IconShoppingBag size={16} />}
          onClick={onNavClick}
        />
      )}
      {pitchBookings && (
        <NavLink
          component={Link}
          to="/schedule"
          label="Pitch Schedule"
          leftSection={<IconCalendar size={16} />}
          active={pathname === '/schedule'}
          onClick={onNavClick}
        />
      )}

      {visibleFeeds?.map(({ feed, label }) => (
        <NextTeamFixture key={label} feed={feed} label={`Next ${label} Fixture`} />
      ))}

      {(club.email || club.address?.line1 || club.address?.line2 || club.address?.postcode) && (
        <>
          <Divider my="sm" mx="md" />
          <Text fw={600} size="xs" tt="uppercase" c="dimmed" px="md" pb="xs">
            Get in Touch
          </Text>
          <Stack gap={4} px="md" pb="md">
            {club.email && (
              <Text size="xs">
                <Text component="a" href={`mailto:${club.email}`} c="var(--mantine-primary-color-filled)" size="xs">
                  {club.email}
                </Text>
              </Text>
            )}
            {[club.address?.line1, club.address?.line2, club.address?.postcode].filter(Boolean).length > 0 && (
              <Text size="xs" c="dimmed">
                {[club.address?.line1, club.address?.line2, club.address?.postcode].filter(Boolean).join(', ')}
              </Text>
            )}
          </Stack>
        </>
      )}

      {user && (
        <NavLink
          component={Link}
          to="/my-registrations"
          label={isAdmin ? 'Club Registrations' : 'My Registrations'}
          leftSection={<IconShirt size={16} />}
          active={pathname === '/my-registrations'}
          onClick={onNavClick}
        />
      )}

      {pitchBookings && user && (isManager || isAdmin) && (
        <div style={{ marginTop: 'auto' }}>
          <Divider mx="md" mb="xs" />
          <NavLink
            component={Link}
            to="/bookings"
            label="Request a Pitch"
            leftSection={<IconClipboardList size={16} />}
            active={pathname === '/bookings'}
            onClick={onNavClick}
          />
        </div>
      )}

      {isAdmin && (
        <div style={{ marginTop: user ? undefined : 'auto' }}>
          <Divider mx="md" mb="xs" />
          <NavLink
            component={Link}
            to="/customise"
            label="Customise"
            leftSection={<IconSettings size={16} />}
            active={pathname === '/customise'}
            onClick={onNavClick}
          />
          <NavLink
            component={Link}
            to="/admin/users"
            label="Manage Users"
            leftSection={<IconUsers size={16} />}
            active={pathname === '/admin/users'}
            onClick={onNavClick}
          />
          <NavLink
            component={Link}
            to="/admin/import"
            label="Import Players"
            leftSection={<IconFileUpload size={16} />}
            active={pathname === '/admin/import'}
            onClick={onNavClick}
          />
          {pitchBookings && (
            <NavLink
              component={Link}
              to="/admin/bookings"
              label="Booking Requests"
              leftSection={<IconClipboardList size={16} />}
              active={pathname === '/admin/bookings'}
              onClick={onNavClick}
            />
          )}
        </div>
      )}
    </Stack>
  );
}
