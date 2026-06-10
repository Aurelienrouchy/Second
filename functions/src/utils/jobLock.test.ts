/**
 * Unit tests for the anti-overlap job lock (F82). acquireJobLock makes a
 * scheduled job that performs PAID external operations run at most once at a
 * time; releaseJobLock frees it; an expired lock (crashed run) is reclaimable.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from './testHelpers/firestoreMock';
import type { MockFirestore } from './testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs: MockFirestore = createFirestoreMock();
holder.fs = fs;

vi.mock('../config/firebase', () => ({
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
}));

const { FakeTimestamp } = vi.hoisted(() => {
  class FakeTimestamp {
    constructor(public ms: number) {}
    static fromMillis(ms: number) {
      return new FakeTimestamp(ms);
    }
    toMillis() {
      return this.ms;
    }
  }
  return { FakeTimestamp };
});
vi.mock('firebase-admin/firestore', () => ({ Timestamp: FakeTimestamp }));

vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}));

import { acquireJobLock, releaseJobLock } from './jobLock';

beforeEach(() => {
  fs.reset();
});

describe('jobLock (F82 anti-overlap)', () => {
  it('acquires a free lock', async () => {
    expect(await acquireJobLock('jobA', 60_000)).toBe(true);
  });

  it('refuses a second acquisition while the lock is held (fresh)', async () => {
    expect(await acquireJobLock('jobB', 60_000)).toBe(true);
    // A concurrent run must NOT acquire — the lock is fresh.
    expect(await acquireJobLock('jobB', 60_000)).toBe(false);
  });

  it('reclaims an expired lock (crashed run that never released)', async () => {
    // Simulate a stale lock that expired in the past.
    fs.setDoc('job_locks/jobC', {
      lockedUntil: FakeTimestamp.fromMillis(Date.now() - 1000),
    });
    expect(await acquireJobLock('jobC', 60_000)).toBe(true);
  });

  it('release frees the lock so the next run can acquire', async () => {
    expect(await acquireJobLock('jobD', 60_000)).toBe(true);
    await releaseJobLock('jobD');
    expect(await acquireJobLock('jobD', 60_000)).toBe(true);
  });
});
