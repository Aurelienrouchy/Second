import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { User as FirebaseUser } from 'firebase/auth';
import { auth } from '@/config/firebaseConfig';
import { AuthService } from '@/services/authService';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';

export interface WalletWithdrawalIdentity {
  uid: string; owner: FirebaseUser; generation: number; navigationRevision: number; authTime: number; reviewRequestId?: string;
}
const LIFETIME_MS = 4 * 60_000;
async function awaitActive(guard: () => void): Promise<void> {
  guard(); if (AppState.currentState === 'active') return;
  await new Promise<void>((resolve, reject) => {
    const subscription = AppState.addEventListener('change', state => {
      try { guard(); } catch (error) { clearTimeout(timeout); subscription.remove(); reject(error); return; }
      if (state === 'active') { clearTimeout(timeout); subscription.remove(); resolve(); }
    });
    const timeout = setTimeout(() => {subscription.remove(); reject(new Error('Revenez dans le porte-monnaie pour poursuivre.'));}, 10_000);
    if (AppState.currentState === 'active') { clearTimeout(timeout); subscription.remove(); resolve(); }
  });
  guard();
}

/** Mounted above the generation-keyed financial projections. A normal foreground
 * hydration may change that generation during OAuth. The challenge stays tied to
 * the exact SDK User and navigation; it never authorizes or resumes a withdrawal.
 * An explicit new review binds the verified claim to the current generation/RID. */
export function useWalletWithdrawalIdentity(uid: string | null) {
  const navigationRef = useRef({ mounted: false, active: false, epoch: 0 });
  const operationRef = useRef<symbol | null>(null);
  const [navigation, setNavigation] = useState({ active: false, epoch: 0 });
  const [proof, setProof] = useState<WalletWithdrawalIdentity | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  useLayoutEffect(() => {
    navigationRef.current.mounted = true;
    return () => {navigationRef.current.mounted = false; operationRef.current = null;};
  }, []);
  useFocusEffect(useCallback(() => {
    navigationRef.current.active = true; navigationRef.current.epoch++;
    setNavigation({active: true, epoch: navigationRef.current.epoch});
    return () => {
      navigationRef.current.active = false; navigationRef.current.epoch++; operationRef.current = null;
      setNavigation({active: false, epoch: navigationRef.current.epoch}); setProof(null); setBusy(false); setNotice('');
    };
  }, [uid]));
  useEffect(() => {
    if (!proof) return;
    const remaining = proof.authTime * 1000 + LIFETIME_MS - Date.now();
    const timeout = setTimeout(() => setProof(null), remaining > 0 && remaining <= LIFETIME_MS ? remaining : 0);
    return () => clearTimeout(timeout);
  }, [proof]);
  const clear = useCallback(() => setProof(null), []);
  const assertProof = useCallback((reviewRequestId?: string) => {
    const current = navigationRef.current, age = proof ? Date.now() - proof.authTime * 1000 : Number.POSITIVE_INFINITY;
    if (!proof || !current.mounted || !current.active || current.epoch !== proof.navigationRevision || proof.uid !== uid ||
        auth.currentUser !== proof.owner || useAuthStore.getState().authenticatedUid !== proof.uid || age < 0 || age >= LIFETIME_MS ||
        (reviewRequestId ? proof.reviewRequestId !== reviewRequestId || proof.generation !== getAuthSessionGeneration()
          : proof.reviewRequestId !== undefined)) throw new Error('Confirmez votre identité, puis vérifiez à nouveau le montant et la banque.');
  }, [proof, uid]);
  const bindReview = useCallback((requestId: string, expectedProof: WalletWithdrawalIdentity | null) => {
    assertProof();
    if (!expectedProof || proof !== expectedProof || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new Error('La revue du retrait a changé.');
    const generation = getAuthSessionGeneration();
    setProof(previous => previous === expectedProof ? {...previous, generation, reviewRequestId: requestId} : null);
  }, [assertProof, proof]);
  const verify = useCallback(async () => {
    const owner = auth.currentUser, current = navigationRef.current;
    if (!uid || !owner || owner.uid !== uid || !current.mounted || !current.active || operationRef.current || AppState.currentState !== 'active') return;
    const provider = AuthService.getAuthProvider();
    if (provider !== 'google.com' && !(provider === 'apple.com' && Platform.OS === 'ios')) return;
    const operation = Symbol(), epoch = current.epoch, startedAt = Math.floor(Date.now() / 1000);
    operationRef.current = operation;
    const guard = () => {
      if (operationRef.current !== operation || !navigationRef.current.mounted || !navigationRef.current.active || navigationRef.current.epoch !== epoch ||
          auth.currentUser !== owner || useAuthStore.getState().authenticatedUid !== uid) throw new Error('La session ou la page a changé.');
    };
    setProof(null); setBusy(true); setNotice('');
    try {
      if (provider === 'google.com') await AuthService.reauthenticateWithGoogle(guard);
      else await AuthService.reauthenticateWithApple(guard);
      guard(); const token = await owner.getIdTokenResult(true); guard();
      const authTime = token.claims.auth_time, now = Math.floor(Date.now() / 1000);
      if (typeof authTime !== 'number' || !Number.isSafeInteger(authTime) || authTime < startedAt - 60 || authTime > now || now - authTime >= 240) {
        throw new Error('La nouvelle connexion doit être vérifiée.');
      }
      await awaitActive(guard); guard();
      setProof({uid, owner, generation: getAuthSessionGeneration(), navigationRevision: epoch, authTime});
      setNotice('Identité confirmée. Indiquez le montant puis vérifiez et confirmez la banque. Aucun retrait n’a été envoyé.');
    } catch (error) {
      try {guard(); setNotice(error instanceof Error ? error.message : 'La confirmation de votre identité doit être reprise.');} catch {/* Old owner/navigation cannot publish a result. */}
    } finally {
      if (operationRef.current === operation) {operationRef.current = null; setBusy(false);}
    }
  }, [uid]);
  const ready = !!proof && proof.uid === uid && proof.owner === auth.currentUser && navigation.active && proof.navigationRevision === navigation.epoch &&
    (!proof.reviewRequestId || proof.generation === getAuthSessionGeneration());
  return {proof, ready, busy, notice, verify, clear, assertProof, bindReview};
}
