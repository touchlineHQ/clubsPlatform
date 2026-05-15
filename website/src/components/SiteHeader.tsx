import { Burger, Group, Text, ActionIcon, Badge, Box, Button, Menu } from '@mantine/core';
import { IconBrandFacebook, IconBrandInstagram, IconBrandTwitter, IconUser, IconLogout, IconSettings, IconUsers, IconArrowLeft } from '@tabler/icons-react';
import { Link, useNavigate } from 'react-router-dom';
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

export function SiteHeader({ club, sections, navOpen, onNavToggle }: Props) {
  const clubShort = club.tagShort ?? club.name.replace(/ FC$/i, '');
  const showFcSuffix = !club.tagShort && / FC$/i.test(club.name);

  const { activeSection, setActiveSection } = useSection();
  const { user, isAdmin, isPlatformAdmin, loading: authLoading } = useAuth();
  const { isMultiClub, clubSlug, clubs } = useClub();
  const navigate = useNavigate();

  const belongsToClub = !isMultiClub || isPlatformAdmin || user?.clubSlug === clubSlug;
  const canAdmin = isAdmin && belongsToClub;

  // For cross-club users, find their home club so we can link to it.
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

  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group wrap="nowrap">
        <Burger opened={navOpen} onClick={onNavToggle} hiddenFrom="md" size="sm" />
        {isMultiClub && (
          <ActionIcon
            component="a"
            href="/"
            variant="subtle"
            aria-label="All clubs"
            title="All clubs"
            visibleFrom="sm"
          >
            <IconArrowLeft size={16} />
          </ActionIcon>
        )}
        <Text
          component={Link}
          to="/"
          fw={700}
          size="lg"
          c="var(--mantine-primary-color-filled)"
          style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          {clubShort}
          {showFcSuffix && (
            <Text component="span" fw={400} c="dimmed"> FC</Text>
          )}
        </Text>
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
            <IconBrandFacebook size={20} />
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
            <IconBrandInstagram size={20} />
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
            <IconBrandTwitter size={20} />
          </ActionIcon>
        )}

        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          {logosToShow.map(s => (
            <img
              key={s.id}
              src={s.logo}
              alt={`${s.name} logo`}
              height={44}
              width={44}
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
