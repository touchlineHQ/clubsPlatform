import type { Env } from '../../lib/api-helpers';
export type { Env };

export interface GCBillingRequest {
  id: string;
  status: string;
  mandate_request?: {
    scheme: string;
    description?: string;
  };
  metadata: Record<string, string>;
  links?: {
    customer?: string;
    customer_billing_detail?: string;
    customer_bank_account?: string;
    creditor?: string;
    organisation?: string;
    mandate_request?: string;
    mandate_request_mandate?: string;
  };
}

export interface GCBillingRequestFlow {
  id: string;
  authorisation_url: string;
  redirect_uri: string;
  exit_uri: string;
}

export interface GCMandate {
  id: string;
  /**
   * pending_customer_approval | pending_submission | submitted | active |
   * failed | cancelled | expired | consumed | blocked.
   * Kept as a plain string (like the interfaces above) so an unrecognised
   * status from GoCardless doesn't fail type-checking.
   */
  status: string;
  scheme?: string;
  reference?: string | null;
  /**
   * YYYY-MM-DD. The earliest date a payment against this mandate can be
   * charged, accounting for Bacs submission lead time. Null for mandates that
   * can never be charged again (cancelled, failed, expired).
   */
  next_possible_charge_date: string | null;
  metadata?: Record<string, string>;
  links?: {
    customer?: string;
    customer_bank_account?: string;
    creditor?: string;
  };
}

export interface GCSubscription {
  id: string;
  status: string;
  amount: number;
  currency: string;
  interval_unit: 'monthly' | 'weekly' | 'yearly';
  name: string;
  metadata?: Record<string, string>;
  links: {
    mandate: string;
  };
}

export interface CreateLinkBody {
  registrationId: string;
  paymentType: string;
  amountInPence: number;
  intervalUnit: 'monthly' | 'weekly' | 'yearly';
  /** Optional total number of payments (passed through to the GC subscription `count`). */
  count?: number;
  /** YYYY-MM-DD. Configured first payment date. */
  startDate?: string | null;
  description?: string;
}
