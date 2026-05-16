import type { CSSProperties, ReactNode } from 'react';
import { Box, Stack, Text, Badge, Group, Paper, Button, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useLocation, Link } from 'react-router-dom';
import {
  IconBallFootball, IconCalendar, IconChevronRight, IconClipboardList, IconKey,
  IconLogout, IconReceipt, IconSettings, IconShirt, IconShoppingBag, IconUsers, IconX,
} from '@tabler/icons-react';
import type { Club, NavItem, TeamFeed, TeamSection } from '../types';
import { useSection } from '../context/SectionContext';
import { useAuth } from '../context/AuthContext';
import { useClub } from '../context/ClubContext';
import { signOut } from '../auth-client';
import { tablerIcon } from '../utils/icons';
import { clubDesign } from '../theme';

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

const PRIMARY = 'var(--mantine-primary-color-filled)';
const PRIMARY_DARK = 'var(--mantine-primary-color-7)';
const SURFACE = 'var(--cp-surface)';
const SURFACE_END = 'var(--cp-surface-end)';
const TEXT = 'var(--cp-surface-text)';
const TEXT_DIM = 'var(--cp-surface-text-dim)';
const TEXT_FAINT = 'var(--cp-surface-text-faint)';
const TEXT_GHOST = 'var(--cp-surface-text-ghost)';
const SURFACE_HOVER = 'var(--cp-surface-hover)';
const SURFACE_ACTIVE = 'var(--cp-surface-active)';
const BORDER_FAINT = 'var(--cp-surface-border)';
const CARD_BG = 'var(--cp-surface-card)';

interface NavRowProps {
  to?: string;
  href?: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  external?: boolean;
  onClick?: () => void;
}

function NavRow({ to, href, label, icon, active, external, onClick }: NavRowProps) {
  const baseStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 12px',
    margin: '0 8px',
    borderRadius: 10,
    width: 'calc(100% - 16px)',
    textAlign: 'left',
    position: 'relative',
    color: active ? TEXT : TEXT_DIM,
    background: active ? SURFACE_ACTIVE : 'transparent',
    fontWeight: active ? 700 : 500,
    fontSize: '0.875rem',
    transition: 'background 0.15s, color 0.15s',
    textDecoration: 'none',
  };

  const handleEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (!active) {
      e.currentTarget.style.background = SURFACE_HOVER;
      e.currentTarget.style.color = TEXT;
    }
  };
  const handleLeave = (e: React.MouseEvent<HTMLElement>) => {
    if (!active) {
      e.currentTarget.style.background = 'transparent';
      e.currentTarget.style.color = TEXT_DIM;
    }
  };

  const inner = (
    <>
      {active && (
        <span
          style={{
            position: 'absolute',
            left: -4,
            top: 8,
            bottom: 8,
            width: 3,
            borderRadius: 3,
            background: PRIMARY,
          }}
        />
      )}
      <span
        style={{
          display: 'flex',
          flexShrink: 0,
          color: active ? PRIMARY : TEXT_FAINT,
        }}
      >
        {icon}
      </span>
      <span>{label}</span>
    </>
  );

  if (to) {
    return (
      <UnstyledButton
        component={Link}
        to={to}
        onClick={onClick}
        style={baseStyle}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {inner}
      </UnstyledButton>
    );
  }

  return (
    <UnstyledButton
      component="a"
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      onClick={onClick}
      style={baseStyle}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {inner}
    </UnstyledButton>
  );
}

