import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon, Alert, Badge, Box, Button, Center, Divider, Group, Loader,
  NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle, IconDeviceFloppy, IconPencil, IconPlus,
  IconTrash, IconUsersGroup, IconX,
} from '@tabler/icons-react';
import { clubDesign } from '../../theme';
import {
  formatGBP, INTERVAL_OPTIONS, type IntervalUnit,
  type StatusRate, type SubscriptionLevel, type TeamRow, type TeamStatusRate,
} from './types';

interface Props {
  clubHeaders: HeadersInit;
}

export function SubscriptionLevelsTab({ clubHeaders }: Props) {
  const [levels, setLevels] = useState<SubscriptionLevel[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [statuses, setStatuses] = useState<string[]>([]);
  const [clubRates, setClubRates] = useState<StatusRate[]>([]);
  const [teamRates, setTeamRates] = useState<TeamStatusRate[]>([]);

  const [addTeamName, setAddTeamName] = useState<string | null>(null);
  const [addStatus, setAddStatus] = useState<string | null>(null);
  const [addLevelId, setAddLevelId] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [yearlyGbp, setYearlyGbp] = useState<number | string>('');
  const [intervalCount, setIntervalCount] = useState<number | string>(10);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>('monthly');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const refresh = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [lvlRes, teamsRes, statusRes] = await Promise.all([
        fetch('/api/admin/subscription-levels', { headers: clubHeaders }),
        fetch('/api/admin/team-subscription-levels', { headers: clubHeaders }),
        fetch('/api/admin/status-subscription-levels', { headers: clubHeaders }),
      ]);
      if (!lvlRes.ok) throw new Error('Failed to load subscription levels');
      if (!teamsRes.ok) throw new Error('Failed to load teams');
      if (!statusRes.ok) throw new Error('Failed to load status rates');
      const lvlData = await lvlRes.json() as { levels: SubscriptionLevel[] };
      const teamsData = await teamsRes.json() as { teams: TeamRow[] };
      const statusData = await statusRes.json() as { statuses: string[]; clubRates: StatusRate[]; teamRates: TeamStatusRate[] };
      setLevels(lvlData.levels);
      setTeams(teamsData.teams);
      setStatuses(statusData.statuses);
      setClubRates(statusData.clubRates);
      setTeamRates(statusData.teamRates);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setYearlyGbp('');
    setIntervalCount(10);
    setIntervalUnit('monthly');
    setSaveError('');
  };

  const startEdit = (lvl: SubscriptionLevel) => {
    setEditingId(lvl.id);
    setName(lvl.name);
    setYearlyGbp(lvl.yearlyPriceInPence / 100);
    setIntervalCount(lvl.intervalCount);
    setIntervalUnit(lvl.intervalUnit);
    setSaveError('');
  };

  const handleSave = async () => {
    setSaveError('');
    const parsedYearly = typeof yearlyGbp === 'string' ? parseFloat(yearlyGbp) : yearlyGbp;
    const parsedCount = typeof intervalCount === 'string' ? parseInt(intervalCount, 10) : intervalCount;
    if (!name.trim()) { setSaveError('Name is required'); return; }
    if (!Number.isFinite(parsedYearly) || parsedYearly <= 0) { setSaveError('Yearly price must be greater than zero'); return; }
    if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 52) { setSaveError('Number of payments must be between 1 and 52'); return; }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        yearlyPriceInPence: Math.round(parsedYearly * 100),
        intervalCount: parsedCount,
        intervalUnit,
      };
      const res = await fetch(
        editingId ? `/api/admin/subscription-levels/${editingId}` : '/api/admin/subscription-levels',
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json', ...clubHeaders },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? 'Failed to save');
      }
      resetForm();
      await refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this subscription level? It will be unassigned from any teams.')) return;
    const res = await fetch(`/api/admin/subscription-levels/${id}`, { method: 'DELETE', headers: clubHeaders });
    if (res.ok) {
      if (editingId === id) resetForm();
      await refresh();
    }
  };

  const handleAssign = async (teamName: string, levelId: string | null) => {
    const res = await fetch('/api/admin/team-subscription-levels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...clubHeaders },
      body: JSON.stringify({ teamName, subscriptionLevelId: levelId }),
    });
    if (res.ok) await refresh();
  };

  const handleAssignClubStatus = async (registrationStatus: string, levelId: string | null) => {
    const res = await fetch('/api/admin/status-subscription-levels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...clubHeaders },
      body: JSON.stringify({ registrationStatus, subscriptionLevelId: levelId }),
    });
    if (res.ok) await refresh();
  };

  const handleAssignTeamStatus = async (teamName: string, registrationStatus: string, levelId: string | null) => {
    const res = await fetch('/api/admin/status-subscription-levels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...clubHeaders },
      body: JSON.stringify({ teamName, registrationStatus, subscriptionLevelId: levelId }),
    });
    if (res.ok) await refresh();
  };

  const handleAddTeamStatusRule = async () => {
    if (!addTeamName || !addStatus || !addLevelId) return;
    setAddSaving(true);
    await handleAssignTeamStatus(addTeamName, addStatus, addLevelId);
    setAddTeamName(null);
    setAddStatus(null);
    setAddLevelId(null);
    setAddSaving(false);
  };

  const levelOptions = useMemo(
    () => levels.map(l => ({
      value: l.id,
      label: `${l.name} — ${formatGBP(l.yearlyPriceInPence)}/yr`,
    })),
    [levels]
  );

  const previewPence = (() => {
    const yp = typeof yearlyGbp === 'string' ? parseFloat(yearlyGbp) : yearlyGbp;
    const ic = typeof intervalCount === 'string' ? parseInt(intervalCount, 10) : intervalCount;
    if (Number.isFinite(yp) && yp > 0 && Number.isInteger(ic) && ic > 0) {
      return Math.round((yp * 100) / ic);
    }
    return null;
  })();
  const previewCount = typeof intervalCount === 'string' ? parseInt(intervalCount, 10) : intervalCount;

  return (
    <Stack gap="lg">
      {loadError && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" radius="md">
          {loadError}
        </Alert>
      )}

      {/* Define / edit form */}
      <Paper p={{ base: 'md', sm: 'lg' }} withBorder radius="md">
        <Stack gap="md">
          <Text fw={700} ff={clubDesign.font.heading} fz="md">
            {editingId ? 'Edit subscription level' : 'Create a subscription level'}
          </Text>

          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
            <TextInput
              label="Name"
              placeholder="e.g. 5 aside, 7 aside"
              value={name}
              onChange={e => setName(e.target.value)}
              radius="md"
              maxLength={80}
            />
            <NumberInput
              label="Yearly price (£)"
              placeholder="e.g. 250"
              value={yearlyGbp}
              onChange={setYearlyGbp}
              min={0}
              decimalScale={2}
              fixedDecimalScale={false}
              thousandSeparator=","
              prefix="£"
              radius="md"
            />
            <NumberInput
              label="Number of payments"
              description="e.g. 10 instalments"
              value={intervalCount}
              onChange={setIntervalCount}
              min={1}
              max={52}
              radius="md"
            />
            <Select
              label="Interval"
              data={INTERVAL_OPTIONS}
              value={intervalUnit}
              onChange={v => setIntervalUnit((v as IntervalUnit) ?? 'monthly')}
              radius="md"
            />
          </SimpleGrid>

          {previewPence != null && Number.isInteger(previewCount) && previewCount > 0 && (
            <Alert color="blue" variant="light" radius="md">
              <Text size="sm">
                Players pay <strong>{formatGBP(previewPence)}</strong> per{' '}
                {intervalUnit === 'weekly' ? 'week' : intervalUnit === 'yearly' ? 'year' : 'month'} for{' '}
                <strong>{previewCount}</strong> payments — total <strong>{formatGBP(previewPence * previewCount)}</strong>.
              </Text>
            </Alert>
          )}

          {saveError && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" radius="md">
              {saveError}
            </Alert>
          )}

          <Group wrap="wrap">
            <Button
              onClick={handleSave}
              disabled={saving}
              leftSection={saving ? <Loader size={14} color="white" /> : <IconDeviceFloppy size={16} />}
              radius="xl"
            >
              {editingId ? 'Save changes' : 'Create level'}
            </Button>
            {editingId && (
              <Button variant="subtle" onClick={resetForm} leftSection={<IconX size={16} />} radius="xl">
                Cancel
              </Button>
            )}
          </Group>
        </Stack>
      </Paper>

      {/* Existing levels */}
      <Paper p={{ base: 'md', sm: 'lg' }} withBorder radius="md">
        <Stack gap="md">
          <Text fw={700} ff={clubDesign.font.heading} fz="md">Defined levels</Text>
          {loading ? (
            <Center h={60}><Loader size="sm" /></Center>
          ) : levels.length === 0 ? (
            <Box p="md" style={{ background: clubDesign.color.n1, border: `1px dashed ${clubDesign.color.n3}`, borderRadius: 8 }}>
              <Text size="sm" c="dimmed" ta="center">
                No subscription levels yet. Create one above.
              </Text>
            </Box>
          ) : (
            <Table.ScrollContainer minWidth={560}>
              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Yearly</Table.Th>
                    <Table.Th>Plan</Table.Th>
                    <Table.Th>Per payment</Table.Th>
                    <Table.Th>Teams</Table.Th>
                    <Table.Th></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {levels.map(l => {
                    const teamCount = teams.filter(t => t.subscriptionLevelId === l.id).length;
                    const per = Math.round(l.yearlyPriceInPence / Math.max(1, l.intervalCount));
                    return (
                      <Table.Tr key={l.id}>
                        <Table.Td><Text fw={600}>{l.name}</Text></Table.Td>
                        <Table.Td>{formatGBP(l.yearlyPriceInPence)}</Table.Td>
                        <Table.Td><Text size="sm">{l.intervalCount} × {l.intervalUnit}</Text></Table.Td>
                        <Table.Td>{formatGBP(per)}</Table.Td>
                        <Table.Td>
                          <Badge variant="light" color={teamCount ? 'blue' : 'gray'}>{teamCount}</Badge>
                        </Table.Td>
                        <Table.Td>
                          <Group gap="xs" justify="flex-end" wrap="nowrap">
                            <Tooltip label="Edit">
                              <ActionIcon variant="subtle" onClick={() => startEdit(l)}>
                                <IconPencil size={16} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Delete">
                              <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(l.id)}>
                                <IconTrash size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Stack>
      </Paper>

      {/* Assign to teams */}
      <Paper p={{ base: 'md', sm: 'lg' }} withBorder radius="md">
        <Stack gap="md">
          <Group justify="space-between" align="flex-end" wrap="wrap">
            <div style={{ minWidth: 0 }}>
              <Text fw={700} ff={clubDesign.font.heading} fz="md">Assign to teams</Text>
              <Text size="sm" c="dimmed">
                Every player registered to a team inherits its level.
              </Text>
            </div>
            <Badge leftSection={<IconUsersGroup size={12} />} variant="light">
              {teams.length} team{teams.length === 1 ? '' : 's'}
            </Badge>
          </Group>

          {loading ? (
            <Center h={60}><Loader size="sm" /></Center>
          ) : teams.length === 0 ? (
            <Box p="md" style={{ background: clubDesign.color.n1, border: `1px dashed ${clubDesign.color.n3}`, borderRadius: 8 }}>
              <Text size="sm" c="dimmed" ta="center">
                No teams found. Import players first via Admin → Import Players.
              </Text>
            </Box>
          ) : (
            <Table.ScrollContainer minWidth={640}>
              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Team</Table.Th>
                    <Table.Th>Players</Table.Th>
                    <Table.Th>Subscription level</Table.Th>
                    <Table.Th>Per payment</Table.Th>
                    <Table.Th></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {teams.map(t => {
                    const per = (t.yearlyPriceInPence != null && t.intervalCount != null)
                      ? Math.round(t.yearlyPriceInPence / Math.max(1, t.intervalCount))
                      : null;
                    return (
                      <Table.Tr key={t.teamName}>
                        <Table.Td><Text fw={600}>{t.teamName}</Text></Table.Td>
                        <Table.Td><Badge variant="light">{t.playerCount}</Badge></Table.Td>
                        <Table.Td style={{ minWidth: 240 }}>
                          <Select
                            placeholder="No level assigned"
                            data={levelOptions}
                            value={t.subscriptionLevelId}
                            onChange={(v) => handleAssign(t.teamName, v ?? null)}
                            clearable
                            radius="md"
                            size="sm"
                            nothingFoundMessage="Create a level first"
                          />
                        </Table.Td>
                        <Table.Td>
                          {per != null ? (
                            <Text size="sm">{formatGBP(per)} × {t.intervalCount} {t.intervalUnit}</Text>
                          ) : (
                            <Text size="sm" c="dimmed">—</Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          {t.subscriptionLevelId && (
                            <Tooltip label="Clear">
                              <ActionIcon variant="subtle" color="gray" onClick={() => handleAssign(t.teamName, null)}>
                                <IconX size={16} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Stack>
      </Paper>
      {/* Status-based rates */}
      <Paper p={{ base: 'md', sm: 'lg' }} withBorder radius="md">
        <Stack gap="md">
          <div>
            <Text fw={700} ff={clubDesign.font.heading} fz="md">Status-based rates</Text>
            <Text size="sm" c="dimmed">
              Override the subscription level by registration status. Priority: team + status override → club-wide status → team default.
            </Text>
          </div>

          {/* Club-wide status rates */}
          <Divider label="Club-wide status rates" labelPosition="left" />
          <Text size="sm" c="dimmed">
            Applied to every team unless a team-specific override exists below.
          </Text>

          {loading ? (
            <Center h={40}><Loader size="sm" /></Center>
          ) : statuses.length === 0 ? (
            <Box p="md" style={{ background: clubDesign.color.n1, border: `1px dashed ${clubDesign.color.n3}`, borderRadius: 8 }}>
              <Text size="sm" c="dimmed" ta="center">
                No registration statuses found. Import players to see statuses.
              </Text>
            </Box>
          ) : (
            <Table.ScrollContainer minWidth={560}>
              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Subscription level</Table.Th>
                    <Table.Th>Per payment</Table.Th>
                    <Table.Th></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {statuses.map(status => {
                    const rate = clubRates.find(r => r.registrationStatus === status);
                    const per = rate ? Math.round(rate.yearlyPriceInPence / Math.max(1, rate.intervalCount)) : null;
                    return (
                      <Table.Tr key={status}>
                        <Table.Td><Badge variant="light" color="orange">{status}</Badge></Table.Td>
                        <Table.Td style={{ minWidth: 240 }}>
                          <Select
                            placeholder="No override (uses team default)"
                            data={levelOptions}
                            value={rate?.subscriptionLevelId ?? null}
                            onChange={(v) => handleAssignClubStatus(status, v ?? null)}
                            clearable
                            radius="md"
                            size="sm"
                            nothingFoundMessage="Create a level first"
                          />
                        </Table.Td>
                        <Table.Td>
                          {per != null ? (
                            <Text size="sm">{formatGBP(per)} × {rate!.intervalCount} {rate!.intervalUnit}</Text>
                          ) : (
                            <Text size="sm" c="dimmed">—</Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          {rate && (
                            <Tooltip label="Clear">
                              <ActionIcon variant="subtle" color="gray" onClick={() => handleAssignClubStatus(status, null)}>
                                <IconX size={16} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}

          {/* Team-specific status overrides */}
          <Divider label="Team status overrides" labelPosition="left" mt="xs" />
          <Text size="sm" c="dimmed">
            Override a specific team's rate for a particular status.
          </Text>

          {teamRates.length > 0 && (
            <Table.ScrollContainer minWidth={640}>
              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Team</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Level</Table.Th>
                    <Table.Th>Per payment</Table.Th>
                    <Table.Th></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {teamRates.map(r => {
                    const per = Math.round(r.yearlyPriceInPence / Math.max(1, r.intervalCount));
                    return (
                      <Table.Tr key={`${r.teamName}-${r.registrationStatus}`}>
                        <Table.Td><Text fw={600} size="sm">{r.teamName}</Text></Table.Td>
                        <Table.Td><Badge variant="light" color="orange">{r.registrationStatus}</Badge></Table.Td>
                        <Table.Td><Text size="sm">{r.subscriptionLevelName}</Text></Table.Td>
                        <Table.Td><Text size="sm">{formatGBP(per)} × {r.intervalCount} {r.intervalUnit}</Text></Table.Td>
                        <Table.Td>
                          <Tooltip label="Remove override">
                            <ActionIcon variant="subtle" color="red" onClick={() => handleAssignTeamStatus(r.teamName, r.registrationStatus, null)}>
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}

          {/* Add a new team override */}
          <Box>
            <Text size="sm" fw={600} mb="xs">Add team override</Text>
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
              <Select
                placeholder="Team"
                data={teams.map(t => ({ value: t.teamName, label: t.teamName }))}
                value={addTeamName}
                onChange={setAddTeamName}
                searchable
                radius="md"
                size="sm"
              />
              <Select
                placeholder="Registration status"
                data={statuses.map(s => ({ value: s, label: s }))}
                value={addStatus}
                onChange={setAddStatus}
                searchable
                radius="md"
                size="sm"
                nothingFoundMessage="No statuses found"
              />
              <Select
                placeholder="Subscription level"
                data={levelOptions}
                value={addLevelId}
                onChange={setAddLevelId}
                radius="md"
                size="sm"
                nothingFoundMessage="Create a level first"
              />
            </SimpleGrid>
            <Button
              mt="sm"
              size="sm"
              radius="xl"
              leftSection={addSaving ? <Loader size={12} color="white" /> : <IconPlus size={14} />}
              disabled={!addTeamName || !addStatus || !addLevelId || addSaving}
              onClick={handleAddTeamStatusRule}
            >
              Add override
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Stack>
  );
}
