import AsyncStorage from '@/utils/environmentStorage';
import { randomUUID } from 'expo-crypto';
import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { functions } from '@/config/firebaseConfig';
import { ArticlesService } from '@/services/articlesService';
import { assertTradeSessionCurrent, captureTradeSession, isDefinitiveTradeRefusal, staleTradeOperation, type TradeSession } from '@/services/tradeOperation';

export interface ArticleSoldPayload {
  operation: 'set'; articleId: string; requestId: string;
  desiredIsSold: boolean; expectedIsSold: boolean; expectedRevision: string;
}
export interface ArticleSoldIntent { readonly payload: Readonly<ArticleSoldPayload>; readonly session: Readonly<TradeSession> }
interface SoldProof { kind: 'applied' | 'replayed' | 'superseded' | 'stale' | 'observed' | 'unverifiable'; appliedIsSold?: boolean; currentIsSold?: boolean; currentRevision?: string }
interface SoldAttempt { version: 1 | 2; uid: string; articleId: string; localId: string; intent?: ArticleSoldPayload; proof?: SoldProof; receiptId?: string; verifiedSold?: boolean }
interface SetReceipt { success: true; operation: 'set'; outcome: 'applied' | 'replayed'; articleId: string; requestId: string; isSold: boolean; revision: string | null }
const pending = new Set<string>();
const latest = new Map<string, SoldAttempt>();
const adopted = new Map<string, { localId: string; receiptId: string; generation: number }>();
const revisionValid = (revision: unknown): revision is string => typeof revision === 'string' && /^[a-f0-9]{64}$/.test(revision);
const journalKey = (uid: string, articleId: string) => `article-sold:v1:${encodeURIComponent(uid)}:${encodeURIComponent(articleId)}`;
const invalidJournal = () => new Error('La tentative enregistrée doit être examinée avant une nouvelle modification.');
function parseAttempt(raw: string | null, uid: string, articleId: string): SoldAttempt | null {
  if (raw === null) return null;
  const value = JSON.parse(raw) as SoldAttempt | null;
  if (!value || Array.isArray(value) || ![1, 2].includes(value.version) || value.uid !== uid || value.articleId !== articleId ||
    typeof value.localId !== 'string' || !value.localId || (value.verifiedSold !== undefined && value.receiptId === undefined) ||
    (value.receiptId !== undefined && (typeof value.receiptId !== 'string' || !value.receiptId || typeof value.verifiedSold !== 'boolean'))) throw invalidJournal();
  if (value.version === 2) {
    const p = value.intent;
    if (p && (Object.keys(p).length !== 6 || p.operation !== 'set' || p.articleId !== articleId || p.requestId !== value.localId ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(p.requestId) || typeof p.expectedIsSold !== 'boolean' || typeof p.desiredIsSold !== 'boolean' ||
      p.desiredIsSold === p.expectedIsSold || !revisionValid(p.expectedRevision))) throw invalidJournal();
    if ((!p && value.proof?.kind !== 'observed') || (value.proof && !['applied', 'replayed', 'superseded', 'stale', 'observed', 'unverifiable'].includes(value.proof.kind))) throw invalidJournal();
    const proof = value.proof;
    if (proof && ((['applied', 'replayed', 'superseded'].includes(proof.kind) && (!p || proof.appliedIsSold !== p.desiredIsSold)) || (['stale', 'superseded', 'observed'].includes(proof.kind) && (typeof proof.currentIsSold !== 'boolean' || !revisionValid(proof.currentRevision))))) throw invalidJournal();
  }
  return value;
}
function isAdopted(key: string, attempt: SoldAttempt | null, session: TradeSession): boolean {
  const ack = adopted.get(key);
  return !!attempt?.receiptId && ack?.localId === attempt.localId && ack.receiptId === attempt.receiptId && ack.generation === session.generation;
}
async function readArticle(articleId: string, uid: string, assertCurrent: () => void) {
  const article = await ArticlesService.getArticleById(articleId); assertCurrent();
  if (!article || article.id !== articleId || article.sellerId !== uid || typeof article.isSold !== 'boolean') throw new Error('Impossible de vérifier l’état de cet article. Actualisez le dossier avant une nouvelle modification.');
  return article;
}
async function finishReceipt(key: string, attempt: SoldAttempt, session: TradeSession, reconciled: boolean, assertCurrent: () => void) {
  const article = await readArticle(attempt.articleId, session.uid, assertCurrent);
  const receipt = { ...attempt, receiptId: randomUUID(), verifiedSold: article.isSold };
  assertCurrent(); await AsyncStorage.setItem(key, JSON.stringify(receipt)); latest.set(key, receipt); assertCurrent();
  const acknowledge = () => {
    assertCurrent();
    const current = latest.get(key);
    if (pending.has(key) || current?.localId !== receipt.localId || current.receiptId !== receipt.receiptId) throw new Error('Cette réception ne correspond plus à la tentative courante.');
    adopted.set(key, { localId: receipt.localId, receiptId: receipt.receiptId, generation: session.generation });
  };
  return { article, reconciled: reconciled || attempt.intent?.desiredIsSold !== article.isSold, acknowledge };
}
export type ArticleSoldResult = Awaited<ReturnType<typeof finishReceipt>>;

