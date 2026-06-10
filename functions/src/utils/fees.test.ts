import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateFees, calculateServiceFee, getServiceFeeConfig } from './fees';

describe('calculateFees', () => {
  it('applies minimum fee for low-price articles (5$)', () => {
    const result = calculateFees(5, 0);
    expect(result.serviceFee).toBe(2.00);
    expect(result.sellerPayout).toBe(5);
    expect(result.buyerTotal).toBe(7.00);
  });

  it('calculates 15$ article correctly', () => {
    const result = calculateFees(15, 0);
    // 15 * 0.05 + 1.50 = 2.25
    expect(result.serviceFee).toBe(2.25);
    expect(result.buyerTotal).toBe(17.25);
  });

  it('calculates 30$ article correctly', () => {
    const result = calculateFees(30, 0);
    // 30 * 0.05 + 1.50 = 3.00
    expect(result.serviceFee).toBe(3.00);
    expect(result.buyerTotal).toBe(33.00);
  });

  it('calculates 50$ article correctly', () => {
    const result = calculateFees(50, 0);
    // 50 * 0.05 + 1.50 = 4.00
    expect(result.serviceFee).toBe(4.00);
    expect(result.buyerTotal).toBe(54.00);
  });

  it('calculates 100$ article correctly', () => {
    const result = calculateFees(100, 0);
    // 100 * 0.05 + 1.50 = 6.50
    expect(result.serviceFee).toBe(6.50);
    expect(result.buyerTotal).toBe(106.50);
  });

  it('includes shipping in buyerTotal but not in fee calculation', () => {
    const result = calculateFees(50, 10);
    expect(result.serviceFee).toBe(4.00);
    expect(result.shippingCost).toBe(10);
    expect(result.buyerTotal).toBe(64.00);
  });

  it('seller always receives 100% of article price', () => {
    const result = calculateFees(75, 15);
    expect(result.sellerPayout).toBe(75);
  });

  it('returns correct fee config values', () => {
    const result = calculateFees(50, 0);
    expect(result.serviceFeePercent).toBe(5);
    expect(result.serviceFeeFixed).toBe(1.50);
  });

  it('handles zero price article', () => {
    const result = calculateFees(0, 0);
    // 0 * 0.05 + 1.50 = 1.50 → min 2.00
    expect(result.serviceFee).toBe(2.00);
    expect(result.buyerTotal).toBe(2.00);
  });

  it('handles zero shipping', () => {
    const result = calculateFees(20, 0);
    expect(result.shippingCost).toBe(0);
    expect(result.buyerTotal).toBe(20 + result.serviceFee);
  });
});

describe('calculateServiceFee', () => {
  it('returns the service fee only', () => {
    expect(calculateServiceFee(50)).toBe(4.00);
  });

  it('applies minimum fee', () => {
    expect(calculateServiceFee(5)).toBe(2.00);
  });

  it('matches calculateFees serviceFee', () => {
    expect(calculateServiceFee(75)).toBe(calculateFees(75, 0).serviceFee);
  });
});

describe('getServiceFeeConfig', () => {
  it('returns default config values', () => {
    const config = getServiceFeeConfig();
    expect(config.percent).toBe(5);
    expect(config.fixed).toBe(1.50);
    expect(config.min).toBe(2.00);
  });
});

// ===========================================================================
// F133 — Taxes TPS/TVQ scaffold (OFF by default, no regression)
// ===========================================================================

describe('taxes (F133) — TAX_ENABLED=false invariance', () => {
  it('keeps tax at 0 and buyerTotal unchanged when the flag is OFF (default)', () => {
    const result = calculateFees(50, 10);
    // Same numbers as the no-tax suite above — proves zero regression.
    expect(result.serviceFee).toBe(4.0);
    expect(result.taxGst).toBe(0);
    expect(result.taxQst).toBe(0);
    expect(result.taxTotal).toBe(0);
    expect(result.taxOnServiceFee).toBe(0);
    expect(result.buyerTotal).toBe(64.0); // 50 + 10 + 4, no tax line
  });

  it('exposes additive tax fields (all 0 when OFF) on the breakdown', () => {
    const result = calculateFees(100, 0);
    expect(result).toMatchObject({ taxGst: 0, taxQst: 0, taxTotal: 0, taxOnServiceFee: 0 });
    expect(result.buyerTotal).toBe(106.5);
  });
});

describe('taxes (F133) — TAX_ENABLED=true computes TPS/TVQ on the service fee', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('adds 5% TPS + 9.975% TVQ on the service fee to buyerTotal', async () => {
    vi.stubEnv('TAX_ENABLED', 'true');
    vi.resetModules();
    const fresh = await import('./fees');

    // 50$ article → serviceFee 4.00. tax on the fee only (NOT the article/shipping):
    //   gst = 4.00 * 0.05      = 0.20
    //   qst = 4.00 * 0.09975   = 0.40 (0.3990 rounded)
    const result = fresh.calculateFees(50, 10);
    expect(result.serviceFee).toBe(4.0);
    expect(result.taxGst).toBe(0.2);
    expect(result.taxQst).toBe(0.4);
    expect(result.taxTotal).toBe(0.6);
    expect(result.taxOnServiceFee).toBe(0.6);
    // buyerTotal now includes the tax: 50 + 10 + 4 + 0.6 = 64.60.
    expect(result.buyerTotal).toBe(64.6);
    // Seller payout is unaffected by the tax (still 100% of the article price).
    expect(result.sellerPayout).toBe(50);
  });

  it('only taxes the service fee, never the article price or shipping', async () => {
    vi.stubEnv('TAX_ENABLED', 'true');
    vi.resetModules();
    const fresh = await import('./fees');

    const result = fresh.calculateFees(100, 25);
    // serviceFee for 100$ = 6.50. tax = 6.50*0.05 + 6.50*0.09975 = 0.325→0.33 + 0.6484→0.65
    expect(result.serviceFee).toBe(6.5);
    expect(result.taxGst).toBe(0.33);
    expect(result.taxQst).toBe(0.65);
    expect(result.taxTotal).toBe(0.98);
    // buyerTotal = 100 + 25 + 6.50 + 0.98 = 132.48 (tax computed off the 6.50 fee only).
    expect(result.buyerTotal).toBe(132.48);
  });

  it('calculateTaxOnServiceFee returns the same gst/qst split', async () => {
    vi.stubEnv('TAX_ENABLED', 'true');
    vi.resetModules();
    const fresh = await import('./fees');

    const tax = fresh.calculateTaxOnServiceFee(4.0);
    expect(tax.gst).toBe(0.2);
    expect(tax.qst).toBe(0.4);
    expect(tax.taxTotal).toBe(0.6);
    expect(fresh.getTaxConfig().enabled).toBe(true);
  });
});
