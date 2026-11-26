import AsyncStorage from '@/utils/environmentStorage';
import {assertTradeSessionCurrent, captureTradeSession} from '@/services/tradeOperation';
import {productReviewEqual, productReviewHash} from '@/services/productReviewService';
import {ConvenienceReturnService, convenienceReturnFailure} from '@/services/convenienceReturnService';
import {convenienceId, isConvenienceAttempt, isConvenienceReturnReceptionAttempt, isConvenienceReturnIncidentAttempt} from '@/utils/convenienceReturnContract';
import type {ConvenienceReturnAttempt, ConvenienceReturnReceptionAttempt, ConvenienceReturnIncidentAttempt} from '@/types/convenienceReturn';
// This is the local journal format, not the agreement policy version. A retained
// V1 intention must be resolved before a V2 intention can use the same slot.
const slot = (uid: string, transactionId: string) => `second:convenience-return:v1:${JSON.stringify([uid, transactionId])}`;
const locks = new Set<string>();
const receptionSlot = (uid: string, transactionId: string) => `second:convenience-return-reception:v1:${JSON.stringify([uid, transactionId])}`;
const incidentSlot = (uid: string) => `second:convenience-return-incidents:v1:${uid}`;
function fence(uid: string, guard: () => void) {const session = captureTradeSession(uid); return () => {assertTradeSessionCurrent(session); guard();};}
async function read(uid: string, transactionId: string, guard: () => void): Promise<ConvenienceReturnAttempt | null> {
  const current = fence(uid, guard); current(); if (!convenienceId(transactionId)) throw convenienceReturnFailure();
  const raw = await AsyncStorage.getItem(slot(uid, transactionId)); current(); if (raw === null) return null;
  const a: unknown = JSON.parse(raw);
  if (!isConvenienceAttempt(a, uid, transactionId) || await productReviewHash(a.command) !== a.payloadHash) throw convenienceReturnFailure(); current(); return a;
}
async function run(a: ConvenienceReturnAttempt, mode: 'execute' | 'observe' | 'neutralize' | 'acknowledge', guard: () => void, verifyNew?: () => Promise<void>) {
  const current = fence(a.uid, guard), key = slot(a.uid, a.transactionId); current();
  if (!isConvenienceAttempt(a, a.uid, a.transactionId) || await productReviewHash(a.command) !== a.payloadHash) throw convenienceReturnFailure(); current();
  if (locks.has(key)) throw convenienceReturnFailure(); locks.add(key);
  try {
    const prior = await read(a.uid, a.transactionId, current); current();
    if (mode === 'execute') {
      if (prior !== null || !verifyNew) throw convenienceReturnFailure();
      await AsyncStorage.setItem(key, JSON.stringify(a)); current();
      if (!productReviewEqual(await read(a.uid, a.transactionId, current), a)) throw convenienceReturnFailure(); current();
      await verifyNew(); current(); await ConvenienceReturnService.command(a, 'execute', current); current();
      return ConvenienceReturnService.command(a, 'observe', current);
    }
    if (!productReviewEqual(prior, a)) throw convenienceReturnFailure();
    const receipt = await ConvenienceReturnService.command(a, 'observe', current); current();
    if (mode === 'observe') return receipt;
    if (mode === 'neutralize') {
      if (receipt.state !== 'absent') return receipt;
      await ConvenienceReturnService.command(a, 'neutralize', current); current();
      return ConvenienceReturnService.command(a, 'observe', current);
    }
    if (receipt.state === 'absent' || receipt.recordedAt === null) throw convenienceReturnFailure();
    if (!productReviewEqual(await read(a.uid, a.transactionId, current), a)) throw convenienceReturnFailure(); current();
    await AsyncStorage.removeItem(key); current(); return receipt;
  } finally {locks.delete(key);}
}
async function readReception(uid: string, transactionId: string, guard: () => void): Promise<ConvenienceReturnReceptionAttempt | null> {
  const current = fence(uid, guard); current(); if (!convenienceId(transactionId)) throw convenienceReturnFailure();
  const raw = await AsyncStorage.getItem(receptionSlot(uid, transactionId)); current(); if (raw === null) return null;
  const a: unknown = JSON.parse(raw);
  if (!isConvenienceReturnReceptionAttempt(a, uid, transactionId) || await productReviewHash(a.command) !== a.payloadHash) throw convenienceReturnFailure(); current(); return a;
}
async function runReception(a: ConvenienceReturnReceptionAttempt, mode: 'execute' | 'observe' | 'neutralize' | 'acknowledge', guard: () => void, verifyNew?: () => Promise<void>) {
  const current = fence(a.uid, guard), key = receptionSlot(a.uid, a.transactionId); current();
  if (!isConvenienceReturnReceptionAttempt(a, a.uid, a.transactionId) || await productReviewHash(a.command) !== a.payloadHash) throw convenienceReturnFailure(); current();
  if (locks.has(key)) throw convenienceReturnFailure(); locks.add(key);
  try {
    const prior = await readReception(a.uid, a.transactionId, current); current();
    if (mode === 'execute') {
      if (prior !== null || !verifyNew) throw convenienceReturnFailure();
      await AsyncStorage.setItem(key, JSON.stringify(a)); current();
      if (!productReviewEqual(await readReception(a.uid, a.transactionId, current), a)) throw convenienceReturnFailure(); current();
      await verifyNew(); current(); await ConvenienceReturnService.receptionCommand(a, 'execute', current); current();
      return ConvenienceReturnService.receptionCommand(a, 'observe', current);
    }
    if (!productReviewEqual(prior, a)) throw convenienceReturnFailure();
    const receipt = await ConvenienceReturnService.receptionCommand(a, 'observe', current); current();
    if (mode === 'observe') return receipt;
    if (mode === 'neutralize') {
      if (receipt.state !== 'absent') return receipt;
      await ConvenienceReturnService.receptionCommand(a, 'neutralize', current); current();
      return ConvenienceReturnService.receptionCommand(a, 'observe', current);
    }
    if (receipt.state === 'absent' || receipt.recordedAt === null) throw convenienceReturnFailure();
    if (!productReviewEqual(await readReception(a.uid, a.transactionId, current), a)) throw convenienceReturnFailure(); current();
    await AsyncStorage.removeItem(key); current(); return receipt;
  } finally {locks.delete(key);}
}
async function readIncidents(uid: string, guard: () => void): Promise<ConvenienceReturnIncidentAttempt[]> {
  const current = fence(uid, guard); current(); if (!convenienceId(uid)) throw convenienceReturnFailure();
  const raw = await AsyncStorage.getItem(incidentSlot(uid)); current(); if (raw === null) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows) || rows.length > 50) throw convenienceReturnFailure();
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isConvenienceReturnIncidentAttempt(row, uid) || seen.has(row.requestId) || await productReviewHash(row.command) !== row.payloadHash) throw convenienceReturnFailure(); current(); seen.add(row.requestId);
  }
  return rows as ConvenienceReturnIncidentAttempt[];
}
async function runIncident(a: ConvenienceReturnIncidentAttempt, mode: 'execute' | 'observe' | 'neutralize' | 'acknowledge', guard: () => void, verifyNew?: () => Promise<void>) {
  const current = fence(a.uid, guard), key = incidentSlot(a.uid); current();
  if (!isConvenienceReturnIncidentAttempt(a, a.uid) || await productReviewHash(a.command) !== a.payloadHash) throw convenienceReturnFailure(); current();
  if (locks.has(key)) throw convenienceReturnFailure(); locks.add(key);
  try {
    const rows = await readIncidents(a.uid, current); current(); const prior = rows.find(row => row.requestId === a.requestId);
    if (mode === 'execute') {
      if (prior || rows.length >= 50 || rows.some(row => row.transactionId === a.transactionId) || !verifyNew) throw convenienceReturnFailure();
      await AsyncStorage.setItem(key, JSON.stringify([...rows, a])); current();
      if (!productReviewEqual((await readIncidents(a.uid, current)).find(row => row.requestId === a.requestId), a)) throw convenienceReturnFailure(); current();
      await verifyNew(); current(); await ConvenienceReturnService.incidentCommand(a, 'execute', current); current();
      return ConvenienceReturnService.incidentCommand(a, 'observe', current);
    }
    if (!productReviewEqual(prior, a)) throw convenienceReturnFailure();
    const receipt = await ConvenienceReturnService.incidentCommand(a, 'observe', current); current();
    if (mode === 'observe') return receipt;
    if (mode === 'neutralize') {
      if (receipt.state !== 'absent') return receipt;
      await ConvenienceReturnService.incidentCommand(a, 'neutralize', current); current();
      return ConvenienceReturnService.incidentCommand(a, 'observe', current);
    }
    if (receipt.state === 'absent' || receipt.recordedAt === null) throw convenienceReturnFailure();
    const latest = await readIncidents(a.uid, current); current();
    if (!productReviewEqual(latest.find(row => row.requestId === a.requestId), a)) throw convenienceReturnFailure();
    await AsyncStorage.setItem(key, JSON.stringify(latest.filter(row => row.requestId !== a.requestId))); current(); return receipt;
  } finally {locks.delete(key);}
}
export const ConvenienceReturnJournal = {read,
  execute: (a: ConvenienceReturnAttempt, g: () => void, v: () => Promise<void>) => run(a, 'execute', g, v),
  observe: (a: ConvenienceReturnAttempt, g: () => void) => run(a, 'observe', g),
  neutralize: (a: ConvenienceReturnAttempt, g: () => void) => run(a, 'neutralize', g),
  acknowledge: (a: ConvenienceReturnAttempt, g: () => void) => run(a, 'acknowledge', g),
  readReception,
  executeReception: (a: ConvenienceReturnReceptionAttempt, g: () => void, v: () => Promise<void>) => runReception(a, 'execute', g, v),
  observeReception: (a: ConvenienceReturnReceptionAttempt, g: () => void) => runReception(a, 'observe', g),
  neutralizeReception: (a: ConvenienceReturnReceptionAttempt, g: () => void) => runReception(a, 'neutralize', g),
  acknowledgeReception: (a: ConvenienceReturnReceptionAttempt, g: () => void) => runReception(a, 'acknowledge', g),
  readIncidents,
  executeIncident: (a: ConvenienceReturnIncidentAttempt, g: () => void, v: () => Promise<void>) => runIncident(a, 'execute', g, v),
  observeIncident: (a: ConvenienceReturnIncidentAttempt, g: () => void) => runIncident(a, 'observe', g),
  neutralizeIncident: (a: ConvenienceReturnIncidentAttempt, g: () => void) => runIncident(a, 'neutralize', g),
  acknowledgeIncident: (a: ConvenienceReturnIncidentAttempt, g: () => void) => runIncident(a, 'acknowledge', g),
};