/** Called before presenting confirmation. A previous unadopted attempt is recovery, never a new gesture. */
export async function prepareArticleSoldChange(articleId: string, expectedUid: string, expectedIsSold: boolean, assertContext: () => void = () => undefined): Promise<{ intent: ArticleSoldIntent; result: null } | { intent: null; result: ArticleSoldResult }> {
  const session = captureTradeSession(expectedUid);
  const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
  assertCurrent(); const key = journalKey(session.uid, articleId);
  if (pending.has(key)) throw Object.assign(new Error('La mise à jour de cet article est déjà en cours.'), { code: 'client/operation-pending' });
  pending.add(key);
  let recover = false;
  try {
    const attempt = parseAttempt(await AsyncStorage.getItem(key), session.uid, articleId); assertCurrent();
    recover = !!attempt && !isAdopted(key, attempt, session);
    if (!recover) {
      const response = await httpsCallable<{ operation: 'observe'; articleId: string }, { operation: 'observe'; articleId: string; isSold: boolean; revision: string }>(functions, 'toggleArticleSold')({ operation: 'observe', articleId });
      assertCurrent(); const observed = response.data;
      if (observed?.operation !== 'observe' || observed.articleId !== articleId || typeof observed.isSold !== 'boolean' || !revisionValid(observed.revision)) throw new Error('Impossible de vérifier l’état de cet article. Actualisez le dossier avant une nouvelle modification.');
      if (observed.isSold !== expectedIsSold) {
        const marker: SoldAttempt = { version: 2, uid: session.uid, articleId, localId: randomUUID(), proof: { kind: 'observed', currentIsSold: observed.isSold, currentRevision: observed.revision } };
        await preservePrevious(key, attempt, assertCurrent); assertCurrent();
        await AsyncStorage.setItem(key, JSON.stringify(marker)); latest.set(key, marker); assertCurrent();
        return { intent: null, result: await finishReceipt(key, marker, session, true, assertCurrent) };
      }
      return { intent: Object.freeze({ session: Object.freeze(session), payload: Object.freeze({ operation: 'set' as const, articleId, requestId: randomUUID(), desiredIsSold: !expectedIsSold, expectedIsSold, expectedRevision: observed.revision }) }), result: null };
    }
  } finally { pending.delete(key); }
  return { intent: null, result: await toggleArticleSoldSafely(articleId, expectedUid, assertContext) };
}
async function preservePrevious(key: string, previous: SoldAttempt | null, assertCurrent: () => void) {
  if (!previous) return;
  const raw = await AsyncStorage.getItem(`${key}:receipts`); assertCurrent();
  const history: unknown = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(history)) throw invalidJournal();
  assertCurrent(); await AsyncStorage.setItem(`${key}:receipts`, JSON.stringify([...history, previous])); assertCurrent();
}