function NextTeamFixture({ feed, label }: { feed: TeamFeed; label: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const next = feed.fixtures
    .filter((f) => f.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))[0];
  if (!next) return null;
  const d = new Date(next.date + 'T00:00:00');
  const dateStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <Box
      mx={12}
      mt="md"
      p="md"
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: CARD_BG,
        border: `1px solid ${BORDER_FAINT}`,
        borderRadius: 12,
      }}
    >
      <Box
        style={{
          position: 'absolute',
          top: -30,
          right: -30,
          width: 90,
          height: 90,
          borderRadius: '50%',
          background: PRIMARY,
          opacity: 0.13,
          filter: 'blur(14px)',
          pointerEvents: 'none',
        }}
      />
      <Group gap={6} mb={8}>
        <Box
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#22c55e',
            boxShadow: '0 0 0 3px rgba(34,197,94,0.18)',
          }}
        />
        <Text size="9px" fw={800} c={TEXT_DIM} style={{ letterSpacing: '0.1em' }}>
          {label.toUpperCase()}
        </Text>
      </Group>
      <Text
        fw={800}
        size="sm"
        lh={1.3}
        c={TEXT}
        style={{ fontFamily: clubDesign.font.heading }}
      >
        {next.home_team}
      </Text>
      <Text size="xs" c={TEXT_FAINT} my={2}>vs</Text>
      <Text
        fw={800}
        size="sm"
        lh={1.3}
        c={TEXT}
        style={{ fontFamily: clubDesign.font.heading }}
      >
        {next.away_team}
      </Text>
      <Group
        gap={6}
        mt={10}
        pt={9}
        wrap="nowrap"
        style={{ borderTop: `1px solid ${BORDER_FAINT}`, color: TEXT_DIM }}
      >
        <IconCalendar size={12} />
        <Text size="xs" c={TEXT_DIM}>{dateStr}</Text>
        <Text size="xs" c={TEXT_GHOST}>·</Text>
        <Text size="xs" c={TEXT_DIM}>{next.time}</Text>
      </Group>
      {next.venue && (
        <Text size="xs" c={TEXT_FAINT} mt={2}>{next.venue}</Text>
      )}
    </Box>
  );
}

function userInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
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
  const { user, isAdmin, isManager, isPlatformAdmin } = useAuth();
  const { clubSlug, isMultiClub } = useClub();
  const isMobile = useMediaQuery('(max-width: 768px)') ?? false;

  const belongsToClub = !isMultiClub || isPlatformAdmin || user?.clubSlug === clubSlug;
  const canAdmin = isAdmin && belongsToClub;
  const canManage = isManager && belongsToClub;

  const navItems = (club.nav ?? DEFAULT_NAV).filter(
    ({ to }) => visibility === undefined || !(to in visibility) || visibility[to],
  );

  const visibleFeeds = sidebarFeeds?.filter(
    (f) => activeSection === 'all' || f.sectionId === activeSection,
  );

  const isActive = (to: string) =>
    to === '/' ? pathname === '/' : pathname.startsWith(to);

  const handleLogout = async () => {
    await signOut();
    window.location.reload();
  };

  return (
    <Stack
      gap={0}
      h="100%"
      style={{
        background: `linear-gradient(180deg, ${SURFACE} 0%, ${SURFACE_END} 100%)`,
        color: TEXT,
      }}
    >
      {/* ───── Club hero ───── */}
      <Box
        px={20}
        pt={isMobile ? 20 : 22}
        pb={18}
        style={{
          position: 'relative',
          overflow: 'hidden',
          borderBottom: `1px solid ${BORDER_FAINT}`,
          flexShrink: 0,
        }}
      >
        <Box
          style={{
            position: 'absolute',
            top: -40,
            right: -30,
            width: 140,
            height: 140,
            borderRadius: '50%',
            background: PRIMARY,
            opacity: 0.2,
            filter: 'blur(20px)',
            pointerEvents: 'none',
          }}
        />
        <Group gap={12} wrap="nowrap" style={{ position: 'relative' }}>
          <Box
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: SURFACE_ACTIVE,
              border: `1px solid ${BORDER_FAINT}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: TEXT,
            }}
          >
            {club.badge ? (
              <img
                src={club.badge}
                alt=""
                style={{ width: 34, height: 34, objectFit: 'contain' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <IconBallFootball size={24} />
            )}
          </Box>
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Text
              fw={800}
              c={TEXT}
              size="md"
              lh={1.15}
              style={{
                fontFamily: clubDesign.font.heading,
                letterSpacing: '-0.01em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {club.name}
            </Text>
            <Group gap={6} mt={3} wrap="nowrap">
              <Box
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: PRIMARY,
                  flexShrink: 0,
                }}
              />
              <Text size="11px" c={TEXT_FAINT}>
                {club.tagShort ? `${club.tagShort} · ` : ''}
                {club.founded ? `Est. ${club.founded}` : ''}
              </Text>
            </Group>
          </Box>
          {isMobile && (
            <UnstyledButton
              onClick={onNavClick}
              aria-label="Close menu"
              style={{
                background: SURFACE_HOVER,
                width: 32,
                height: 32,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: TEXT,
              }}
            >
              <IconX size={16} />
            </UnstyledButton>
          )}
        </Group>

        {/* User chip */}
        {user && (
          <Group
            gap={10}
            mt={14}
            px={10}
            py={8}
            wrap="nowrap"
            style={{
              background: SURFACE_HOVER,
              border: `1px solid ${BORDER_FAINT}`,
              borderRadius: 10,
            }}
          >
            <Box
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${PRIMARY} 0%, ${PRIMARY_DARK} 100%)`,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '0.72rem',
                flexShrink: 0,
              }}
            >
              {userInitials(user.name)}
            </Box>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text size="xs" fw={600} c={TEXT} lh={1.2} truncate>{user.name}</Text>
              <Text size="10px" c={TEXT_FAINT}>Signed in</Text>
            </Box>
            {canAdmin && (
              <Badge
                size="xs"
                radius="xl"
                style={{
                  background: 'var(--mantine-primary-color-light)',
                  color: PRIMARY,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                }}
              >
                ADMIN
              </Badge>
            )}
          </Group>
        )}
      </Box>

      {/* ───── Scrollable middle ───── */}
      <Box style={{ flex: 1, overflowY: 'auto', padding: '12px 0 4px' }}>
        {sections.length > 0 && (
          <>
            <Text fw={800} size="10px" c={TEXT_GHOST} px={20} pb={8} style={{ letterSpacing: '0.12em' }}>
              VIEW
            </Text>
            <Group gap={6} px={16} pb={12} wrap="wrap">
              <Button
                size="compact-xs"
                radius="xl"
                variant={activeSection === 'all' ? 'filled' : 'default'}
                onClick={() => setActiveSection('all')}
                styles={
                  activeSection === 'all'
                    ? undefined
                    : {
                        root: {
                          background: 'transparent',
                          color: TEXT_DIM,
                          borderColor: 'var(--cp-surface-border)',
                        },
                      }
                }
              >
                All
              </Button>
              {sections.map((s) => {
                const active = activeSection === s.id;
                return (
                  <Button
                    key={s.id}
                    size="compact-xs"
                    radius="xl"
                    variant={active ? 'filled' : 'default'}
                    onClick={() => setActiveSection(s.id)}
                    styles={
                      active
                        ? undefined
                        : {
                            root: {
                              background: 'transparent',
                              color: TEXT_DIM,
                              borderColor: 'var(--cp-surface-border)',
                            },
                          }
                    }
                  >
                    {s.name}{s.subtitle ? ` ${s.subtitle}` : ''}
                  </Button>
                );
              })}
            </Group>
          </>
        )}

        <Text fw={800} size="10px" c={TEXT_GHOST} px={20} pb={8} style={{ letterSpacing: '0.12em' }}>
          MENU
        </Text>
        <Stack gap={2}>
          {navItems.map(({ to, label, icon }) => (
            <NavRow
              key={to}
              to={to}
              label={label}
              icon={tablerIcon(icon, 16)}
              active={isActive(to)}
              onClick={onNavClick}
            />
          ))}
          {club.shopUrl && (
            <NavRow
              href={club.shopUrl}
              external
              label="Club Shop"
              icon={<IconShoppingBag size={16} />}
              onClick={onNavClick}
            />
          )}
          {pitchBookings && (
            <NavRow
              to="/schedule"
              label="Pitch Schedule"
              icon={<IconCalendar size={16} />}
              active={pathname === '/schedule'}
              onClick={onNavClick}
            />
          )}
        </Stack>

        {visibleFeeds?.map(({ feed, label }) => (
          <NextTeamFixture key={label} feed={feed} label={`Next ${label}`} />
        ))}

        {user && belongsToClub && (
          <UnstyledButton
            component={Link}
            to="/my-registrations"
            onClick={onNavClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              width: 'calc(100% - 16px)',
              margin: '12px 8px 0',
              padding: '12px 14px',
              background: `linear-gradient(135deg, ${PRIMARY} 0%, ${PRIMARY_DARK} 100%)`,
              borderRadius: 12,
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.88rem',
              boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
            }}
          >
            <Group gap={9} wrap="nowrap">
              <Box
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 7,
                  background: 'rgba(255,255,255,0.22)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <IconShirt size={14} />
              </Box>
              <span>{canAdmin ? 'Registrations' : 'My Registrations'}</span>
            </Group>
            <IconChevronRight size={16} />
          </UnstyledButton>
        )}

        {pitchBookings && canManage && !canAdmin && (
          <Stack gap={2} mt="md">
            <NavRow
              to="/bookings"
              label="Request a Pitch"
              icon={<IconClipboardList size={16} />}
              active={pathname === '/bookings'}
              onClick={onNavClick}
            />
          </Stack>
        )}

        {canAdmin && (
          <>
            <Group gap={8} mx={12} my="md" wrap="nowrap">
              <Box style={{ flex: 1, height: 1, background: BORDER_FAINT }} />
              <Group gap={5} wrap="nowrap">
                <Box style={{ width: 5, height: 5, borderRadius: '50%', background: PRIMARY }} />
                <Text size="10px" fw={800} c={TEXT_GHOST} style={{ letterSpacing: '0.14em' }}>
                  ADMIN
                </Text>
              </Group>
              <Box style={{ flex: 1, height: 1, background: BORDER_FAINT }} />
            </Group>
            <Stack gap={2} pb={8}>
              {pitchBookings && canManage && (
                <NavRow
                  to="/bookings"
                  label="Request a Pitch"
                  icon={<IconClipboardList size={16} />}
                  active={pathname === '/bookings'}
                  onClick={onNavClick}
                />
              )}
              <NavRow
                to="/customise"
                label="Customise"
                icon={<IconSettings size={16} />}
                active={pathname === '/customise'}
                onClick={onNavClick}
              />
              <NavRow
                to="/admin/users"
                label="Manage Users"
                icon={<IconUsers size={16} />}
                active={pathname === '/admin/users'}
                onClick={onNavClick}
              />
              <NavRow
                to="/admin/payments"
                label="Payments"
                icon={<IconReceipt size={16} />}
                active={pathname === '/admin/payments'}
                onClick={onNavClick}
              />
              <NavRow
                to="/admin/secrets"
                label="API Secrets"
                icon={<IconKey size={16} />}
                active={pathname === '/admin/secrets'}
                onClick={onNavClick}
              />
              {pitchBookings && (
                <NavRow
                  to="/admin/bookings"
                  label="Booking Requests"
                  icon={<IconClipboardList size={16} />}
                  active={pathname === '/admin/bookings'}
                  onClick={onNavClick}
                />
              )}
            </Stack>
          </>
        )}
      </Box>

      {/* ───── Footer ───── */}
      <Box p={12} style={{ borderTop: `1px solid ${BORDER_FAINT}`, flexShrink: 0 }}>
        {(club.email || club.address?.line1 || club.address?.line2 || club.address?.postcode) && (
          <Paper
            component={club.email ? 'a' : 'div'}
            href={club.email ? `mailto:${club.email}` : undefined}
            mb={8}
            p="8px 10px"
            radius={9}
            style={{
              background: CARD_BG,
              textDecoration: 'none',
              display: 'block',
            }}
          >
            <Text size="10px" fw={800} c={TEXT_GHOST} style={{ letterSpacing: '0.1em' }}>
              GET IN TOUCH
            </Text>
            {club.email && (
              <Text size="xs" mt={3} fw={600} c={PRIMARY} truncate>
                {club.email}
              </Text>
            )}
            {[club.address?.line1, club.address?.line2, club.address?.postcode].filter(Boolean).length > 0 && (
              <Text size="xs" c={TEXT_FAINT} mt={2}>
                {[club.address?.line1, club.address?.line2, club.address?.postcode].filter(Boolean).join(', ')}
              </Text>
            )}
          </Paper>
        )}
        {user && (
          <UnstyledButton
            onClick={handleLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '9px 12px',
              width: '100%',
              borderRadius: 9,
              color: TEXT_FAINT,
              fontSize: '0.82rem',
              fontWeight: 500,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = SURFACE_HOVER;
              e.currentTarget.style.color = `var(--cp-surface-text)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = TEXT_FAINT;
            }}
          >
            <IconLogout size={16} />
            Log out
          </UnstyledButton>
        )}
      </Box>
    </Stack>
  );
}
