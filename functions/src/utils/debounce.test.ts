import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounceUpdate, cancelDebouncedUpdate } from './debounce';

describe('debounceUpdate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the function after the delay', () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    debounceUpdate('test-delay', fn, 1000);

    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('cancels previous call when called again with same key', () => {
    const fn1 = vi.fn().mockResolvedValue(undefined);
    const fn2 = vi.fn().mockResolvedValue(undefined);

    debounceUpdate('test-cancel', fn1, 1000);
    vi.advanceTimersByTime(500);
    debounceUpdate('test-cancel', fn2, 1000);
    vi.advanceTimersByTime(1000);

    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalledOnce();
  });

  it('handles independent keys separately', () => {
    const fnA = vi.fn().mockResolvedValue(undefined);
    const fnB = vi.fn().mockResolvedValue(undefined);

    debounceUpdate('test-indep-A', fnA, 500);
    debounceUpdate('test-indep-B', fnB, 1500);

    vi.advanceTimersByTime(500);
    expect(fnA).toHaveBeenCalledOnce();
    expect(fnB).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(fnB).toHaveBeenCalledOnce();
  });

  it('uses default delay of 5000ms', () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    debounceUpdate('test-default', fn);

    vi.advanceTimersByTime(4999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe('cancelDebouncedUpdate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prevents the debounced function from executing', () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    debounceUpdate('test-cancel-exec', fn, 1000);
    cancelDebouncedUpdate('test-cancel-exec');

    vi.advanceTimersByTime(2000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not throw for unknown keys', () => {
    expect(() => cancelDebouncedUpdate('nonexistent')).not.toThrow();
  });
});
