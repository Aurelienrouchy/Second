import { describe, it, expect } from 'vitest';
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
