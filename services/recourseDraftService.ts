import AsyncStorage from '@/utils/environmentStorage';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { WholeSetReportDraft } from '@/types/transactionProblem';

export interface RecourseDraftScope { uid: string; transactionId: string; purpose: string }
export interface RecourseDraft { reason: string | null; details: string; wholeSet?: WholeSetReportDraft }
const writes = new Map<string, Promise<void>>();
const reference = (value: string) => /^[A-Za-z0-9_-]{1,200}$/.test(value);
function draftKey(scope: RecourseDraftScope) {
  if (![scope.uid, scope.transactionId, scope.purpose].every(reference)) throw new Error('Brouillon inaccessible.');
  return `second:recourse-draft:v1:${JSON.stringify([scope.uid, scope.transactionId, scope.purpose])}`;
}
export async function readRecourseDraft(scope: RecourseDraftScope): Promise<RecourseDraft> {
  const session = captureTradeSession(scope.uid);
  const raw = await AsyncStorage.getItem(draftKey(scope));
  assertTradeSessionCurrent(session);
  if (raw === null) return { reason: null, details: '' };
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Le brouillon doit être récupéré.');
  const value = parsed as Record<string, unknown>;
  if (!(value.reason === null || typeof value.reason === 'string' && reference(value.reason)) ||
    typeof value.details !== 'string' || value.details.length > 4000) throw new Error('Le brouillon doit être récupéré.');
  if (value.wholeSet !== undefined) {
    const d = value.wholeSet;
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('La déclaration de l’ensemble doit être récupérée.');
    const s = d as Record<string, unknown>;
    const part = (v: unknown, missing: boolean) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
      const p = v as Record<string, unknown>;
      return Object.keys(p).length === 2 && Object.keys(p).every(k => ['status', 'description'].includes(k)) &&
        (p.status === null || ['described', 'unknown', ...(missing ? ['none_observed'] : [])].includes(String(p.status))) && typeof p.description === 'string' && p.description.length <= 1000;
    };
    if (Object.keys(s).length !== 4 || Object.keys(s).some(k => !['snapshotHash', 'claim', 'received', 'missing'].includes(k)) ||
      typeof s.snapshotHash !== 'string' || !/^[a-f0-9]{64}$/.test(s.snapshotHash) ||
      s.claim !== null && !['incomplete_set', 'other_nonconformity'].includes(String(s.claim)) || !part(s.received, false) || !part(s.missing, true)) throw new Error('La déclaration de l’ensemble doit être récupérée.');
  }
  return { reason: value.reason as string | null, details: value.details, ...(value.wholeSet !== undefined ? {wholeSet: value.wholeSet as WholeSetReportDraft} : {}) };
}
export async function writeRecourseDraft(scope: RecourseDraftScope, draft: RecourseDraft | null): Promise<void> {
  const session = captureTradeSession(scope.uid);
  const key = draftKey(scope);
  const pending = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    assertTradeSessionCurrent(session);
    if (draft) await AsyncStorage.setItem(key, JSON.stringify(draft));
    else await AsyncStorage.removeItem(key);
    assertTradeSessionCurrent(session);
  });
  writes.set(key, pending);
  try { await pending; } finally { if (writes.get(key) === pending) writes.delete(key); }
}
