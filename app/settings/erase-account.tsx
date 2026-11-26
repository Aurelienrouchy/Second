import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {AppState, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, TextInput, View} from 'react-native';
import {useRouter} from 'expo-router';
import {useQuery} from '@tanstack/react-query';
import {auth} from '@/config/firebaseConfig';
import {colors, fonts, radius, spacing, typography} from '@/constants/theme';
import {Button, Caption, Label, ScreenHeader, Text} from '@/components/ui';
import {AccountErasureStatus} from '@/features/account';
import {useAccountErasureRecovery} from '@/hooks/useAccountErasureRecovery';
import {AccountErasureService} from '@/services/accountErasureService';
import {AccountErasureAppleWebService} from '@/services/accountErasureAppleWebService';
import {discardAppleErasureAuthorization} from '@/services/accountErasureAppleAuthorization';
import type {AppleErasureAuthorization} from '@/services/accountErasureAppleAuthorization';
import {AuthService} from '@/services/authService';
import {withNativeReauthentication} from '@/services/nativeReauthentication';
import {getAuthSessionGeneration, useAuthStore} from '@/store/authStore';
import {isAccountErasureAttempt} from '@/types/accountErasure';
import type {AccountErasureLocalAttempt} from '@/types/accountErasure';

interface IdentityProof {owner: NonNullable<typeof auth.currentUser>; generation: number; contextKey: string;
  intention: string; expiresAt: number}
interface ProofDisplay {generation: number; contextKey: string; intention: string; expiresAt: number; appleReady: boolean}
const intention = (attempt: AccountErasureLocalAttempt) => isAccountErasureAttempt(attempt) ? attempt.commandId : attempt.recoveryId;

/** An explicit request is separate from reauthentication and read-only status
 * restoration. Neither returning from Apple nor mounting this route sends an
 * erasure, resumption or capability rotation. */
