import { Box } from '@mantine/core';
import { StatTileRow } from '../../components/club/StatTile';
import type { RegistrationSummary } from '../../utils/registrationSummary';

/**
 * The counts above the table.
 *
 * Takes a computed summary rather than rows. The club tab's numbers come from
 * /api/admin/registration-summary, which covers the whole filtered set rather
 * than the page on screen; the personal tab still computes its own with
 * summariseRegistrations, where the row set is small and already complete.
 */
export function RegistrationsSummary({ summary }: { summary: RegistrationSummary }) {
  return (
    <Box role="group" aria-label="Registrations summary">
      <StatTileRow
        cols={6}
        items={[
          { value: summary.registrations, label: 'Registrations' },
          { value: summary.players, label: 'Players' },
          // What the club charges for: a merged group counts once.
          { value: summary.billableUnits, label: 'Billable units' },
          { value: summary.paying, label: 'Paying' },
          { value: summary.outstanding, label: 'Outstanding' },
          { value: summary.noLevel, label: 'No level assigned' },
        ]}
      />
    </Box>
  );
}
