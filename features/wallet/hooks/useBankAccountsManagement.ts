import AsyncStorage from '@/utils/environmentStorage';
import {randomUUID} from 'expo-crypto';
import {useFocusEffect} from 'expo-router';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Platform} from 'react-native';
import {auth} from '@/config/firebaseConfig';
import {BANK_OWNERSHIP_STATEMENT_VERSION} from '@/functions/src/shared/bankConsent';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {AuthService} from '@/services/authService';
import {withNativeReauthentication} from '@/services/nativeReauthentication';
import {getAuthSessionGeneration, useAuthStore} from '@/store/authStore';
import {useStripeAccount} from './useStripeAccount';
import type {BankAccountOperationInput} from '../services/stripeAccountService';
import type {PaymentBankAccount, StripeAccountStatus} from '../utils/stripeRequirements';

interface BankContext {
  uid: string; generation: number; focusEpoch: number;
  activityFrame: symbol; activityRevision: string; isCurrentActivity: () => boolean;
}
export type BankEditMode = 'add' | 'replace' | 'declare_current' | 'select_existing' | 'delete_existing';
interface BankDraft {mode: BankEditMode; bank: PaymentBankAccount | null}
const bankRequestKey = (uid: string) => `second:bank-operation:v1:${uid}`;
function readBankRequest(raw: string | null): string | null {
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !('requestId' in parsed) ||
      typeof parsed.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(parsed.requestId) ||
      Object.keys(parsed).length !== 1) throw new Error('Impossible de charger la modification.');
  return parsed.requestId;
}

/** One owner-bound banking controller, shared by the unified account page.
 * Only an opaque request ID is durable; banking coordinates never enter a cache. */
