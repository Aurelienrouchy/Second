import { describe, it, expect } from 'vitest';
import type { TransactionStatus } from '@/types';
import {
  getStatusLabel,
  getStatusVariant,
  getStatusDescription,
  fillFundsReleaseAt,
} from './transactionStatusMeta';

// Every status the backend can persist on a `transactions` doc. Kept here as a
// guard: if the backend adds one, this list (and the meta map) must follow.
const ALL_STATUSES: TransactionStatus[] = [
  'pending_payment',
  'meetup_pending',
  'meetup_confirmed',
  'meetup_completed',
  'paid',
  'label_created',
  'shipped',
  'delivered',
  'completed',
  'return_requested',
  'delivery_failed',
  'lost',
  'cancelled',
  'disputed',
  'refund_in_progress',
  'refunded',
];

const VALID_VARIANTS = new Set(['default', 'primary', 'success', 'warning', 'danger']);

describe('transactionStatusMeta', () => {
  it('maps every known status to a non-empty buyer + seller label', () => {
    for (const status of ALL_STATUSES) {
      expect(getStatusLabel(status, 'buyer').length).toBeGreaterThan(0);
      expect(getStatusLabel(status, 'seller').length).toBeGreaterThan(0);
    }
  });

  it('maps every known status to a valid DS badge variant', () => {
    for (const status of ALL_STATUSES) {
      expect(VALID_VARIANTS.has(getStatusVariant(status))).toBe(true);
    }
  });

  it('maps every known status to a non-empty buyer + seller description', () => {
    for (const status of ALL_STATUSES) {
      expect(getStatusDescription(status, 'buyer').length).toBeGreaterThan(0);
      expect(getStatusDescription(status, 'seller').length).toBeGreaterThan(0);
    }
  });

  it('gives buyer and seller distinct labels where the perspective differs', () => {
    // `paid` reads differently for each side ("en préparation" vs "à expédier").
    expect(getStatusLabel('paid', 'buyer')).not.toBe(getStatusLabel('paid', 'seller'));
  });

  it('never throws and returns a neutral fallback for an unknown status (F126)', () => {
    const unknown = 'some_future_backend_status' as unknown as TransactionStatus;
    expect(() => getStatusLabel(unknown, 'buyer')).not.toThrow();
    expect(() => getStatusVariant(unknown)).not.toThrow();
    expect(() => getStatusDescription(unknown, 'seller')).not.toThrow();
    expect(getStatusVariant(unknown)).toBe('default');
    expect(getStatusLabel(unknown, 'buyer').length).toBeGreaterThan(0);
    expect(getStatusDescription(unknown, 'seller').length).toBeGreaterThan(0);
  });
});

describe('fillFundsReleaseAt', () => {
  it('substitutes the placeholder with the formatted date', () => {
    const text = getStatusDescription('delivered', 'buyer');
    expect(text).toContain('{fundsReleaseAt}');
    const filled = fillFundsReleaseAt(text, '15 juin');
    expect(filled).toContain('15 juin');
    expect(filled).not.toContain('{fundsReleaseAt}');
  });

  it('falls back to "sous peu" when no date is supplied', () => {
    expect(fillFundsReleaseAt('libéré le {fundsReleaseAt}.')).toContain('sous peu');
  });

  it('returns the text unchanged when there is no placeholder', () => {
    expect(fillFundsReleaseAt('Vente finalisée.')).toBe('Vente finalisée.');
  });
});
