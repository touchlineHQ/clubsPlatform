import { TextInput, Textarea, Select, Autocomplete, Stack, Group, Title, Paper, Button, Text, ColorInput, Divider, Alert } from '@mantine/core';
import { IconPlus, IconTrash, IconInfoCircle } from '@tabler/icons-react';
import type { Club, AboutItem } from '../../types';
import { ICON_OPTIONS } from './iconOptions';
import { normalizeToHex } from '../../utils/colorShades';

const COLOR_PRESETS = [
  '#f07820', '#e64980', '#7950f2', '#228be6', '#15aabf',
  '#12b886', '#40c057', '#fab005', '#fa5252', '#1a2332',
];

interface Props {
  club: Club;
  onChange: (club: Club) => void;
  clubSlugs?: string[];
}

export function ClubForm({ club, onChange, clubSlugs }: Props) {
  const update = <K extends keyof Club>(key: K, value: Club[K]) =>
    onChange({ ...club, [key]: value });

  const updateAbout = (index: number, field: keyof AboutItem, value: string) => {
    const about = [...club.about];
    about[index] = { ...about[index], [field]: value };
    update('about', about);
  };

  const addAbout = () =>
    update('about', [...club.about, { icon: 'fa-star', title: '', text: '' }]);

  const removeAbout = (i: number) =>
    update('about', club.about.filter((_, idx) => idx !== i));

  const updateHistory = (index: number, value: string) => {
    const history = [...club.history];
    history[index] = value;
    update('history', history);
  };

  return (
    <Stack gap="lg">
      <Title order={4}>Club Identity</Title>

      <Group grow>
        <TextInput label="Club Name" value={club.name} onChange={e => update('name', e.target.value)} />
        <TextInput label="Short Name" description="Used in the header" value={club.tagShort ?? ''} onChange={e => update('tagShort', e.target.value)} />
      </Group>

      <TextInput label="Tagline" value={club.tagline} onChange={e => update('tagline', e.target.value)} />

      <Group grow>
        <TextInput label="Founded Year" type="number" value={club.founded} onChange={e => update('founded', Number(e.target.value))} />
        <TextInput label="Email" value={club.email} onChange={e => update('email', e.target.value)} />
      </Group>

      <Divider label="Address" />

      <Group grow>
        <TextInput label="Line 1" value={club.address.line1} onChange={e => update('address', { ...club.address, line1: e.target.value })} />
        <TextInput label="Line 2" value={club.address.line2} onChange={e => update('address', { ...club.address, line2: e.target.value })} />
      </Group>
      <Group grow>
        <TextInput label="Postcode" value={club.address.postcode} onChange={e => update('address', { ...club.address, postcode: e.target.value })} />
        <TextInput label="What3Words" value={club.what3words} onChange={e => update('what3words', e.target.value)} />
      </Group>

      <Divider label="Socials & Links" />

      <Group grow>
        <TextInput label="Facebook URL" value={club.socials.facebook} onChange={e => update('socials', { ...club.socials, facebook: e.target.value })} />
        <TextInput label="Instagram URL" value={club.socials.instagram} onChange={e => update('socials', { ...club.socials, instagram: e.target.value })} />
        <TextInput label="Twitter / X URL" value={club.socials.twitter} onChange={e => update('socials', { ...club.socials, twitter: e.target.value })} />
      </Group>
      <TextInput
        label="Club Shop URL"
        description="If set, a Shop link appears in the sidebar. Leave blank to hide."
        placeholder="https://shop.yourclub.co.uk"
        value={club.shopUrl ?? ''}
        onChange={e => update('shopUrl', e.target.value || undefined)}
      />

      <Divider label="Appearance" />

      <Alert icon={<IconInfoCircle size={16} />} variant="light" mb="xs">
        <Text size="xs">
          Primary colour drives CTAs, active nav state and the user-chip avatar.
          Secondary is used in the sidebar and dark surfaces — typically a deeper
          shade of your kit colour. Each picks a full 10-step shade palette
          automatically.
        </Text>
      </Alert>

      <Group grow>
        <ColorInput
          label="Primary Colour"
          format="hex"
          swatches={COLOR_PRESETS}
          swatchesPerRow={10}
          value={normalizeToHex(club.primaryColor) ?? '#f07820'}
          onChange={v => update('primaryColor', v || undefined)}
        />
        <ColorInput
          label="Secondary Colour"
          format="hex"
          swatches={COLOR_PRESETS}
          swatchesPerRow={10}
          value={normalizeToHex(club.secondaryColor) ?? '#1a2332'}
          onChange={v => update('secondaryColor', v || undefined)}
        />
      </Group>

      <TextInput label="Badge Image Path" description="e.g. images/badge.png" value={club.badge ?? ''} onChange={e => update('badge', e.target.value)} />

      <Group grow>
        <TextInput label="Kit Colours" description="e.g. Blue and white" value={club.colours ?? ''} onChange={e => update('colours', e.target.value)} />
        <TextInput label="Kit Description" value={club.kitDescription ?? ''} onChange={e => update('kitDescription', e.target.value)} />
      </Group>

      <Divider label="Live Feeds (fulltimeFeeds)" />

      <Alert icon={<IconInfoCircle size={16} />} variant="light" mb="xs">
        <Text size="xs">Select your club from the dropdown to connect live fixtures. If your club isn't listed, you can type a slug manually.</Text>
      </Alert>

      <Autocomplete
        label="Club Feed"
        description="Type to search or enter a custom slug"
        data={clubSlugs ?? []}
        value={club.clubFeedSlug ?? ''}
        onChange={v => update('clubFeedSlug', v)}
        onOptionSubmit={v => update('clubFeedSlug', v)}
        limit={20}
        placeholder={clubSlugs && clubSlugs.length > 0 ? 'Search clubs...' : 'Loading clubs...'}
      />

      <Divider label="Home Banner" />

      <Textarea
        label="Home Page Banner"
        description="HTML supported (e.g. <strong>bold</strong>)"
        value={club.homeBanner ?? ''}
        onChange={e => update('homeBanner', e.target.value)}
        minRows={3}
      />

      <Divider label="Ground / Matchday" />

      <Group grow>
        <TextInput label="Ground Image Path" value={club.groundImage ?? ''} onChange={e => update('groundImage', e.target.value)} />
        <TextInput label="Ground Image Alt Text" value={club.groundImageAlt ?? ''} onChange={e => update('groundImageAlt', e.target.value)} />
      </Group>

      <Divider label="About Items" />

      {club.about.map((item, i) => (
        <Paper key={i} p="sm" withBorder>
          <Group justify="space-between" mb="xs">
            <Text size="sm" fw={600}>Item {i + 1}</Text>
            <Button size="compact-xs" variant="subtle" color="red" onClick={() => removeAbout(i)} leftSection={<IconTrash size={12} />}>Remove</Button>
          </Group>
          <Group grow mb="xs">
            <Select label="Icon" data={ICON_OPTIONS} value={item.icon} onChange={v => updateAbout(i, 'icon', v ?? 'fa-star')} searchable />
            <TextInput label="Title" value={item.title} onChange={e => updateAbout(i, 'title', e.target.value)} />
          </Group>
          <Textarea label="Text" description="HTML supported" value={item.text} onChange={e => updateAbout(i, 'text', e.target.value)} minRows={2} />
        </Paper>
      ))}
      <Button variant="light" leftSection={<IconPlus size={14} />} onClick={addAbout}>Add About Item</Button>

      <Divider label="Club History" />

      {club.history.map((para, i) => (
        <Paper key={i} p="sm" withBorder>
          <Group justify="space-between" mb="xs">
            <Text size="sm" fw={600}>Paragraph {i + 1}</Text>
            <Button size="compact-xs" variant="subtle" color="red" onClick={() => update('history', club.history.filter((_, idx) => idx !== i))} leftSection={<IconTrash size={12} />}>Remove</Button>
          </Group>
          <Textarea value={para} onChange={e => updateHistory(i, e.target.value)} minRows={3} />
        </Paper>
      ))}
      <Button variant="light" leftSection={<IconPlus size={14} />} onClick={() => update('history', [...club.history, ''])}>Add Paragraph</Button>
    </Stack>
  );
}
