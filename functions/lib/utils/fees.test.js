"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fees_1 = require("./fees");
(0, vitest_1.describe)('calculateFees', () => {
    (0, vitest_1.it)('applies minimum fee for low-price articles (5$)', () => {
        const result = (0, fees_1.calculateFees)(5, 0);
        (0, vitest_1.expect)(result.serviceFee).toBe(2.00);
        (0, vitest_1.expect)(result.sellerPayout).toBe(5);
        (0, vitest_1.expect)(result.buyerTotal).toBe(7.00);
    });
    (0, vitest_1.it)('calculates 15$ article correctly', () => {
        const result = (0, fees_1.calculateFees)(15, 0);
        // 15 * 0.05 + 1.50 = 2.25
        (0, vitest_1.expect)(result.serviceFee).toBe(2.25);
        (0, vitest_1.expect)(result.buyerTotal).toBe(17.25);
    });
    (0, vitest_1.it)('calculates 30$ article correctly', () => {
        const result = (0, fees_1.calculateFees)(30, 0);
        // 30 * 0.05 + 1.50 = 3.00
        (0, vitest_1.expect)(result.serviceFee).toBe(3.00);
        (0, vitest_1.expect)(result.buyerTotal).toBe(33.00);
    });
    (0, vitest_1.it)('calculates 50$ article correctly', () => {
        const result = (0, fees_1.calculateFees)(50, 0);
        // 50 * 0.05 + 1.50 = 4.00
        (0, vitest_1.expect)(result.serviceFee).toBe(4.00);
        (0, vitest_1.expect)(result.buyerTotal).toBe(54.00);
    });
    (0, vitest_1.it)('calculates 100$ article correctly', () => {
        const result = (0, fees_1.calculateFees)(100, 0);
        // 100 * 0.05 + 1.50 = 6.50
        (0, vitest_1.expect)(result.serviceFee).toBe(6.50);
        (0, vitest_1.expect)(result.buyerTotal).toBe(106.50);
    });
    (0, vitest_1.it)('includes shipping in buyerTotal but not in fee calculation', () => {
        const result = (0, fees_1.calculateFees)(50, 10);
        (0, vitest_1.expect)(result.serviceFee).toBe(4.00);
        (0, vitest_1.expect)(result.shippingCost).toBe(10);
        (0, vitest_1.expect)(result.buyerTotal).toBe(64.00);
    });
    (0, vitest_1.it)('seller always receives 100% of article price', () => {
        const result = (0, fees_1.calculateFees)(75, 15);
        (0, vitest_1.expect)(result.sellerPayout).toBe(75);
    });
    (0, vitest_1.it)('returns correct fee config values', () => {
        const result = (0, fees_1.calculateFees)(50, 0);
        (0, vitest_1.expect)(result.serviceFeePercent).toBe(5);
        (0, vitest_1.expect)(result.serviceFeeFixed).toBe(1.50);
    });
    (0, vitest_1.it)('handles zero price article', () => {
        const result = (0, fees_1.calculateFees)(0, 0);
        // 0 * 0.05 + 1.50 = 1.50 → min 2.00
        (0, vitest_1.expect)(result.serviceFee).toBe(2.00);
        (0, vitest_1.expect)(result.buyerTotal).toBe(2.00);
    });
    (0, vitest_1.it)('handles zero shipping', () => {
        const result = (0, fees_1.calculateFees)(20, 0);
        (0, vitest_1.expect)(result.shippingCost).toBe(0);
        (0, vitest_1.expect)(result.buyerTotal).toBe(20 + result.serviceFee);
    });
});
(0, vitest_1.describe)('calculateServiceFee', () => {
    (0, vitest_1.it)('returns the service fee only', () => {
        (0, vitest_1.expect)((0, fees_1.calculateServiceFee)(50)).toBe(4.00);
    });
    (0, vitest_1.it)('applies minimum fee', () => {
        (0, vitest_1.expect)((0, fees_1.calculateServiceFee)(5)).toBe(2.00);
    });
    (0, vitest_1.it)('matches calculateFees serviceFee', () => {
        (0, vitest_1.expect)((0, fees_1.calculateServiceFee)(75)).toBe((0, fees_1.calculateFees)(75, 0).serviceFee);
    });
});
(0, vitest_1.describe)('getServiceFeeConfig', () => {
    (0, vitest_1.it)('returns default config values', () => {
        const config = (0, fees_1.getServiceFeeConfig)();
        (0, vitest_1.expect)(config.percent).toBe(5);
        (0, vitest_1.expect)(config.fixed).toBe(1.50);
        (0, vitest_1.expect)(config.min).toBe(2.00);
    });
});
//# sourceMappingURL=fees.test.js.map