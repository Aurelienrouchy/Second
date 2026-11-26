import AsyncStorage from '@/utils/environmentStorage';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import { SHIPPING_RECEIPT_DECLARATION_PROTOCOL as PROTOCOL, SHIPPING_RECEIPT_DECLARATION_STATEMENT as STATEMENT } from '@/types/shippingReceiptDeclaration';
import type { ShippingReceiptDeclaration, ShippingReceiptDeclarationCommand, ShippingReceiptDeclarationIntent, ShippingReceiptDeclarationObservation, ShippingReceiptDeclarationView } from '@/types/shippingReceiptDeclaration';

type Mode = 'execute' | 'observe' | 'neutralize';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const revision = (value: unknown): value is string => typeof value === 'string' && /^\d{1,12}:\d{1,9}$/.test(value);
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const digest = (value: unknown) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(value));
const inputHash = (intent: Omit<ShippingReceiptDeclarationIntent, 'version' | 'inputHash'>) => digest([PROTOCOL, intent.expectedUid, intent.transactionId,
  intent.requestId, intent.statementVersion, intent.statement, intent.accepted, intent.expectedSourceRevision, intent.expectedSourceHash]);
const key = (uid: string, transactionId: string) => `second:buyer-shipping-receipt:v1:${JSON.stringify([uid, transactionId])}`;
const locks = new Set<string>();
const unknown = () => new Error('Cette déclaration doit être relue avec sa référence et sa confirmation d’origine. Son journal est conservé ; aucun état de livraison ni règlement financier n’est déduit de cette lecture.');
function fence(uid: string, assertFocus: () => void) {
  const session = captureTradeSession(uid);
  return () => {assertTradeSessionCurrent(session); assertFocus();};
}
async function local(uid: string, transactionId: string, assertCurrent: () => void): Promise<ShippingReceiptDeclarationIntent | null> {
  assertCurrent(); if (!id(transactionId)) throw unknown();
  const raw = await AsyncStorage.getItem(key(uid, transactionId)); assertCurrent(); if (raw === null) return null;
  let value: unknown; try {value = JSON.parse(raw);} catch {throw unknown();}
  if (!object(value) || Object.keys(value).length !== 10 ||
    !['version', 'expectedUid', 'transactionId', 'requestId', 'statementVersion', 'statement', 'accepted', 'expectedSourceRevision', 'expectedSourceHash', 'inputHash'].every(field => Object.prototype.hasOwnProperty.call(value, field)) ||
    value.version !== 1 || value.expectedUid !== uid || value.transactionId !== transactionId || !id(value.requestId) ||
    value.statementVersion !== PROTOCOL || value.statement !== STATEMENT || value.accepted !== true || !revision(value.expectedSourceRevision) || !hash(value.expectedSourceHash) || !hash(value.inputHash)) throw unknown();
  const intent = value as unknown as ShippingReceiptDeclarationIntent;
  const expected = await inputHash(intent); assertCurrent(); if (expected !== intent.inputHash) throw unknown(); return intent;
}
async function parse(value: unknown, uid: string, transactionId: string, intent: ShippingReceiptDeclarationIntent | null, assertCurrent: () => void): Promise<ShippingReceiptDeclarationView> {
  if (!object(value) || value.protocol !== PROTOCOL || value.ownerId !== uid || value.transactionId !== transactionId ||
    !['buyer', 'seller'].includes(String(value.role)) || value.statementVersion !== PROTOCOL || value.statement !== STATEMENT ||
    !['native_paid_contract', 'needs_review'].includes(String(value.qualification)) || typeof value.sourceObservedCurrently !== 'boolean' ||
    !(value.sourceRevision === null || revision(value.sourceRevision)) || !(value.sourceHash === null || hash(value.sourceHash)) ||
    (value.sourceRevision === null) !== (value.sourceHash === null) || value.financialEffectsApplied !== false || value.deadlinesChanged !== false || value.recoursesClosed !== false) throw unknown();
  if (value.sourceObservedCurrently ? value.qualification === 'native_paid_contract' && value.sourceRevision === null
    : value.sourceRevision !== null || value.sourceHash !== null || value.command === null) throw unknown();
  let declaration: ShippingReceiptDeclaration | null = null;
  if (value.declaration !== null) {
    const d = value.declaration;
    if (!object(d) || !id(d.requestId) || !id(d.actorUid) || !hash(d.commandId) || !iso(d.recordedAt) || !revision(d.sourceRevision) || !hash(d.sourceHash) ||
      d.humanDeclaration !== true || d.physicalReceiptVerified !== false || d.contentValidated !== false || d.recoursesClosed !== false ||
      (value.role === 'buyer' ? d.actorUid !== uid : d.actorUid === uid)) throw unknown();
    const expected = await digest([d.actorUid, d.requestId]); assertCurrent(); if (expected !== d.commandId) throw unknown();
    declaration = {requestId: d.requestId, actorUid: d.actorUid, commandId: d.commandId, recordedAt: d.recordedAt,
      sourceRevision: d.sourceRevision, sourceHash: d.sourceHash, humanDeclaration: true, physicalReceiptVerified: false, contentValidated: false, recoursesClosed: false};
  }
  let command: ShippingReceiptDeclarationCommand | null = null;
  if (value.command !== null) {
    const c = value.command;
    if (!intent || value.role !== 'buyer' || !object(c) || c.requestId !== intent.requestId || c.inputHash !== intent.inputHash ||
      c.expectedSourceRevision !== intent.expectedSourceRevision || c.expectedSourceHash !== intent.expectedSourceHash || !iso(c.recordedAt) ||
      !['committed', 'neutralized', 'not_executed'].includes(String(c.state)) ||
      (c.state === 'not_executed' ? !['source_changed', 'source_unqualified', 'already_declared'].includes(String(c.reason)) : c.reason !== null)) throw unknown();
    const expected = await digest([uid, intent.requestId]); assertCurrent(); if (c.commandId !== expected) throw unknown();
    if (c.state === 'committed' && (!declaration || declaration.commandId !== c.commandId || declaration.requestId !== c.requestId || declaration.recordedAt !== c.recordedAt ||
      declaration.sourceRevision !== intent.expectedSourceRevision || declaration.sourceHash !== intent.expectedSourceHash || value.qualification !== 'native_paid_contract')) throw unknown();
    if (!value.sourceObservedCurrently && (c.state === 'committed' ? !declaration : declaration !== null || value.qualification !== 'needs_review')) throw unknown();
    command = {requestId: intent.requestId, commandId: expected, inputHash: intent.inputHash, state: c.state as ShippingReceiptDeclarationCommand['state'],
      reason: c.reason as ShippingReceiptDeclarationCommand['reason'], recordedAt: c.recordedAt, expectedSourceRevision: intent.expectedSourceRevision, expectedSourceHash: intent.expectedSourceHash};
  } else if (!value.sourceObservedCurrently) throw unknown();
  if (!intent && (command !== null || value.sourceObservedCurrently !== true)) throw unknown();
  return {protocol: PROTOCOL, ownerId: uid, transactionId, role: value.role as ShippingReceiptDeclarationView['role'], statementVersion: PROTOCOL, statement: STATEMENT,
    qualification: value.qualification as ShippingReceiptDeclarationView['qualification'], sourceRevision: value.sourceRevision as string | null,
    sourceHash: value.sourceHash as string | null, sourceObservedCurrently: value.sourceObservedCurrently, declaration, command,
    financialEffectsApplied: false, deadlinesChanged: false, recoursesClosed: false};
}
async function preview(uid: string, transactionId: string, assertCurrent: () => void) {
  assertCurrent(); if (!id(transactionId)) throw unknown();
  const {data} = await httpsCallable<unknown, unknown>(functions, 'declareShippingReceipt')({mode: 'preview', expectedUid: uid, transactionId});
  assertCurrent(); return parse(data, uid, transactionId, null, assertCurrent);
}
async function rpc(intent: ShippingReceiptDeclarationIntent, mode: Mode, assertCurrent: () => void) {
  assertCurrent();
  const {data} = await httpsCallable<unknown, unknown>(functions, 'declareShippingReceipt')({mode, expectedUid: intent.expectedUid, transactionId: intent.transactionId,
    requestId: intent.requestId, statementVersion: intent.statementVersion, statement: intent.statement, accepted: intent.accepted,
    expectedSourceRevision: intent.expectedSourceRevision, expectedSourceHash: intent.expectedSourceHash});
  assertCurrent(); return parse(data, intent.expectedUid, intent.transactionId, intent, assertCurrent);
}
async function withLock<T>(uid: string, transactionId: string, assertFocus: () => void, execute: (assertCurrent: () => void) => Promise<T>) {
  const assertCurrent = fence(uid, assertFocus), slot = key(uid, transactionId); assertCurrent();
  if (locks.has(slot)) throw unknown(); locks.add(slot); try {return await execute(assertCurrent);} finally {locks.delete(slot);}
}
async function read(uid: string, transactionId: string, assertCurrent: () => void): Promise<ShippingReceiptDeclarationObservation> {
  const intent = await local(uid, transactionId, assertCurrent);
  const receipt = intent ? await rpc(intent, 'observe', assertCurrent) : null;
  let current: ShippingReceiptDeclarationView | null = null, currentUnavailable = false;
  try {current = await preview(uid, transactionId, assertCurrent);} catch (error) {assertCurrent(); if (!intent) throw error; currentUnavailable = true;}
  assertCurrent(); return {intent, receipt, current, currentUnavailable};
}
export const ShippingReceiptDeclarationService = {
  read(uid: string, transactionId: string, assertFocus: () => void) {return read(uid, transactionId, fence(uid, assertFocus));},
  async declare(source: ShippingReceiptDeclarationView, accepted: boolean, assertFocus: () => void): Promise<ShippingReceiptDeclarationObservation> {
    const uid = source.ownerId, transactionId = source.transactionId;
    if (accepted !== true || source.role !== 'buyer' || !source.sourceObservedCurrently || source.qualification !== 'native_paid_contract' || source.declaration ||
      !revision(source.sourceRevision) || !hash(source.sourceHash)) throw new Error('Relisez la commande et confirmez explicitement la déclaration de réception.');
    const originalSource: Omit<ShippingReceiptDeclarationIntent, 'version' | 'inputHash' | 'requestId'> = {expectedUid: uid, transactionId, statementVersion: PROTOCOL, statement: STATEMENT, accepted: true,
      expectedSourceRevision: source.sourceRevision, expectedSourceHash: source.sourceHash};
    return withLock(uid, transactionId, assertFocus, async assertCurrent => {
      if (await local(uid, transactionId, assertCurrent)) throw unknown();
      const tuple = {...originalSource, requestId: randomUUID()};
      const hash = await inputHash(tuple); assertCurrent(); const intent: ShippingReceiptDeclarationIntent = {version: 1, ...tuple, inputHash: hash};
      await AsyncStorage.setItem(key(uid, transactionId), JSON.stringify(intent)); assertCurrent();
      await rpc(intent, 'execute', assertCurrent); return read(uid, transactionId, assertCurrent);
    });
  },
  resume(uid: string, transactionId: string, assertFocus: () => void) {
    return withLock(uid, transactionId, assertFocus, async assertCurrent => {
      const intent = await local(uid, transactionId, assertCurrent); if (!intent) throw unknown();
      await rpc(intent, 'execute', assertCurrent); return read(uid, transactionId, assertCurrent);
    });
  },
  neutralize(uid: string, transactionId: string, assertFocus: () => void) {
    return withLock(uid, transactionId, assertFocus, async assertCurrent => {
      const intent = await local(uid, transactionId, assertCurrent); if (!intent) throw unknown();
      await rpc(intent, 'neutralize', assertCurrent); return read(uid, transactionId, assertCurrent);
    });
  },
  acknowledge(uid: string, transactionId: string, assertFocus: () => void) {
    return withLock(uid, transactionId, assertFocus, async assertCurrent => {
      const intent = await local(uid, transactionId, assertCurrent); if (!intent) throw unknown();
      const receipt = await rpc(intent, 'observe', assertCurrent); if (!receipt.command) throw unknown();
      const exact = await local(uid, transactionId, assertCurrent); if (JSON.stringify(exact) !== JSON.stringify(intent)) throw unknown();
      await AsyncStorage.removeItem(key(uid, transactionId)); assertCurrent();
      const current = await preview(uid, transactionId, assertCurrent).catch(() => {assertCurrent(); return null;});
      return {intent: null, receipt, current, currentUnavailable: current === null};
    });
  },
};
