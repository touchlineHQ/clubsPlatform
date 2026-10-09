/** Shared types and constants for the registrations page and its parts. */

export interface RegistrationRow {
  registrationId: string;
  fanId: string;
  teamName: string;
  ageGroup: string | null;
  registrationExpiry: string | null;
  registrationStatus: string | null;
  relationship: string | null;
  linkedAccounts: string | null;
  subscriptionLevelId: string | null;
  overrideLevelId: string | null;
  subscriptionLevelName: string | null;
  paymentStatus: string | null;
  // Billing group — see functions/lib/registration-merge.ts. Sent only for rows
  // that are in a group, so a club that has merged nothing carries none of these.
  // A merged row shows its group's payment status; these say why.
  /** The registration this one is billed through. Absent means itself. */
  billingRegistrationId?: string;
  /** This registration's primary's team, when it is billed through another. */
  billedWithTeamName?: string | null;
  /** The other teams this registration is billed for, when it is a primary. */
  mergedTeamNames?: string | null;
  // Manual override attribution — admin (club) rows only; never sent to players.
  manualPaidBy?: string | null;
  manualPaidAt?: number | null;
  manualNote?: string | null;
}

export interface SubscriptionLevel {
  id: string;
  name: string;
}

interface Response {
  personal: RegistrationRow[];
  club: RegistrationRow[] | null;
  scope: 'admin' | 'user';
  /** Epoch ms of the club's most recent committed player import; admins only. */
  lastImportedAt: number | null;
}

export const DEFAULT_VALUE = '__default__';

/**
 * Mirrors MAX_MERGE_GROUP in api/admin/registration-merges.ts, so the admin is
 * told before meeting the 400. The server's cap is on the members *besides* the
 * primary, hence the +1 here.
 */
export const MAX_MERGE_SELECTION = 12;

/**
 * The sortable columns.
 *
 * `sixthCol` — Linked accounts — is gone. On the club tab it sorted on the
 * first email of a GROUP_CONCAT, which is near-meaningless and which the
 * server cannot reproduce from an index. The personal tab's sixth column is
 * Relationship, which was never worth sorting either.
 */
export type SortKey =
  | 'fanId'
  | 'teamName'
  | 'registrationExpiry'
  | 'registrationStatus'
  | 'subscription'
  | 'subscriptionLevel';
export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

export function compareValues(a: string | null | undefined, b: string | null | undefined): number {
  const av = a ?? '';
  const bv = b ?? '';
  if (av === bv) return 0;
  if (av === '') return 1;
  if (bv === '') return -1;
  return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
}
export interface ClubFilters {
  team: string;
  status: string;
  subscription: string;
}

export const ALL = '__all__';
