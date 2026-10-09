import * as XLSX from 'xlsx';
import { getSubscriptionStatus } from '../../utils/subscriptionStatus';
import { buildPaymentLink } from '../../utils/paymentLink';
import { ALL, type ClubFilters, type RegistrationRow } from './types';

export function exportRegistrationsToXlsx(
  rows: RegistrationRow[],
  clubSlug: string,
  filters: ClubFilters,
) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const data = rows.map(r => ({
    'FAN ID':            r.fanId,
    'Team':              r.teamName,
    'Status':            r.registrationStatus ?? '',
    'Expiry':            r.registrationExpiry ?? '',
    'Linked Accounts':   r.linkedAccounts ?? '',
    'Subscription Level': r.subscriptionLevelName ?? '',
    'Subscription Status': getSubscriptionStatus(r).label,
    // Or a merged row exports as paid with nothing to explain why.
    'Billed Via':        r.billedWithTeamName
      ? `Billed with ${r.billedWithTeamName}`
      : r.mergedTeamNames ? `Also covers ${r.mergedTeamNames}` : '',
    'Marked Paid By':    r.manualPaidBy ?? '',
    'Payment Link':      buildPaymentLink(origin, clubSlug, r.fanId),
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    { wch: 12 }, // FAN ID
    { wch: 22 }, // Team
    { wch: 14 }, // Status
    { wch: 12 }, // Expiry
    { wch: 38 }, // Linked Accounts
    { wch: 22 }, // Subscription Level
    { wch: 18 }, // Subscription Status
    { wch: 32 }, // Billed Via
    { wch: 28 }, // Marked Paid By
    { wch: 60 }, // Payment Link
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Registrations');

  const today = new Date().toISOString().slice(0, 10);
  const filterSuffix = [
    filters.team         !== ALL ? filters.team         : null,
    filters.status       !== ALL ? filters.status       : null,
    filters.subscription !== ALL ? filters.subscription : null,
  ].filter(Boolean).join('-').replace(/[^A-Za-z0-9-]+/g, '_');

  const fileSlug = clubSlug || 'club';
  const filename = filterSuffix
    ? `${fileSlug}-registrations-${filterSuffix}-${today}.xlsx`
    : `${fileSlug}-registrations-${today}.xlsx`;

  XLSX.writeFile(wb, filename);
}
