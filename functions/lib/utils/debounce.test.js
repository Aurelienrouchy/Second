"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const debounce_1 = require("./debounce");
(0, vitest_1.describe)('debounceUpdate', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.useFakeTimers();
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.useRealTimers();
    });
    (0, vitest_1.it)('calls the function after the delay', () => {
        const fn = vitest_1.vi.fn().mockResolvedValue(undefined);
        (0, debounce_1.debounceUpdate)('test-delay', fn, 1000);
        (0, vitest_1.expect)(fn).not.toHaveBeenCalled();
        vitest_1.vi.advanceTimersByTime(1000);
        (0, vitest_1.expect)(fn).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('cancels previous call when called again with same key', () => {
        const fn1 = vitest_1.vi.fn().mockResolvedValue(undefined);
        const fn2 = vitest_1.vi.fn().mockResolvedValue(undefined);
        (0, debounce_1.debounceUpdate)('test-cancel', fn1, 1000);
        vitest_1.vi.advanceTimersByTime(500);
        (0, debounce_1.debounceUpdate)('test-cancel', fn2, 1000);
        vitest_1.vi.advanceTimersByTime(1000);
        (0, vitest_1.expect)(fn1).not.toHaveBeenCalled();
        (0, vitest_1.expect)(fn2).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('handles independent keys separately', () => {
        const fnA = vitest_1.vi.fn().mockResolvedValue(undefined);
        const fnB = vitest_1.vi.fn().mockResolvedValue(undefined);
        (0, debounce_1.debounceUpdate)('test-indep-A', fnA, 500);
        (0, debounce_1.debounceUpdate)('test-indep-B', fnB, 1500);
        vitest_1.vi.advanceTimersByTime(500);
        (0, vitest_1.expect)(fnA).toHaveBeenCalledOnce();
        (0, vitest_1.expect)(fnB).not.toHaveBeenCalled();
        vitest_1.vi.advanceTimersByTime(1000);
        (0, vitest_1.expect)(fnB).toHaveBeenCalledOnce();
    });
    (0, vitest_1.it)('uses default delay of 5000ms', () => {
        const fn = vitest_1.vi.fn().mockResolvedValue(undefined);
        (0, debounce_1.debounceUpdate)('test-default', fn);
        vitest_1.vi.advanceTimersByTime(4999);
        (0, vitest_1.expect)(fn).not.toHaveBeenCalled();
        vitest_1.vi.advanceTimersByTime(1);
        (0, vitest_1.expect)(fn).toHaveBeenCalledOnce();
    });
});
(0, vitest_1.describe)('cancelDebouncedUpdate', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.useFakeTimers();
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.useRealTimers();
    });
    (0, vitest_1.it)('prevents the debounced function from executing', () => {
        const fn = vitest_1.vi.fn().mockResolvedValue(undefined);
        (0, debounce_1.debounceUpdate)('test-cancel-exec', fn, 1000);
        (0, debounce_1.cancelDebouncedUpdate)('test-cancel-exec');
        vitest_1.vi.advanceTimersByTime(2000);
        (0, vitest_1.expect)(fn).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('does not throw for unknown keys', () => {
        (0, vitest_1.expect)(() => (0, debounce_1.cancelDebouncedUpdate)('nonexistent')).not.toThrow();
    });
});
//# sourceMappingURL=debounce.test.js.map