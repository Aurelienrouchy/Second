import AsyncStorage from '@/utils/environmentStorage';
import {captureTradeSession,assertTradeSessionCurrent} from '@/services/tradeOperation';
import {ContentSafetyService,contentAttempt,sameContentSafety} from '@/services/contentSafetyService';
import type {ContentAttempt} from '@/types/contentSafety';
const slot = (uid: string,scope: 'own'|'admin') => `second:content-safety:v1:${JSON.stringify([uid,scope])}`;
const locks = new Set<string>();
const fail = () => new Error('Relisez l’intention de contenu conservée avant tout nouvel envoi.');
async function read(uid: string,scope: 'own'|'admin',current: () => void): Promise<ContentAttempt|null> {const session = captureTradeSession(uid); current(); const raw = await AsyncStorage.getItem(slot(uid,scope)); assertTradeSessionCurrent(session); current(); if (raw === null) return null; let v: unknown; try {v = JSON.parse(raw);} catch {throw fail();} if (!contentAttempt(v,uid) || v.command.scope !== scope) throw fail(); return v;}
async function work(a: ContentAttempt,current: () => void,mode: 'execute'|'observe'|'neutralize'|'acknowledge') {
  if (!contentAttempt(a,a.uid)) throw fail(); const key = slot(a.uid,a.command.scope),session = captureTradeSession(a.uid); current(); if (locks.has(key)) throw fail(); locks.add(key);
  try {const prior = await read(a.uid,a.command.scope,current); if (prior ? !sameContentSafety(a,prior) : mode !== 'execute') throw fail();
    if (!prior) {current(); await AsyncStorage.setItem(key,JSON.stringify(a)); assertTradeSessionCurrent(session); current();}
    const saved = await read(a.uid,a.command.scope,current); if (!saved || !sameContentSafety(saved,a)) throw fail();
    const receipt = await ContentSafetyService.command(saved,mode === 'acknowledge' ? 'observe' : mode,current); current();
    if (mode === 'acknowledge') {if (receipt.state === 'unrecorded') throw fail(); const still = await read(a.uid,a.command.scope,current); if (!sameContentSafety(still,a)) throw fail(); await AsyncStorage.removeItem(key); assertTradeSessionCurrent(session); current();}
    return receipt;
  } finally {locks.delete(key);}
}
export const ContentSafetyJournal = {read,execute:(a:ContentAttempt,c:()=>void)=>work(a,c,'execute'),observe:(a:ContentAttempt,c:()=>void)=>work(a,c,'observe'),neutralize:(a:ContentAttempt,c:()=>void)=>work(a,c,'neutralize'),acknowledge:(a:ContentAttempt,c:()=>void)=>work(a,c,'acknowledge')};