export function useBankAccountsManagement(contextKey: string, onCompleted?: (status: StripeAccountStatus) => void) {
  const uid = useAuthenticatedUid();
  const [instanceId] = useState(() => randomUUID());
  const generation = getAuthSessionGeneration();
  const activity = useLabelLifecycleContext(JSON.stringify(['payment-banks', contextKey]), uid, {preserveNativeReauthentication: true});
  const latestActivity = useRef(activity);
  useLayoutEffect(() => {latestActivity.current = activity;}, [activity]);
  const mounted = useRef(true), focus = useRef({active: false, epoch: 0}), busy = useRef(false);
  const declarationEpoch = useRef(0);
  const [owner, setOwner] = useState<BankContext | null>(null);
  const [focused, setFocused] = useState(false);
  const [restoreError, setRestoreError] = useState(false);
  const [restoreVersion, setRestoreVersion] = useState(0);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BankDraft | null>(null);
  const [conditionsVisible, setConditionsVisible] = useState(false);
  const [transitNumber, setTransitNumber] = useState('');
  const [institutionNumber, setInstitutionNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [holderName, setHolderName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resumeNeedsAuth, setResumeNeedsAuth] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [needsSupport, setNeedsSupport] = useState(false);

  const isCurrent = useCallback((context: BankContext) => mounted.current && focus.current.active &&
    context.focusEpoch === focus.current.epoch && context.generation === getAuthSessionGeneration() &&
    auth.currentUser?.uid === context.uid && useAuthStore.getState().authenticatedUid === context.uid && context.isCurrentActivity(), []);
  const assertCurrent = useCallback((context: BankContext) => {
    if (!isCurrent(context)) throw new Error('Rouvrez votre compte de paiement pour continuer.');
  }, [isCurrent]);
  const clearForm = useCallback(() => {
    setTransitNumber(''); setInstitutionNumber(''); setAccountNumber(''); setHolderName('');
    declarationEpoch.current++; setAccepted(false); setPassword(''); setDraft(null); setConditionsVisible(false);
  }, []);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  useFocusEffect(useCallback(() => {
    focus.current.active = true; setFocused(true);
    const focusEpoch = ++focus.current.epoch;
    let context: BankContext | null = null;
    try {
      const current = latestActivity.current, operation = current.capture();
      context = {uid: uid ?? '', generation, focusEpoch, activityFrame: current.frame, activityRevision: current.focusRevision,
        isCurrentActivity: () => current.isCurrent(operation)};
    } catch { /* No restoration can be adopted in an inactive route. */ }
    busy.current = false; clearForm(); setLoading(false); setResumeNeedsAuth(false); setMessage(null); setNeedsSupport(false);
    setOwner(null); setRequestId(null); setRestoreError(false);
    void (async () => {
      if (!context?.uid || !isCurrent(context)) return;
      try {
        const raw = await AsyncStorage.getItem(bankRequestKey(context.uid));
        if (!isCurrent(context)) return;
        setRequestId(readBankRequest(raw)); setOwner(context);
      } catch {if (isCurrent(context)) setRestoreError(true);}
    })();
    return () => {focus.current.active = false; focus.current.epoch++; setFocused(false); clearForm();};
  }, [uid, generation, restoreVersion, isCurrent, clearForm, activity.focusRevision, activity.frame]));

  const assertReadContext = useCallback(() => {
    if (!owner || !isCurrent(owner)) throw new Error('Rouvrez votre compte de paiement pour continuer.');
  }, [owner, isCurrent]);
  const ownerReady = focused && activity.focused && owner?.uid === uid && owner?.generation === generation &&
    owner.activityFrame === activity.frame && owner.activityRevision === activity.focusRevision;
  const {status, isLoading, isFetching, isError, refetch, replaceBankAccount} =
    useStripeAccount(uid ?? undefined, ownerReady, assertReadContext,
      JSON.stringify([instanceId, contextKey, owner?.focusEpoch, activity.focusRevision]), {includeBankAccounts: true});
  const readReady = ownerReady && status?.success === true && !isError && !isFetching;
  const inventoryVisible = ownerReady && status?.success === true && !isError && status.bankAccountsAvailable === true && Array.isArray(status.bankAccounts);
  const inventoryReady = readReady && inventoryVisible;
  const bankChangesBlockedReason = inventoryVisible ? status.bankChangesBlockedReason ?? null : null;
  const serverOperation = status?.bankOperation;
  const serverRequest = serverOperation && !['completed', 'rejected', 'candidate_unavailable'].includes(serverOperation.state)
    ? serverOperation.requestId : null;
  const unresolvedRequest = requestId ?? serverRequest;
  const supportRequired = needsSupport || serverOperation?.state === 'selection_unknown' ||
    serverOperation?.state === 'reconciliation_required';
  const provider = AuthService.getAuthProvider();
  const passwordProvider = provider === 'password' || (provider === 'apple.com' && Platform.OS !== 'ios' && AuthService.hasPasswordProvider());
  const canReauth = provider === 'password' || provider === 'google.com' ||
    (provider === 'apple.com' && (Platform.OS === 'ios' || AuthService.hasPasswordProvider()));
  const currentDraftBank = draft?.bank ? status?.bankAccounts?.find(bank => bank.id === draft.bank!.id) : null;
  const requiresDeclaration = draft?.mode === 'add' || draft?.mode === 'replace' || draft?.mode === 'declare_current' ||
    draft?.mode === 'select_existing' && currentDraftBank?.selectionDeclarationRequired === true;

  const reauthenticate = async (context: BankContext) => {
    const check = () => assertCurrent(context); check();
    if (passwordProvider) {
      if (!password) throw new Error('Saisissez votre mot de passe pour continuer.');
      await AuthService.reauthenticate(password, check);
    } else if (provider === 'google.com' || provider === 'apple.com' && Platform.OS === 'ios') {
      const origin = () => {
        if (!mounted.current || !focus.current.active || context.focusEpoch !== focus.current.epoch ||
            context.generation !== getAuthSessionGeneration() || auth.currentUser?.uid !== context.uid ||
            useAuthStore.getState().authenticatedUid !== context.uid) throw new Error('Rouvrez votre compte de paiement pour continuer.');
      };
      await withNativeReauthentication(context.uid, origin, native => provider === 'google.com'
        ? AuthService.reauthenticateWithGoogle(native.assertCurrent, native.waitForActive)
        : AuthService.reauthenticateWithApple(native.assertCurrent, native.waitForActive));
    } else throw new Error('Contactez notre équipe pour confirmer votre identité.');
    check();
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.uid !== context.uid) throw new Error('Rouvrez votre compte de paiement pour continuer.');
    await currentUser.getIdToken(true); check(); setPassword('');
  };

  const validateForm = (): string | null => {
    if (!draft || !canReauth) return 'Contactez notre équipe pour confirmer votre identité.';
    if (requiresDeclaration && (!holderName.trim() || holderName.trim().length > 200)) return 'Indiquez le nom figurant sur le compte bancaire.';
    if ((draft.mode === 'add' || draft.mode === 'replace') &&
        (!/^\d{5}$/.test(transitNumber) || !/^\d{3}$/.test(institutionNumber) || !/^\d{7,12}$/.test(accountNumber)))
      return 'Le transit contient 5 chiffres, l’institution 3 chiffres et le compte entre 7 et 12 chiffres.';
    if (passwordProvider && !password) return 'Saisissez votre mot de passe pour continuer.';
    return null;
  };
  const submit = async (resume: boolean) => {
    if (busy.current || !owner || !isCurrent(owner) || !readReady || !status?.hasAccount) return;
    const context = owner, acceptanceEpoch = declarationEpoch.current;
    let input: BankAccountOperationInput;
    let submittedId: string;
    if (resume) {
      if (!unresolvedRequest) return;
      submittedId = unresolvedRequest; input = {requestId: submittedId};
    } else {
      if (unresolvedRequest || !inventoryReady || !draft) return;
      if (bankChangesBlockedReason) {
        setMessage(bankChangesBlockedReason === 'withdrawal_in_progress' ? 'Un retrait est en cours. Réessayez une fois terminé.'
          : 'Une modification bancaire est en cours. Actualisez pour continuer.'); return;
      }
      const error = validateForm();
      if (error) {setMessage(error); return;}
      if (requiresDeclaration && !accepted) {setMessage('Confirmez les conditions pour continuer.'); return;}
      const currentBank = draft.bank ? status.bankAccounts?.find(bank => bank.id === draft.bank!.id) : null;
      if (draft.mode === 'select_existing' && !currentBank?.canSelect || draft.mode === 'delete_existing' && !currentBank?.canDelete) {
        setMessage('Actualisez vos comptes bancaires avant de continuer.'); return;
      }
      submittedId = randomUUID();
      const declaration = {accountHolderName: holderName.trim(), bankOwnershipAccepted: true as const,
        bankOwnershipStatementVersion: BANK_OWNERSHIP_STATEMENT_VERSION};
      if (draft.mode === 'add' || draft.mode === 'replace') input = {requestId: submittedId, mode: 'replace', ...declaration,
        transitNumber, institutionNumber, accountNumber};
      else if (draft.mode === 'declare_current') {
        if (!status.bankAccountId) return;
        input = {requestId: submittedId, mode: 'declare_current', bankAccountId: status.bankAccountId, ...declaration};
      } else input = {requestId: submittedId, mode: draft.mode, bankAccountId: draft.bank!.id,
        ...(requiresDeclaration ? declaration : {})};
    }
    busy.current = true; setLoading(true); setMessage(null);
    let dispatched = false;
    try {
      if (!resume || resumeNeedsAuth) await reauthenticate(context);
      assertCurrent(context);
      if (!resume && requiresDeclaration && declarationEpoch.current !== acceptanceEpoch) throw new Error('Confirmez les conditions pour continuer.');
      await AsyncStorage.setItem(bankRequestKey(context.uid), JSON.stringify({requestId: submittedId}));
      assertCurrent(context); setRequestId(submittedId); dispatched = true;
      const response = await replaceBankAccount({input, assertCurrent: () => assertCurrent(context)});
      assertCurrent(context);
      if (response.requestId !== submittedId) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(response.requestId) || response.action === null || response.action === 'correctBankDetails')
          throw new Error('La modification ne peut pas être confirmée pour le moment.');
        await AsyncStorage.setItem(bankRequestKey(context.uid), JSON.stringify({requestId: response.requestId}));
        assertCurrent(context); setRequestId(response.requestId);
      }
      setResumeNeedsAuth(false); setNeedsSupport(response.action === 'contactSupport');
      if (response.action === null || response.action === 'correctBankDetails') {
        await AsyncStorage.removeItem(bankRequestKey(context.uid)); assertCurrent(context); setRequestId(null);
      }
      if (response.action === 'correctBankDetails') {
        declarationEpoch.current++; setAccepted(false); setConditionsVisible(false);
        setMessage('Vérifiez les coordonnées bancaires puis réessayez.');
      } else {
        clearForm();
        setMessage(response.success && response.action === null ? 'Compte bancaire mis à jour.'
          : response.action === 'contactSupport' ? 'Contactez notre équipe pour terminer cette modification.'
            : 'La modification est en cours. Actualisez pour connaître la suite.');
      }
      const refreshed = await refetch(); assertCurrent(context);
      if (response.success && response.action === null && !refreshed.isError && refreshed.fetchStatus === 'idle' && refreshed.data)
        onCompleted?.(refreshed.data);
    } catch (error: unknown) {
      if (!isCurrent(context)) return;
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const details = error && typeof error === 'object' && 'details' in error && error.details && typeof error.details === 'object'
        ? error.details as {reason?: unknown; action?: unknown; requestId?: unknown} : null;
      if (resume && details?.reason === 'bank_operation_not_started' && details.action === 'discardRequestJournal' && details.requestId === submittedId) {
        try {await AsyncStorage.removeItem(bankRequestKey(context.uid)); assertCurrent(context); setRequestId(null); setResumeNeedsAuth(false);
          setMessage('La modification n’a pas été envoyée. Vous pouvez réessayer.');}
        catch {if (isCurrent(context)) setMessage('Impossible de terminer la modification. Réessayez.');}
        return;
      }
      if (code === 'functions/unauthenticated' || code === 'auth/requires-recent-login' || details?.reason === 'recent_auth_required') setResumeNeedsAuth(true);
      if (dispatched) {clearForm(); setMessage('La modification n’a pas encore pu être confirmée. Actualisez pour continuer.');}
      else setMessage(error instanceof Error ? error.message : 'Impossible de confirmer votre identité. Réessayez.');
    } finally {if (isCurrent(context)) {busy.current = false; setLoading(false);}}
  };
  const open = (mode: BankEditMode, bank: PaymentBankAccount | null = null) => {
    if (!owner || !isCurrent(owner) || !inventoryReady || unresolvedRequest || busy.current || supportRequired) return;
    if (bankChangesBlockedReason) return;
    if (mode === 'select_existing' && !bank?.canSelect || mode === 'delete_existing' && !bank?.canDelete) return;
    clearForm(); setDraft({mode, bank}); setMessage(null);
  };
  const invalidateDeclaration = () => {declarationEpoch.current++; setAccepted(false);};
  return {
    status, isLoading: !owner || isLoading, isFetching, isError, readReady, inventoryReady, inventoryVisible, restoreError, bankChangesBlockedReason,
    accounts: inventoryVisible ? status.bankAccounts! : [], unresolvedRequest, supportRequired, loading, message,
    draft, conditionsVisible, requiresDeclaration, accepted, passwordProvider, canReauth, password, resumeNeedsAuth,
    transitNumber, institutionNumber, accountNumber, holderName, open,
    changeHolder: (value: string) => {invalidateDeclaration(); setHolderName(value);},
    changeTransit: (value: string) => {invalidateDeclaration(); setTransitNumber(value.replace(/\D/g, '').slice(0, 5));},
    changeInstitution: (value: string) => {invalidateDeclaration(); setInstitutionNumber(value.replace(/\D/g, '').slice(0, 3));},
    changeAccount: (value: string) => {invalidateDeclaration(); setAccountNumber(value.replace(/\D/g, '').slice(0, 12));},
    setPassword,
    toggleAcceptance: () => {if (!loading && owner && isCurrent(owner)) {declarationEpoch.current++; setAccepted(value => !value);}},
    close: () => {if (!busy.current) clearForm();},
    closeConditions: () => {if (!busy.current) setConditionsVisible(false);},
    continue: () => {if (!loading) {const error = validateForm(); if (error) setMessage(error);
      else if (requiresDeclaration) setConditionsVisible(true); else void submit(false);}},
    confirm: () => {void submit(false);},
    resume: () => {void submit(true);},
    refresh: () => {if (owner && isCurrent(owner)) void refetch();},
    restore: () => setRestoreVersion(value => value + 1),
  };
}
