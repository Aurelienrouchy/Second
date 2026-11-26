import AsyncStorage from '@/utils/environmentStorage';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { track } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';
import { EligibilityService } from '@/services/eligibilityService';
import { useQuery } from '@tanstack/react-query';
import { AuthService, isAccountClosureResult } from '@/services/authService';
import type { AccountClosureMode, AccountClosureResult } from '@/services/authService';
import { auth } from '@/config/firebaseConfig';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Label, Caption, ScreenHeader, Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

interface ClosureContext { uid: string; generation: number; focusEpoch: number; activityEpoch: number }
interface ClosureAttempt {
  ownerId: string;
  mode: AccountClosureMode;
  result: AccountClosureResult | null;
}
const closureKey = (uid: string) => `@account_closure:${encodeURIComponent(uid)}`;

function parseClosureAttempt(raw: string | null, uid: string): ClosureAttempt | null {
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Demande conservée illisible.');
  const attempt = value as Record<string, unknown>;
  if (attempt.ownerId !== uid || typeof attempt.mode !== 'string' || !['pause', 'delete'].includes(attempt.mode) ||
      !(attempt.result === null || isAccountClosureResult(attempt.result))) throw new Error('Demande conservée illisible.');
  return attempt as unknown as ClosureAttempt;
}

export default function DeleteAccountScreen() {
  const router = useRouter();
  const uid = useAuthenticatedUid();
  const generation = useAuthStore(getAuthSessionGeneration);
  const mountedRef = useRef(true);
  const focusedRef = useRef(false);
  const focusEpochRef = useRef(0);
  const activityRef = useRef({state: AppState.currentState, epoch: 0});
  const [activityRevision, setActivityRevision] = useState(0);
  const busyRef = useRef(false);
  const attemptRef = useRef<ClosureAttempt | null>(null);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [reauthDone, setReauthDone] = useState(false);
  const [step, setStep] = useState<'info' | 'confirm'>('info');
  const [mode, setMode] = useState<AccountClosureMode>('pause');
  const [result, setResult] = useState<AccountClosureResult | null>(null);
  const [resultMode, setResultMode] = useState<AccountClosureMode | null>(null);
  const [unknownResult, setUnknownResult] = useState(false);
  const [journalReady, setJournalReady] = useState(false);
  const [journalOwner, setJournalOwner] = useState<ClosureContext | null>(null);
  const [restoreError, setRestoreError] = useState(false);
  const [restoreVersion, setRestoreVersion] = useState(0);

  const isViewCurrent = useCallback((captured: ClosureContext) => mountedRef.current && focusedRef.current &&
    captured.focusEpoch === focusEpochRef.current && AppState.currentState === 'active' &&
    activityRef.current.state === 'active' && captured.activityEpoch === activityRef.current.epoch, []);
  const isCurrent = useCallback((captured: ClosureContext) => isViewCurrent(captured) &&
    captured.generation === getAuthSessionGeneration() && auth.currentUser?.uid === captured.uid &&
    useAuthStore.getState().authenticatedUid === captured.uid, [isViewCurrent]);
  const captureContext = (): ClosureContext => {
    const captured = { uid: uid ?? '', generation: getAuthSessionGeneration(), focusEpoch: focusEpochRef.current,
      activityEpoch: activityRef.current.epoch };
    if (!captured.uid || !isCurrent(captured) || journalOwner?.uid !== captured.uid ||
        journalOwner.generation !== captured.generation || journalOwner.focusEpoch !== captured.focusEpoch ||
        journalOwner.activityEpoch !== captured.activityEpoch) {
      throw new Error('La session a changé. Rouvrez cette demande.');
    }
    return captured;
  };
  const assertContext = (captured: ClosureContext) => {
    if (!isCurrent(captured)) throw new Error('La session a changé. Rouvrez cette demande.');
  };
  useEffect(() => {
    mountedRef.current = true;
    const changed = (state: typeof AppState.currentState) => {
      if (activityRef.current.state === state) return;
      // Invalidate before a React render: returning to active never revives an
      // operation captured before backgrounding or an intervening state.
      const next = {state, epoch: activityRef.current.epoch + 1};
      activityRef.current = next;
      setActivityRevision(next.epoch);
    };
    const subscription = AppState.addEventListener('change', changed);
    changed(AppState.currentState);
    return () => { mountedRef.current = false; subscription.remove(); };
  }, []);
  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    const captured = { uid: uid ?? '', generation, focusEpoch: ++focusEpochRef.current,
      activityEpoch: activityRevision };
    busyRef.current = false;
    attemptRef.current = null;
    setPassword(''); setConfirmText(''); setReauthDone(false); setLoading(false);
    setJournalReady(false); setJournalOwner(null); setRestoreError(false); setResult(null); setResultMode(null); setUnknownResult(false); setStep('info');
    void (async () => {
      try {
        if (!isCurrent(captured)) return;
        const raw = await AsyncStorage.getItem(closureKey(captured.uid));
        if (!isCurrent(captured)) return;
        // Legacy delete responses were not tracked erasures. They cannot be
        // adopted as proof for the new, separately journaled protocol.
        const restored = parseClosureAttempt(raw, captured.uid);
        const saved = restored?.mode === 'pause' ? restored : null;
        attemptRef.current = saved;
        setMode(saved?.mode ?? 'pause');
        setResult(saved?.result ?? null);
        setResultMode(saved?.result ? saved.mode : null);
        setUnknownResult(!!saved && !saved.result);
        if (saved && !saved.result) setStep('confirm');
        setJournalOwner(captured);
        setJournalReady(true);
      } catch {
        if (isCurrent(captured)) setRestoreError(true);
      }
    })();
    return () => { focusedRef.current = false; focusEpochRef.current++; };
  }, [uid, generation, restoreVersion, activityRevision, isCurrent]));

  const provider = AuthService.getAuthProvider();
  const isPasswordUser = provider === 'password';
  const isUnknownProvider = provider === 'unknown';
  const isAppleOnAndroid = provider === 'apple.com' && Platform.OS !== 'ios';
  const hasPasswordProvider = AuthService.hasPasswordProvider();
  const authProvider = provider === 'google.com' ? 'google' : provider === 'apple.com' ? 'apple' : provider;
  const confirmation = mode === 'pause' ? 'PAUSE' : 'SUPPRIMER';
  const journalIsCurrent = journalReady && journalOwner?.uid === uid && journalOwner.generation === generation &&
    journalOwner.activityEpoch === activityRevision && AppState.currentState === 'active';
  const closureStatus = useQuery({
    queryKey: [...queryKeys.eligibility.owner(uid ?? ''), 'account-closure', generation, journalOwner?.focusEpoch ?? 0],
    queryFn: async () => {
      if (!journalOwner) throw new Error('La demande doit être relue.');
      assertContext(journalOwner);
      const response = await EligibilityService.getMine(journalOwner.uid);
      assertContext(journalOwner);
      return response.accountClosure ?? null;
    },
    enabled: journalIsCurrent && !result?.authDeleted && result?.status !== 'complete',
    staleTime: 0, gcTime: 0, retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false,
  });
  const needsSupport = result?.authDeleted === true || result?.action === 'contactSupport' || closureStatus.data?.action === 'contactSupport';
  const ownerReadReady = closureStatus.isSuccess && !closureStatus.isFetching && !closureStatus.isError;
  const smallBalanceNeedsReview = result?.blockers?.includes('small_balance_closure_assistance') === true;
  const privacyRetentionNeedsReview = result?.blockers?.includes('privacy_retention_review_required') === true;
  const externalErasureNeedsReview = result?.blockers?.includes('external_erasure_retention_review_required') === true;

  const handleReauth = async (usePassword = false) => {
    if (busyRef.current || needsSupport || !ownerReadReady || isUnknownProvider || (isAppleOnAndroid && !usePassword)) return;
    let captured: ClosureContext;
    try { captured = captureContext(); } catch { return; }
    busyRef.current = true; setLoading(true);
    const assertCurrent = () => assertContext(captured);
    try {
      if (usePassword) await AuthService.reauthenticate(password, assertCurrent);
      else if (provider === 'google.com') await AuthService.reauthenticateWithGoogle(assertCurrent);
      else await AuthService.reauthenticateWithApple(assertCurrent);
      assertCurrent();
      setReauthDone(true);
      track('reauth_performed', { context: 'delete_account', provider: usePassword ? 'password' : provider === 'google.com' ? 'google' : 'apple', result: 'success' });
    } catch (error: unknown) {
      if (!isCurrent(captured)) return;
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const cancelled = code === 'ERR_REQUEST_CANCELED' || code === 'SIGN_IN_CANCELLED';
      if (!cancelled) Alert.alert('Identité à vérifier', error instanceof Error ? error.message : 'La vérification a échoué. Réessayez.');
    } finally {
      if (isCurrent(captured)) { busyRef.current = false; setLoading(false); }
    }
  };

  const startMode = (nextMode: AccountClosureMode) => {
    if (nextMode === 'delete') {router.push('/settings/erase-account' as never); return;}
    if (busyRef.current || !journalIsCurrent || !ownerReadReady || needsSupport || unknownResult || result?.status === 'complete' ||
        (result?.status === 'incomplete' && nextMode !== mode)) return;
    setMode(nextMode); setStep('confirm'); setConfirmText(''); setPassword(''); setReauthDone(false);
  };

  const handleClosure = async () => {
    if (busyRef.current || !journalIsCurrent || !ownerReadReady || needsSupport || !uid) return;
    let captured: ClosureContext;
    try { captured = captureContext(); } catch { return; }
    if (confirmText !== confirmation) { Alert.alert('Confirmation requise', `Saisissez ${confirmation} pour poursuivre.`); return; }
    if (isUnknownProvider || (isAppleOnAndroid && !hasPasswordProvider) ||
        (!isPasswordUser && !reauthDone)) { Alert.alert('Identité à vérifier', 'Confirmez votre identité avant de poursuivre.'); return; }
    const prior = attemptRef.current;
    if (prior && !prior.result && prior.mode !== mode) return;
    const submitted: ClosureAttempt = { ownerId: captured.uid, mode, result: null };
    busyRef.current = true; setLoading(true);
    const assertCurrent = () => {
      assertContext(captured);
      if (attemptRef.current && (attemptRef.current.ownerId !== submitted.ownerId || attemptRef.current.mode !== submitted.mode)) {
        throw new Error('La demande affichée a changé.');
      }
    };
    try {
      if (isPasswordUser) await AuthService.reauthenticate(password, () => assertContext(captured));
      assertContext(captured);
      attemptRef.current = submitted;
      await AsyncStorage.setItem(closureKey(captured.uid), JSON.stringify(submitted));
      assertCurrent();
      setUnknownResult(true);
      const response = await AuthService.deleteAccount(submitted.mode, { expectedUid: captured.uid, assertCurrent });
      assertCurrent();
      const recorded = { ...submitted, result: response };
      await AsyncStorage.setItem(closureKey(captured.uid), JSON.stringify(recorded));
      assertCurrent();
      attemptRef.current = recorded;
      setResult(response); setResultMode(submitted.mode); setUnknownResult(false); setPassword('');
      if (response.status === 'complete' && response.deletionComplete === true) {
        track('account_deletion_submitted', { auth_provider: authProvider, outcome: 'success' });
        assertCurrent();
        await useAuthStore.getState().signOut({ skipRemoteFcmCleanup: true,
          expectedUid: captured.uid, expectedGeneration: captured.generation });
        // Logout intentionally changes the generation. Never navigate over a
        // different account (including a new session for the same UID).
        if (isViewCurrent(captured) && !auth.currentUser && useAuthStore.getState().authenticatedUid === null &&
            getAuthSessionGeneration() === captured.generation + 1) router.replace('/');
      }
    } catch (error: unknown) {
      if (!isCurrent(captured)) return;
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code === 'functions/unauthenticated' || code === 'auth/requires-recent-login') setReauthDone(false);
      // A lost response is not proof of deletion or proof that nothing happened.
      // Preserve the owning mode; only an explicit retry can resume this request.
      setUnknownResult(attemptRef.current?.result === null);
      Alert.alert('Demande à vérifier', error instanceof Error ? error.message : 'Le résultat reste à vérifier. Reprenez cette même demande ou contactez notre équipe.');
    } finally {
      if (isCurrent(captured)) { busyRef.current = false; setLoading(false); }
    }
  };

  const canSubmit = journalIsCurrent && ownerReadReady && !needsSupport && !isUnknownProvider && !(isAppleOnAndroid && !hasPasswordProvider) &&
    confirmText === confirmation && (isPasswordUser ? !!password : reauthDone);
  const statusTitle = unknownResult ? 'Résultat à vérifier'
    : result?.status === 'complete' ? 'Demande de suppression terminée'
      : needsSupport ? 'Fermeture à examiner avec notre équipe'
      : result?.status === 'paused' && resultMode === 'pause' ? 'Nouvelles opérations suspendues'
        : 'Suppression à poursuivre';

  return (
    <View style={styles.container}>
      <ScreenHeader title="Fermer mon compte" onBack={() => router.back()} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.infoList}>
            <Text variant="h2">Suppression avec suivi</Text>
            <Caption>Vous pouvez lancer une demande et suivre son traitement dans l’application. Une pause ou un examen d’engagements existants ne vous empêche pas de demander cet effacement.</Caption>
            <Button variant="danger" disabled={loading} onPress={() => startMode('delete')}>Demander la suppression avec suivi</Button>
          </View>
          {journalIsCurrent && (result || unknownResult || needsSupport) && (
            <View style={styles.infoList} accessibilityRole="alert">
              <Text variant="h2">{statusTitle}</Text>
              <Caption>
                {needsSupport ? 'Une intervention de notre équipe est nécessaire pour examiner la conservation des données et les engagements existants. La demande de suppression n’est pas terminée.'
                  : unknownResult ? 'Le résultat de cette demande reste indéterminé. Si la vérification n’est plus possible, contactez notre équipe pour vos engagements existants.'
                  : result?.status === 'complete' ? 'Le serveur confirme la fin de cette demande. Certaines informations liées aux obligations et recours restent conservées.'
                    : result?.status === 'paused' && resultMode === 'pause'
                      ? 'La pause est enregistrée. Votre compte reste accessible pour suivre les engagements existants.'
                      : 'Votre compte reste accessible pour suivre les engagements existants. La suppression n’est pas terminée.'}
              </Caption>
              {result?.newOperationsBlocked && result.status !== 'complete' && <Caption>Les nouvelles opérations commerciales sont suspendues.</Caption>}
              {privacyRetentionNeedsReview ? <Caption>Une demande d’accès ou de rectification impose encore un examen des données à conserver et des recours. Une réponse ou un retrait de cette demande ne lève pas automatiquement leur conservation.</Caption> : null}
              {externalErasureNeedsReview ? <Caption>La suppression dans les services du compte doit être examinée avant toute nouvelle destruction. Cette réponse ne confirme aucune suppression de votre profil, de vos photos, de votre accès ou de vos informations de paiement.</Caption> : null}
              {result?.blockers?.some(blocker => blocker !== 'privacy_retention_review_required' && blocker !== 'external_erasure_retention_review_required') ? <Caption>D’autres opérations ou obligations restent à régler. Consultez aussi vos commandes, vos ventes et vos fonds.</Caption> : null}
              {smallBalanceNeedsReview && <Caption>Un solde inférieur au minimum de retrait reste sur votre compte. La fermeture ne peut pas l’abandonner. Contactez notre équipe pour faire examiner sa restitution ; aucune nouvelle vente ne vous est demandée pour cet examen.</Caption>}
              {result?.smallBalanceSettlement ? <><Caption>Une restitution du petit solde intégral de {(result.smallBalanceSettlement.amountCents / 100).toFixed(2)} $ CA peut être examinée sur votre compte bancaire actuel. La fermeture et les autres obligations restent distinctes ; aucune suppression n’est autorisée par cette lecture.</Caption>
                <Button variant="secondary" disabled={loading || unknownResult} onPress={() => {try {const captured = captureContext(); assertContext(captured); router.push({pathname: '/wallet', params: {closureSettlement: 'review'}} as never);} catch {/* Current SDK closure frame only. */}}}>Examiner la restitution du petit solde</Button></> : null}
              {result?.incompleteParts?.length ? <Caption>Une partie de la fermeture nécessite encore un suivi. Contactez notre équipe si la reprise ne permet pas de terminer.</Caption> : null}
              {!needsSupport && !unknownResult && result?.status !== 'complete' && (
                <Button variant="secondary" disabled={loading} onPress={() => { setStep('confirm'); setConfirmText(''); setReauthDone(false); }}>Reprendre cette demande</Button>
              )}
              {!needsSupport && result?.status === 'paused' && resultMode === 'pause' && !unknownResult && (
                <Button variant="danger" disabled={loading} onPress={() => startMode('delete')}>Demander la suppression</Button>
              )}
            </View>
          )}
          {restoreError ? (
            <View style={styles.infoList}>
              <Caption>La demande conservée ne peut pas être relue. Réessayez avant d’envoyer une opération.</Caption>
              <Button variant="secondary" onPress={() => setRestoreVersion(value => value + 1)}>Relire la demande</Button>
            </View>
          ) : !journalIsCurrent ? <Caption>Chargement de votre demande…</Caption> : needsSupport ? null
            : !ownerReadReady ? (
              <View style={styles.infoList}>
                <Caption>{closureStatus.isError ? 'Le suivi de fermeture ne peut pas être chargé. Relisez-le ou contactez notre équipe.' : 'Chargement du suivi de fermeture…'}</Caption>
                {closureStatus.isError && <Button variant="secondary" onPress={() => closureStatus.refetch()}>Relire le suivi</Button>}
              </View>
            ) : step === 'info' ? (
            <View style={styles.stepContent}>
              <View style={styles.warningBox}>
                <Text variant="h2" style={styles.warningTitle}>Pause ou suppression</Text>
                <Caption style={styles.warningText}>La pause bloque les nouvelles opérations. La suppression traite les données du compte lorsqu’elle peut être terminée, sans effacer les obligations déjà engagées.</Caption>
              </View>
              <Label style={styles.sectionHeader}>Informations conservées si nécessaire</Label>
              <View style={styles.infoList}>
                <Caption>Les informations nécessaires aux transactions, aux fonds, aux litiges, à l’identification et aux demandes d’accès ou de rectification peuvent rester conservées. L’équipe doit examiner les motifs et la portée avant une suppression. Une réponse incomplète ne signifie pas que tout a été effacé.</Caption>
              </View>
              <View style={styles.actions}>
                <Button variant="secondary" fullWidth disabled={loading || unknownResult || !!result} onPress={() => startMode('pause')}>Mettre en pause les nouvelles opérations</Button>
                <Button variant="danger" fullWidth disabled={loading || unknownResult || result?.status === 'incomplete' || result?.status === 'complete'} onPress={() => startMode('delete')}>Demander la suppression du compte</Button>
              </View>
            </View>
          ) : (
            <View style={styles.stepContent}>
              <Text variant="h2" style={styles.confirmTitle}>{mode === 'pause' ? 'Confirmer la pause' : 'Confirmer la demande de suppression'}</Text>
              <Caption style={styles.confirmSubtitle}>{mode === 'pause' ? 'Les engagements existants restent à suivre.' : 'Une suppression complète ne peut pas être annulée.'}</Caption>
              <View style={styles.inputSection}>
                <Label style={styles.inputLabel}>Vérification de votre identité</Label>
                {isUnknownProvider ? <Caption>Votre méthode de connexion ne peut pas être vérifiée ici. Contactez notre équipe pour poursuivre.</Caption>
                  : isPasswordUser || (isAppleOnAndroid && hasPasswordProvider) ? (
                    <View style={styles.applePasswordSection}>
                      <TextInput style={styles.input} secureTextEntry value={password} onChangeText={setPassword} placeholder="Mot de passe actuel" placeholderTextColor={colors.muted} autoCapitalize="none" editable={!loading} />
                      {isAppleOnAndroid && <Button variant="secondary" loading={loading} disabled={!password} onPress={() => handleReauth(true)}>Vérifier mon identité</Button>}
                    </View>
                  ) : isAppleOnAndroid ? <Caption>La vérification Apple nécessite un appareil iOS ou un mot de passe déjà associé au compte. Contactez notre équipe si vous ne pouvez pas poursuivre.</Caption>
                    : <Button variant="secondary" fullWidth loading={loading} onPress={() => handleReauth()}>{reauthDone ? 'Vérifier à nouveau mon identité' : provider === 'google.com' ? 'Vérifier avec Google' : 'Vérifier avec Apple'}</Button>}
                {reauthDone && <Caption style={styles.reauthSuccessText}>Identité vérifiée. Une nouvelle vérification peut être nécessaire après quelques minutes.</Caption>}
              </View>
              <View style={styles.inputSection}>
                <Label style={styles.inputLabel}>Saisissez {confirmation} pour confirmer</Label>
                <TextInput style={styles.input} value={confirmText} onChangeText={setConfirmText} placeholder={confirmation} placeholderTextColor={colors.muted} autoCapitalize="characters" editable={!loading} />
              </View>
              <Button variant={mode === 'pause' ? 'secondary' : 'danger'} fullWidth loading={loading} disabled={!canSubmit} onPress={handleClosure}>
                {unknownResult ? 'Reprendre cette même demande' : mode === 'pause' ? 'Confirmer la pause' : 'Envoyer la demande de suppression'}
              </Button>
            </View>
          )}
          <View style={styles.actions}>
            {needsSupport && result?.authDeleted !== true ? <Button variant="secondary" disabled={loading} onPress={() => router.push({pathname: '/settings/support'} as never)}>Contacter l’équipe pour cet examen</Button> : null}
            {result?.authDeleted !== true && (
              <>
            <Button variant="muted" disabled={loading} onPress={() => router.push('/my-orders')}>Mes commandes</Button>
            <Button variant="muted" disabled={loading} onPress={() => router.push('/my-sales')}>Mes ventes</Button>
            <Button variant="muted" disabled={loading} onPress={() => router.push('/wallet')}>Mes fonds</Button>
            <Button variant="muted" disabled={loading} onPress={() => router.push('/settings/stripe-onboarding')}>Identité et coordonnées bancaires</Button>
              </>
            )}
            <Button variant="muted" onPress={() => router.push('/settings/help')} leftIcon={<Ionicons name="help-circle-outline" size={18} color={colors.foreground} />}>Aide et recours</Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  stepContent: {
    flex: 1,
  },
  warningBox: {
    backgroundColor: colors.dangerLight,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  warningIconContainer: {
    marginBottom: spacing.md,
  },
  warningTitle: {
    color: colors.danger,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  warningText: {
    textAlign: 'center',
    color: colors.foregroundSecondary,
  },
  sectionHeader: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  infoList: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  infoItemText: {
    flex: 1,
    color: colors.foreground,
  },
  rgpdBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.successLight,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  rgpdText: {
    flex: 1,
    color: colors.foreground,
  },
  actions: {
    gap: spacing.sm,
  },
  confirmHeader: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  confirmIconContainer: {
    marginBottom: spacing.md,
  },
  confirmTitle: {
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  confirmSubtitle: {
    color: colors.foregroundSecondary,
  },
  inputSection: {
    marginBottom: spacing.lg,
  },
  inputLabel: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  bold: {
    fontFamily: fonts.sansBold,
    color: colors.danger,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 16,
    fontFamily: fonts.sans,
    color: colors.foreground,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  reauthSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.successLight,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  reauthSuccessText: {
    color: colors.success,
    flex: 1,
  },
  unknownProviderBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.warningLight,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  unknownProviderText: {
    flex: 1,
    color: colors.foreground,
  },
  applePasswordSection: {
    gap: spacing.sm,
  },
  applePasswordHint: {
    color: colors.foregroundSecondary,
  },
  appleNoPasswordSection: {
    gap: spacing.sm,
  },
});
