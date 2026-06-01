import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { getTestEnv, teardownTestEnv } from './helpers';

const REPORTER = 'reporter';
const OUTSIDER = 'outsider';
const REPORT_ID = 'report-1';

const baseReport = {
  reporterId: REPORTER,
  targetId: 'article-99',
  targetType: 'article',
  reason: 'counterfeit',
  status: 'pending',
};

describe('reports rules — create-only by author, admin-only review (B3)', () => {
  beforeAll(async () => {
    await getTestEnv();
  });

  afterAll(async () => {
    await teardownTestEnv();
  });

  beforeEach(async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reports', REPORT_ID), baseReport);
    });
  });

  it('allows an authenticated user to create a report about a target', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(REPORTER).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'reports', 'new-report'), {
        reporterId: REPORTER,
        targetId: 'article-1',
        targetType: 'article',
        reason: 'spam',
        status: 'pending',
      }),
    );
  });

  it('denies creating a report on behalf of someone else (reporterId mismatch)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(REPORTER).firestore();
    await assertFails(
      setDoc(doc(db, 'reports', 'forged-report'), {
        reporterId: OUTSIDER,
        targetId: 'article-1',
        targetType: 'article',
        reason: 'spam',
      }),
    );
  });

  it('denies creating a report that is already resolved (self-resolution)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(REPORTER).firestore();
    await assertFails(
      setDoc(doc(db, 'reports', 'preresolved'), {
        reporterId: REPORTER,
        targetId: 'article-1',
        targetType: 'article',
        reason: 'spam',
        status: 'resolved',
      }),
    );
  });

  it('denies creating a report with forged review metadata', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(REPORTER).firestore();
    await assertFails(
      setDoc(doc(db, 'reports', 'forged-review'), {
        reporterId: REPORTER,
        targetId: 'article-1',
        targetType: 'article',
        reason: 'spam',
        status: 'pending',
        reviewedBy: REPORTER,
        resolution: 'dismissed by me',
      }),
    );
  });

  it('denies the reporter reading their own report (review is admin-only)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(REPORTER).firestore();
    await assertFails(getDoc(doc(db, 'reports', REPORT_ID)));
  });

  it('denies a non-admin reading a report', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(OUTSIDER).firestore();
    await assertFails(getDoc(doc(db, 'reports', REPORT_ID)));
  });

  it('allows an admin to read a report', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext('admin-claim', { admin: true }).firestore();
    await assertSucceeds(getDoc(doc(db, 'reports', REPORT_ID)));
  });

  it('allows a moderator to read a report', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext('mod', { moderator: true }).firestore();
    await assertSucceeds(getDoc(doc(db, 'reports', REPORT_ID)));
  });

  it('denies the reporter updating (resolving) their own report', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(REPORTER).firestore();
    await assertFails(
      updateDoc(doc(db, 'reports', REPORT_ID), { status: 'resolved' }),
    );
  });

  it('allows an admin to resolve a report', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext('admin-claim', { admin: true }).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'reports', REPORT_ID), {
        status: 'resolved',
        reviewedBy: 'admin-claim',
      }),
    );
  });
});