export default function EraseAccountScreen() {
  const router = useRouter(), local = useAccountErasureRecovery(), attempt = local.attempt;
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [proofDisplay, setProofDisplay] = useState<ProofDisplay | null>(null);
  const [notice, setNotice] = useState<{contextKey: string; text: string} | null>(null);
  const [webWaiting, setWebWaiting] = useState<{ownerId: string; commandId: string} | null>(null);
  const busyRef = useRef(false), nativeRef = useRef(false), proof = useRef<IdentityProof | null>(null);
  const apple = useRef<AppleErasureAuthorization | null>(null), latest = useRef(local);
  useLayoutEffect(() => {latest.current = local;});
  const clearProof = () => {
    proof.current = null; discardAppleErasureAuthorization(apple.current); apple.current = null;
    setProofDisplay(null); setConfirmation('');
  };
  useEffect(() => {
    // A native challenge can cross AppState while its timed owner/navigation
    // guard remains valid. Its result is adopted only in a NEW active frame.
    if (!nativeRef.current) {clearProof(); setPassword('');}
  }, [local.contextKey]);
  useEffect(() => () => {proof.current = null; discardAppleErasureAuthorization(apple.current); apple.current = null;}, []);
  useEffect(() => {
    if (!proofDisplay) return;
    const timer = setTimeout(clearProof, Math.max(0, proofDisplay.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [proofDisplay]);
  const observation = useQuery({
    queryKey: ['account-erasure-owner-observation', attempt && intention(attempt), local.contextKey],
    queryFn: async () => {
      if (!attempt) throw new Error('Demande à relire.');
      const scope = local.capture();
      const result = isAccountErasureAttempt(attempt) ? await AccountErasureService.observe(attempt, scope.assertCurrent)
        : await AccountErasureService.observeRecovery(attempt, scope.assertCurrent);
      scope.assertCurrent(); return result;
    },
    enabled: local.ready && attempt?.phase === 'submitted' && !busy &&
      !(webWaiting?.ownerId === local.uid && isAccountErasureAttempt(attempt) && webWaiting.commandId === attempt.commandId),
    staleTime: 0, gcTime: 0, retry: false,
    refetchOnReconnect: false, refetchOnWindowFocus: false,
  });
  const currentAttempt = local.ready && attempt ? observation.data && observation.data.ownerId === local.uid ? observation.data : attempt : null;
  const receipt = currentAttempt && isAccountErasureAttempt(currentAttempt) ? currentAttempt.receipt : null;
  const owner = local.uid ? auth.currentUser : null;
  const linkedApple = !!owner?.providerData.some(provider => provider.providerId === 'apple.com');
  const linkedPassword = !!owner?.providerData.some(provider => provider.providerId === 'password');
  const linkedGoogle = !!owner?.providerData.some(provider => provider.providerId === 'google.com');
  const browserAuthorization = !!receipt?.appleAuthorizationRequired && Platform.OS === 'android' && linkedApple && linkedPassword;
  const awaitingWebRead = !!currentAttempt && isAccountErasureAttempt(currentAttempt) &&
    webWaiting?.ownerId === local.uid && webWaiting.commandId === currentAttempt.commandId;
  // Only nonsensitive display metadata is state. The event-time guard rereads
  // the actual owner-bound proof and consumes the provider ticket once.
  const verified = !!proofDisplay && !!currentAttempt && !!owner &&
    proofDisplay.generation === local.generation && proofDisplay.contextKey === local.contextKey &&
    proofDisplay.intention === intention(currentAttempt);
  const show = (text: string) => setNotice({contextKey: latest.current.contextKey, text});
  const primaryReauth = async (method: 'password' | 'google' | 'apple' | 'session', forApple = false) => {
    if (busyRef.current || !currentAttempt || !local.uid) return;
    const chosen = currentAttempt;
    let scope: ReturnType<typeof local.captureNativeOwner>;
    try {scope = local.captureNativeOwner();} catch {return;}
    busyRef.current = true; nativeRef.current = method === 'google' || method === 'apple'; setBusy(true); clearProof();
    try {
      if (method === 'password') await AuthService.reauthenticate(password, scope.assertCurrent);
      else if (method !== 'session') {
        const ticket = await withNativeReauthentication<void | AppleErasureAuthorization>(scope.uid, scope.assertNavigation, native => method === 'google'
          ? AuthService.reauthenticateWithGoogle(native.assertCurrent, native.waitForActive)
          : forApple && isAccountErasureAttempt(chosen)
            ? AuthService.reauthenticateWithAppleForErasure(chosen, scope.generation, native.assertCurrent, native.waitForActive)
            : AuthService.reauthenticateWithApple(native.assertCurrent, native.waitForActive));
        scope.assertNavigation(); if (ticket) apple.current = ticket;
      }
      scope.assertNavigation();
      const returned = latest.current.capture();
      const restored = await latest.current.refresh(); returned.assertCurrent();
      if (returned.owner !== scope.owner || returned.generation !== scope.generation || !returned.uid ||
          !restored.data || intention(restored.data) !== intention(chosen)) throw new Error('Session modifiée.');
      const token = await scope.owner.getIdTokenResult(true); returned.assertCurrent();
      const authTime = token.claims.auth_time;
      if (typeof authTime !== 'number' || authTime * 1000 > Date.now() + 60_000 || Date.now() - authTime * 1000 > 240_000) {
        throw new Error('Une connexion récente est nécessaire.');
      }
      proof.current = {owner: scope.owner, generation: returned.generation, contextKey: latest.current.contextKey,
        intention: intention(chosen), expiresAt: Math.min(Date.now() + (apple.current ? 100_000 : 180_000), authTime * 1000 + 240_000)};
      setProofDisplay({generation: returned.generation, contextKey: latest.current.contextKey,
        intention: intention(chosen), expiresAt: proof.current.expiresAt, appleReady: !!apple.current});
      setPassword(''); setConfirmation('');
      show(forApple ? 'Autorisation Apple obtenue. Confirmez explicitement son envoi pour cette demande.' : 'Identité vérifiée. Confirmez explicitement l’étape à envoyer.');
    } catch {
      clearProof();
      try {scope.assertNavigation(); if (AppState.currentState === 'active') show('L’identité ou l’autorisation n’est pas confirmée. Aucune étape de suppression n’a été envoyée. Une connexion récente avec le même compte est nécessaire.');} catch {/* Never display A's challenge result in B's session. */}
    } finally {nativeRef.current = false; busyRef.current = false; setBusy(false);}
  };
  const prepare = async (recovery: boolean) => {
    if (busyRef.current || !local.ready || !local.uid) return;
    let scope: ReturnType<typeof local.capture>;
    try {scope = local.capture();} catch {return;}
    busyRef.current = true; setBusy(true); clearProof();
    try {
      if (recovery) await AccountErasureService.prepareRecovery(local.uid, scope.assertCurrent);
      else await AccountErasureService.prepare(local.uid, scope.assertCurrent);
      scope.assertCurrent(); await latest.current.refresh();
    } catch {try {scope.assertCurrent(); show('La préparation sécurisée n’est pas confirmée. Aucune étape serveur n’a été envoyée.');} catch {/* Stale owner. */}}
    finally {busyRef.current = false; setBusy(false);}
  };
  const send = async (operation: 'request' | 'resume' | 'authorize_apple' | 'recover_owner') => {
    if (busyRef.current || !currentAttempt || !verified || confirmation !== (operation === 'recover_owner' ? 'REPRENDRE' : 'SUPPRIMER')) return;
    const chosen = currentAttempt, granted = proof.current;
    let scope: ReturnType<typeof local.capture>;
    try {scope = local.capture();} catch {clearProof(); return;}
    if (!granted || granted.expiresAt <= Date.now() || granted.owner !== scope.owner || granted.generation !== scope.generation ||
        granted.intention !== intention(chosen) || granted.contextKey !== local.contextKey) {clearProof(); return;}
    const ticket = apple.current; apple.current = null; proof.current = null;
    busyRef.current = true; setBusy(true); setPassword(''); setConfirmation(''); setProofDisplay(null);
    try {
      if (operation === 'recover_owner' && !isAccountErasureAttempt(chosen)) await AccountErasureService.recoverOwner(chosen, scope.assertCurrent);
      else if (isAccountErasureAttempt(chosen)) {
        if (operation === 'request') await AccountErasureService.request(chosen, scope.assertCurrent);
        else if (operation === 'resume') await AccountErasureService.resume(chosen, scope.assertCurrent);
        else if (operation === 'authorize_apple' && ticket) await AccountErasureService.authorizeApple(chosen, ticket, scope.assertCurrent);
        else throw new Error('Étape à relire.');
      } else throw new Error('Étape à relire.');
      scope.assertCurrent(); show('L’étape a reçu une réponse. Le suivi indique ce qui est confirmé et ce qui reste à terminer.');
      await latest.current.refresh();
    } catch {
      try {scope.assertCurrent(); show('Le résultat reste à vérifier. La même intention est conservée. Vérifiez son suivi avant de confirmer une nouvelle tentative.'); await latest.current.refresh();} catch {/* Auth may have disappeared; the global guest entry can observe the durable capability. */}
    } finally {discardAppleErasureAuthorization(ticket); busyRef.current = false; setBusy(false);}
  };
  const recovery = currentAttempt && !isAccountErasureAttempt(currentAttempt);
  const openAppleWeb = async () => {
    if (busyRef.current || !browserAuthorization || !verified || confirmation !== 'SUPPRIMER' ||
        !currentAttempt || !isAccountErasureAttempt(currentAttempt)) return;
    let scope: ReturnType<typeof local.capture>;
    try {scope = local.capture();} catch {clearProof(); return;}
    const granted = proof.current;
    if (!granted || granted.owner !== scope.owner || granted.generation !== scope.generation || granted.expiresAt <= Date.now() ||
        granted.contextKey !== local.contextKey || granted.intention !== currentAttempt.commandId) {clearProof(); return;}
    busyRef.current = true; setBusy(true); clearProof();
    try {
      const challenge = await AccountErasureAppleWebService.start(currentAttempt, scope.assertCurrent); scope.assertCurrent();
      setWebWaiting({ownerId: currentAttempt.ownerId, commandId: currentAttempt.commandId});
      // This URL contains only the short-lived Apple challenge, never the
      // account observation capability. Never save it in state or storage.
      await Linking.openURL(challenge.browserUrl);
      // Returning from a browser is no authorization receipt. Read the existing
      // order only through the user's explicit status action below.
    } catch {try {scope.assertCurrent(); show('L’autorisation Apple doit être vérifiée. Aucun nouveau compte ni nouvel ordre de suppression n’a été créé par cette ouverture.');} catch {/* Browser/AppState or owner changed. */}}
    finally {busyRef.current = false; setBusy(false);}
  };
  const leaveClosedAccount = async () => {
    if (busyRef.current || !receipt?.accountAccessClosed || !local.uid) return;
    let scope: ReturnType<typeof local.capture>;
    try {scope = local.capture();} catch {return;}
    busyRef.current = true; setBusy(true); clearProof();
    try {
      scope.assertCurrent();
      await useAuthStore.getState().signOut({skipRemoteFcmCleanup: true,
        expectedUid: local.uid, expectedGeneration: scope.generation});
      if (!auth.currentUser && useAuthStore.getState().authenticatedUid === null &&
          getAuthSessionGeneration() === scope.generation + 1) router.replace('/account-deletion' as never);
    } catch {try {scope.assertCurrent(); show('La déconnexion reste à vérifier. Le suivi sécurisé est conservé.');} catch {/* Never act over another account. */}}
    finally {busyRef.current = false; setBusy(false);}
  };
  const action = recovery ? 'recover_owner' : receipt?.appleAuthorizationRequired ? 'authorize_apple'
    : receipt ? 'resume' : 'request';
  const canSend = !!currentAttempt && !receipt?.deletionComplete && verified && !busy && !observation.isFetching &&
    confirmation === (recovery ? 'REPRENDRE' : 'SUPPRIMER') &&
    (action !== 'authorize_apple' || browserAuthorization || proofDisplay?.appleReady === true);
  return (
    <View style={styles.container} testID="account-erasure-owner-screen">
      <ScreenHeader title="Supprimer mon compte" onBack={() => router.back()} />
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text variant="h2">Demander et suivre la suppression</Text>
          <Caption>La demande lance un traitement suivi. Les données ordinaires sont effacées pendant ce traitement. Les engagements déjà conclus restent à finaliser ; seules les preuves nécessaires à une obligation ou à un recours identifié peuvent être conservées.</Caption>
          <Caption>La fermeture de l’accès au compte ne prouve pas la fin de l’effacement. Le suivi précise l’avancement et reste accessible sur cet appareil après déconnexion, pendant le traitement puis 30 jours après sa fin. L’utilisation d’un autre compte sur cet appareil ferme cet accès invité.</Caption>
          {notice?.contextKey === local.contextKey && <Caption accessibilityRole="alert">{notice.text}</Caption>}
          {!local.ready && !local.error && <Caption>Lecture du suivi sécurisé…</Caption>}
          {local.error && <><Caption>Le suivi local doit être relu avant toute étape.</Caption><Button variant="secondary" onPress={() => {void local.refresh();}}>Relire le suivi sécurisé</Button></>}
          {local.ready && !local.uid && <><Caption>La confirmation d’une étape exige le compte propriétaire. Le suivi reste en lecture seule.</Caption><Button onPress={() => router.replace('/account-deletion' as never)}>Ouvrir le suivi</Button></>}
          {local.ready && local.uid && !currentAttempt && <>
            <Button variant="danger" loading={busy} onPress={() => {void prepare(false);}}>Préparer ma demande de suppression</Button>
            <Button variant="secondary" disabled={busy} onPress={() => {void prepare(true);}}>Reprendre une demande lancée sur un autre appareil</Button>
          </>}
          {receipt && <AccountErasureStatus receipt={receipt} />}
          {receipt?.accountAccessClosed && local.uid && <Button variant="secondary" disabled={busy}
            onPress={() => {void leaveClosedAccount();}}>Me déconnecter et garder le suivi</Button>}
          {currentAttempt?.phase === 'submitted' && <Button variant="secondary" loading={observation.isFetching} disabled={busy}
            onPress={() => {clearProof(); void observation.refetch();}}>Vérifier le résultat de cette même demande</Button>}
          {awaitingWebRead && receipt?.appleAuthorizationRequired && <Caption>Après l’étape dans le navigateur, vérifiez ici le résultat de cette même demande. Le retour à l’application n’envoie aucune nouvelle étape.</Caption>}
          {observation.isError && local.ready && <Caption>Le serveur ne confirme pas encore un nouvel état. Aucun résultat inconnu n’est présenté comme une suppression terminée.</Caption>}
          {local.ready && local.uid && currentAttempt && !receipt?.deletionComplete && <>
            {recovery ? <Caption>Récupérer ce suivi retrouve la demande déjà créée pour ce même compte et remplace sa clé privée de suivi. Les anciens appareils ne pourront plus observer avec leur ancienne clé. Cette récupération ne crée aucune nouvelle suppression. Après vérification d’identité, saisissez REPRENDRE et confirmez la récupération.</Caption>
              : <Caption>{currentAttempt.phase === 'prepared' ? 'Votre intention est préparée sur cet appareil ; son envoi au serveur n’est pas confirmé.' : 'Une tentative est conservée. Vérifiez d’abord son suivi. Toute confirmation suivante utilise la même intention.'}</Caption>}
            {isAccountErasureAttempt(currentAttempt) && currentAttempt.phase === 'prepared' && <Button variant="secondary" disabled={busy}
              onPress={() => {void prepare(true);}}>Reprendre plutôt une demande déjà lancée</Button>}
            {linkedApple && <Caption>Apple est lié à ce compte. Un mot de passe ou une vérification Google ne révoque pas cette liaison. Une autorisation Apple fraîche sera demandée séparément si elle est nécessaire.</Caption>}
            {linkedApple && Platform.OS === 'android' && linkedPassword && <Caption>Si Apple doit être autorisé, confirmez votre identité avec votre mot de passe puis ouvrez l’étape Apple dans le navigateur. Choisissez le même compte Apple : cette autorisation concerne uniquement la demande déjà enregistrée et ne crée aucun nouveau compte.</Caption>}
            {linkedApple && Platform.OS !== 'ios' && !linkedPassword && <><Caption>Cette étape requiert le compte Apple déjà lié. Une autorisation Apple reste nécessaire ; une autre identité ne la remplace pas.</Caption>
              <Caption>Si vous disposez aussi d’un appareil iOS, ouvrez Seconde avec ce même compte, choisissez « Reprendre une demande lancée sur un autre appareil », puis confirmez la récupération du suivi. Vous pourrez ensuite autoriser Apple et envoyer explicitement cette autorisation pour la demande d’origine. Aucun code ni lien privé n’est à copier entre appareils ; la récupération remplace la clé de suivi de l’ancien appareil.</Caption></>}
            <Label>1. Vérifiez votre identité pour cette étape</Label>
            {linkedPassword && <><TextInput testID="erasure-password" style={styles.input} value={password} onChangeText={setPassword} secureTextEntry
              autoCapitalize="none" placeholder="Mot de passe actuel" placeholderTextColor={colors.muted} editable={!busy} />
              <Button variant="secondary" disabled={busy || !password} onPress={() => {void primaryReauth('password');}}>Vérifier avec mon mot de passe</Button></>}
            {linkedGoogle && <Button variant="secondary" disabled={busy} onPress={() => {void primaryReauth('google');}}>Vérifier avec Google</Button>}
            {linkedApple && Platform.OS === 'ios' && <Button variant="secondary" disabled={busy}
              onPress={() => {void primaryReauth('apple', !!receipt?.appleAuthorizationRequired);}}>{receipt?.appleAuthorizationRequired ? 'Obtenir une nouvelle autorisation Apple' : 'Vérifier avec Apple'}</Button>}
            {!linkedPassword && !linkedGoogle && (Platform.OS !== 'ios' || !linkedApple) && <Button variant="secondary" disabled={busy}
              onPress={() => {void primaryReauth('session');}}>Vérifier ma connexion récente</Button>}
            {verified && <Caption>Identité vérifiée pour cette intention. Aucune étape de suppression n’a été envoyée par cette vérification.</Caption>}
            <Label>2. Saisissez {recovery ? 'REPRENDRE' : 'SUPPRIMER'} pour confirmer l’étape</Label>
            <TextInput testID="erasure-confirmation" style={styles.input} value={confirmation} onChangeText={setConfirmation}
              autoCapitalize="characters" autoCorrect={false} placeholder={recovery ? 'REPRENDRE' : 'SUPPRIMER'} placeholderTextColor={colors.muted} editable={!busy && verified} />
            <Button variant={recovery ? 'secondary' : 'danger'} loading={busy} disabled={!canSend} onPress={() => {void (browserAuthorization ? openAppleWeb() : send(action));}}>
              {recovery ? 'Récupérer le suivi de ma demande existante' : browserAuthorization ? 'Autoriser Apple dans le navigateur' : action === 'authorize_apple' ? 'Envoyer cette autorisation Apple' : action === 'resume' ? 'Confirmer la reprise de cette même demande' : 'Envoyer ma demande de suppression'}
            </Button>
          </>}
          <Caption>Une réponse ou un point d’avancement est fourni dans les 30 jours. Une preuve privée minimale d’un accord local terminé peut rester conservée au plus trois ans. Les éléments d’un dossier réellement ouvert sont limités à ce dossier et réexaminés sous 30 jours. Les autres durées et exceptions figurent dans la politique.</Caption>
          <Button variant="muted" onPress={() => router.push('/legal/privacy-policy' as never)}>Politique de confidentialité</Button>
          <Caption>Pour exercer vos droits ou signaler une difficulté : privacy@seconde.app.</Caption>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background},
  content: {padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md},
  input: {backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md, fontSize: typography.body.fontSize,
    fontFamily: fonts.sans, color: colors.foreground, borderWidth: 1, borderColor: colors.border}});