/** Persists the six confirmed fields before set. Without an intent only an existing journal can recover. */
export async function toggleArticleSoldSafely(articleId: string, expectedUid: string, assertContext: () => void = () => undefined, intent?: ArticleSoldIntent): Promise<ArticleSoldResult> {
  const session = captureTradeSession(expectedUid);
  const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
  assertCurrent(); const key = journalKey(session.uid, articleId);
  if (intent && (intent.session.uid !== session.uid || intent.session.generation !== session.generation || intent.payload.articleId !== articleId)) throw staleTradeOperation();
  if (pending.has(key)) throw Object.assign(new Error('La mise à jour de cet article est déjà en cours.'), { code: 'client/operation-pending' });
  pending.add(key);
  try {
    let attempt = parseAttempt(await AsyncStorage.getItem(key), session.uid, articleId); assertCurrent();
    const recovery = !!attempt && !isAdopted(key, attempt, session);
    if (!recovery) {
      if (!intent) throw new Error('Vérifiez l’article et confirmez une nouvelle intention avant de le modifier.');
      await preservePrevious(key, attempt, assertCurrent);
      attempt = { version: 2, uid: session.uid, articleId, localId: intent.payload.requestId, intent: { ...intent.payload } };
      parseAttempt(JSON.stringify(attempt), session.uid, articleId); latest.set(key, attempt); assertCurrent();
      await AsyncStorage.setItem(key, JSON.stringify(attempt)); assertCurrent();
    }
    if (attempt!.version === 2 && attempt!.intent && !attempt!.proof) {
      try {
        assertCurrent(); const p = attempt!.intent!;
        const result = await httpsCallable<ArticleSoldPayload, SetReceipt>(functions, 'toggleArticleSold')(p);
        const receipt = result.data;
        if (receipt?.success !== true || receipt.operation !== 'set' || !['applied', 'replayed'].includes(receipt.outcome) || receipt.articleId !== articleId || receipt.requestId !== p.requestId || receipt.isSold !== p.desiredIsSold || (receipt.outcome === 'applied' ? receipt.revision !== null : !revisionValid(receipt.revision))) throw new Error('La réception de cette modification doit être vérifiée.');
        attempt = { ...attempt!, proof: { kind: receipt.outcome, appliedIsSold: receipt.isSold } };
      } catch (error) {
        const refusal = error as { code?: unknown; details?: { reason?: string; action?: string; articleId?: string; requestId?: string; appliedIsSold?: boolean; currentIsSold?: boolean; currentRevision?: string } } | null;
        const details = refusal?.details;
        if (details?.reason?.startsWith('article_sold_') && (!(refusal?.code === 'functions/failed-precondition' || refusal?.code === 'failed-precondition') || details.action !== 'refreshArticle' || details.articleId !== articleId || (details.reason !== 'article_sold_state_unverifiable' && details.requestId !== attempt!.intent!.requestId))) throw error;
        if ((details?.reason === 'article_sold_intent_superseded' || details?.reason === 'article_sold_observation_stale') && (typeof details.currentIsSold !== 'boolean' || !revisionValid(details.currentRevision) || (details.reason === 'article_sold_intent_superseded' && details.appliedIsSold !== attempt!.intent!.desiredIsSold))) throw error;
        if (details?.reason === 'article_sold_intent_superseded' || details?.reason === 'article_sold_observation_stale') {
          attempt = { ...attempt!, proof: { kind: details.reason === 'article_sold_intent_superseded' ? 'superseded' : 'stale', ...(typeof details.appliedIsSold === 'boolean' ? { appliedIsSold: details.appliedIsSold } : {}), ...(typeof details.currentIsSold === 'boolean' ? { currentIsSold: details.currentIsSold } : {}), ...(revisionValid(details.currentRevision) ? { currentRevision: details.currentRevision } : {}) } };
        } else if (details?.reason === 'article_sold_state_unverifiable' || details?.reason === 'article_sold_receipt_unverifiable') {
          attempt = { ...attempt!, proof: { kind: 'unverifiable' } };
        } else {
          if (!recovery && isDefinitiveTradeRefusal(error)) { assertCurrent(); await AsyncStorage.removeItem(key); latest.delete(key); assertCurrent(); }
          throw error;
        }
      }
      // A stale consumer retains its exact pending intent for later replay; no late adoption.
      assertCurrent(); await AsyncStorage.setItem(key, JSON.stringify(attempt)); latest.set(key, attempt!); assertCurrent();
    }
    const reconciled = recovery || attempt!.proof?.kind !== 'applied';
    return await finishReceipt(key, attempt!, session, reconciled, assertCurrent);
  } finally { pending.delete(key); }
}
