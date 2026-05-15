export type IntervalUnit = 'weekly' | 'monthly' | 'yearly';

export interface PlayerRegistrationRow {
  fanId: string;
  registrationId: string;
  teamName: string;
  ageGroup: string | null;
  registrationExpiry: string | null;
  registrationStatus: string | null;
  linkedAccounts: string | null;
  subscriptionLevelId: string | null;
  subscriptionLevelName: string | null;
  yearlyPriceInPence: number | null;
  intervalCount: number | null;
  intervalUnit: IntervalUnit | null;
}

export interface PlayerPaymentRow {
  id: string;
  registrationId: string;
  fanId: string;
  teamName: string;
  reference: string;
  mandateId: string;
  subscriptionId: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface SubscriptionLevel {
  id: string;
  name: string;
  yearlyPriceInPence: number;
  intervalCount: number;
  intervalUnit: IntervalUnit;
}

export interface TeamRow {
  teamName: string;
  playerCount: number;
  subscriptionLevelId: string | null;
  subscriptionLevelName: string | null;
  yearlyPriceInPence: number | null;
  intervalCount: number | null;
  intervalUnit: IntervalUnit | null;
}

export interface StatusRate {
  registrationStatus: string;
  subscriptionLevelId: string;
  subscriptionLevelName: string;
  yearlyPriceInPence: number;
  intervalCount: number;
  intervalUnit: IntervalUnit;
}

export interface TeamStatusRate extends StatusRate {
  teamName: string;
}

export const INTERVAL_OPTIONS: { value: IntervalUnit; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'yearly', label: 'Yearly' },
];

export const PAYMENT_TYPES = [
  { value: 'SUBS', label: 'Subscription Fees' },
  { value: 'TOUR', label: 'Tournament Fees' },
  { value: 'KIT', label: 'Kit Payment' },
  { value: 'EVENT', label: 'Event Ticket' },
  { value: 'OTHER', label: 'Other' },
] as const;

export const ONE_TIME_TYPES = PAYMENT_TYPES.filter(t => t.value !== 'SUBS');

export function formatGBP(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
}
