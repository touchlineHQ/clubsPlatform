import { useState } from 'react';
import { Button, Text, Group } from '@mantine/core';
import { IconDeviceFloppy, IconCheck, IconX } from '@tabler/icons-react';
import type { AppData, Club } from '../../types';
import { useClub } from '../../context/ClubContext';

interface Props {
  data: AppData;
  onSaved?: (club: Club) => void;
}

export function SaveButton({ data, onSaved }: Props) {
  const { clubSlug } = useClub();
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  const h = (): HeadersInit => ({ 'Content-Type': 'application/json', 'X-Club-Slug': clubSlug });

  const req = async (method: string, url: string, body: unknown) => {
    const res = await fetch(url, { method, headers: h(), body: JSON.stringify(body) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error ?? `${url} failed: ${res.status}`);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setResult(null);
    try {
      await Promise.all([
        req('PATCH', '/api/club', data.club),
        req('POST', '/api/content', { file: 'website/public/data/teams.json', content: data.teams }),
        req('POST', '/api/content', { file: 'website/public/data/committee.json', content: data.committee }),
        req('POST', '/api/content', { file: 'website/public/data/news.json', content: { items: data.news } }),
        req('POST', '/api/registration', { items: data.registration }),
        req('POST', '/api/gallery', { items: data.gallery }),
        req('POST', '/api/matchday', { items: data.matchday }),
      ]);
      setResult('success');
      onSaved?.(data.club);
      window.location.reload();
    } catch {
      setResult('error');
    } finally {
      setSaving(false);
      setTimeout(() => setResult(null), 5000);
    }
  };

  return (
    <Group gap="sm">
      <Button
        leftSection={<IconDeviceFloppy size={16} />}
        onClick={handleSave}
        loading={saving}
        color={result === 'success' ? 'green' : result === 'error' ? 'red' : undefined}
      >
        {result === 'success' ? 'Saved!' : result === 'error' ? 'Error' : 'Save to Site'}
      </Button>
      {result === 'success' && (
        <Group gap={4}>
          <IconCheck size={14} color="green" />
          <Text size="xs" c="green">Changes saved successfully</Text>
        </Group>
      )}
      {result === 'error' && (
        <Group gap={4}>
          <IconX size={14} color="red" />
          <Text size="xs" c="red">Failed to save — check console for details</Text>
        </Group>
      )}
    </Group>
  );
}
