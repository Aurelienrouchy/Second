import { useRef, useState } from 'react';
import { Alert, AppState, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, ScreenHeader } from '@/components/ui';
import { useAuthenticatedUid, useUser } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { auth } from '@/config/firebaseConfig';
import { getAuthSessionGeneration } from '@/store/authStore';
import { AccountSecurityService, AccountSecurityRecoveryService } from '@/services/accountSecurityService';
import { AuthService } from '@/services/authService';
import { ACCOUNT_SECURITY_STATEMENT, ACCOUNT_SECURITY_RECOVERY_STATEMENT } from '@/types/accountSecurity';
import type { AccountSecurityObservation, AccountSecurityRecoveryObservation } from '@/types/accountSecurity';
import { colors, radius, spacing, typography } from '@/constants/theme';

type Action = 'submit' | 'observe' | 'resume' | 'neutralize' | 'acknowledge';
type RecoveryAction = 'read' | 'submit' | 'resume' | 'neutralize' | 'acknowledge';
const date = (value: string) => new Date(value).toLocaleString('fr-CA');
const mediaCount = (value: number | null) => value === null ? 'inconnu' : String(value);
function privateSessionFailure(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error) ||
      !['unauthenticated', 'functions/unauthenticated'].includes(String(error.code)) || !('details' in error) ||
      !error.details || typeof error.details !== 'object' || !('action' in error.details) || error.details.action !== 'reauthenticate' ||
      !('reason' in error.details)) return null;
  if (error.details.reason === 'private_session_stale') return 'Confirmez à nouveau votre identité, puis relisez le dossier. Votre demande conservée n’est pas remplacée.';
  if (error.details.reason === 'private_session_unqualified') return 'La protection de cette session ne peut pas être qualifiée. Contactez l’équipe ; une nouvelle connexion ne garantit pas l’accès au dossier.';
  return null;
}

export default function AccountSecurityScreen() {
  const uid = useAuthenticatedUid(), user = useUser(), router = useRouter();
  const [readRevision, setReadRevision] = useState(0), [readsPaused, setReadsPaused] = useState(false);
  const context = useLabelLifecycleContext(`account-security:${readRevision}`, uid);
  // A native identity challenge may temporarily make the app inactive. Its
  // callback still belongs to the same SDK owner, generation and focused route.
  const reauthentication = useShippingPurchaseContext('account-security-reauthentication', uid);
  const queryClient = useQueryClient();
  const generation = getAuthSessionGeneration();
  const queryKey = ['account-security', uid, generation, context.focusRevision, readRevision];
  const authenticationKey = JSON.stringify([uid, generation, reauthentication.focusRevision]);
  const authenticationLock = useRef(false);
  const recoveryInteraction = useRef(0);
  const recoveryChoice = recoveryInteraction.current;
  const [authenticationForm, setAuthenticationForm] = useState({key: authenticationKey, passwordFrame: context.frame, password: '', pending: false, notice: ''});
  const authentication = authenticationForm.key === authenticationKey ? authenticationForm : {key: authenticationKey, passwordFrame: context.frame, password: '', pending: false, notice: ''};
  const password = authentication.passwordFrame === context.frame ? authentication.password : '';
  const provider = AuthService.getAuthProvider(), hasPassword = AuthService.hasPasswordProvider();
  const linkedGoogle = auth.currentUser?.providerData.some(item => item.providerId === 'google.com') === true;
  const linkedApple = auth.currentUser?.providerData.some(item => item.providerId === 'apple.com') === true && Platform.OS === 'ios';
  const usesPassword = provider === 'password' || hasPassword && (provider === 'unknown' || provider === 'apple.com' && Platform.OS !== 'ios');
  const canAuthenticate = usesPassword || provider === 'google.com' || provider === 'apple.com' && Platform.OS === 'ios';
  const [workingState, setWorkingState] = useState({frame: context.frame, focus: context.focusRevision, value: false});
  const working = workingState.frame === context.frame && workingState.focus === context.focusRevision && workingState.value;
  const setWorking = (value: boolean) => setWorkingState({frame: context.frame, focus: context.focusRevision, value});
  const [confirmation, setConfirmation] = useState({frame: context.frame, focus: context.focusRevision, value: false});
  const accepted = confirmation.frame === context.frame && confirmation.focus === context.focusRevision && confirmation.value;
  const [notice, setNotice] = useState({frame: context.frame, focus: context.focusRevision, text: ''});
  const query = useQuery({queryKey, enabled: !!uid && context.focused && !readsPaused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = context.capture(); return AccountSecurityService.read(operation.base.session.uid, () => context.assertCurrent(operation));}});
  const recoveryJournalKey = ['account-security-recovery-journal', uid, generation, context.focusRevision, readRevision];
  const recoverySourceKey = ['account-security-recovery-source', uid, generation, context.focusRevision, readRevision];
  const recoveryJournalQuery = useQuery({queryKey: recoveryJournalKey, enabled: !!uid && context.focused && !readsPaused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = context.capture(); return AccountSecurityRecoveryService.read(operation.base.session.uid, () => context.assertCurrent(operation));}});
  const recoverySourceQuery = useQuery({queryKey: recoverySourceKey, enabled: false, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const operation = context.capture(); return AccountSecurityRecoveryService.preview(operation.base.session.uid, () => context.assertCurrent(operation));}});
  const ownerFrameCurrent = (() => {try {context.capture(); return true;} catch {return false;}})();
  const recoveryFrame = ownerFrameCurrent && !!uid && context.focused && !readsPaused && !authentication.pending;
  const recoveryJournal = recoveryFrame && recoveryJournalQuery.isSuccess && !recoveryJournalQuery.isFetching && !recoveryJournalQuery.isError &&
    queryClient.getQueryState(recoveryJournalKey)?.isInvalidated === false ? recoveryJournalQuery.data : null;
  const recoverySource = recoveryFrame && recoverySourceQuery.isSuccess && !recoverySourceQuery.isFetching && !recoverySourceQuery.isError &&
    queryClient.getQueryState(recoverySourceKey)?.isInvalidated === false ? recoverySourceQuery.data : null;
  const [recoveryConfirmation, setRecoveryConfirmation] = useState({frame: context.frame, focus: context.focusRevision, sourceHash: '', sourceReadAt: 0, value: false});
  const recoveryAccepted = recoveryConfirmation.frame === context.frame && recoveryConfirmation.focus === context.focusRevision &&
    recoveryConfirmation.sourceHash === recoverySource?.sourceHash && recoveryConfirmation.sourceReadAt === recoverySourceQuery.dataUpdatedAt && recoveryConfirmation.value;
  const ready = ownerFrameCurrent && !!uid && context.focused && !readsPaused && !authentication.pending && query.isSuccess && !query.isFetching && !query.error;
  const observation = ready ? query.data : null;
  const journal = observation?.journal, receipt = observation?.receipt;
  const media = receipt?.mediaProtection;
  const recoveryAllowsNewReport = recoverySource?.canStartNewContainment === true &&
    (!journal || journal.acknowledged && !!receipt && ['contained', 'neutralized'].includes(receipt.state));
  const canSubmit = ready && (!receipt?.newEffectsBlocked && (!journal || journal.acknowledged && receipt?.state === 'neutralized') || recoveryAllowsNewReport);
  const canResume = !!journal && !journal.acknowledged && !!receipt &&
    (receipt.state === 'revocation_pending' || receipt.state === 'revocation_unknown' || receipt.state === 'unrecorded' && !receipt.newEffectsBlocked);

  const assertRecoverySource = (operation: ReturnType<typeof context.capture>) => {
    context.assertCurrent(operation);
    const current = queryClient.getQueryState(recoverySourceKey);
    if (recoveryInteraction.current !== recoveryChoice || !recoverySource || !current || current.status !== 'success' || current.fetchStatus !== 'idle' || current.isInvalidated || current.error !== null ||
      current.data !== recoverySourceQuery.data || current.dataUpdatedAt !== recoverySourceQuery.dataUpdatedAt) throw new Error('Relisez les conditions actuelles de reprise.');
  };
  const assertRecoveryJournal = (operation: ReturnType<typeof context.capture>) => {
    context.assertCurrent(operation);
    const current = queryClient.getQueryState(recoveryJournalKey);
    if (recoveryInteraction.current !== recoveryChoice || !recoveryJournal?.journal || !current || current.status !== 'success' || current.fetchStatus !== 'idle' || current.isInvalidated || current.error !== null ||
      current.data !== recoveryJournalQuery.data || current.dataUpdatedAt !== recoveryJournalQuery.dataUpdatedAt) throw new Error('Relisez le reçu de cette même reprise.');
  };
  const performRecovery = async (action: RecoveryAction) => {
    if (authenticationLock.current) return;
    let operation;
    try {operation = context.start();} catch {return;}
    if (!operation) return;
    if (action === 'read') recoveryInteraction.current++;
    const frameCurrent = () => context.assertCurrent(operation);
    setWorking(true);
    setRecoveryConfirmation({frame: context.frame, focus: context.focusRevision, sourceHash: '', sourceReadAt: 0, value: false});
    setConfirmation({frame: context.frame, focus: context.focusRevision, value: false});
    try {
      let result: AccountSecurityRecoveryObservation;
      if (action === 'read') {
        result = await AccountSecurityRecoveryService.read(operation.base.session.uid, frameCurrent);
        frameCurrent(); queryClient.setQueryData(recoveryJournalKey, result); setReadsPaused(false);
        // Own original receipts remain available even when current-source qualification fails.
        const source = await AccountSecurityRecoveryService.preview(operation.base.session.uid, frameCurrent);
        frameCurrent(); queryClient.setQueryData(recoverySourceKey, source); setReadsPaused(false);
      } else {
        const current = () => action === 'submit' ? assertRecoverySource(operation) : assertRecoveryJournal(operation);
        current();
        if (action === 'submit') {
          if (!recoverySource || !recoveryAccepted) throw new Error('Confirmez explicitement la déclaration de reprise après sa lecture actuelle.');
          result = await AccountSecurityRecoveryService.submit(operation.base.session.uid, recoverySource, recoveryAccepted, current);
        } else if (action === 'resume') result = await AccountSecurityRecoveryService.resume(operation.base.session.uid, current);
        else if (action === 'neutralize') result = await AccountSecurityRecoveryService.neutralize(operation.base.session.uid, current);
        else result = await AccountSecurityRecoveryService.acknowledge(operation.base.session.uid, current);
        frameCurrent(); queryClient.setQueryData(recoveryJournalKey, result);
        await queryClient.invalidateQueries({queryKey: recoverySourceKey, exact: true, refetchType: 'none'});
        frameCurrent();
      }
      setNotice({frame: context.frame, focus: context.focusRevision, text: action === 'acknowledge'
        ? 'Le reçu natif de reprise a été relu et reconnu. Chaque nouvelle opération reste soumise à ses propres vérifications.' : ''});
    } catch (error) {
      if (context.isCurrent(operation)) {
        setNotice({frame: context.frame, focus: context.focusRevision, text: privateSessionFailure(error) ?? (error instanceof Error ? error.message : 'La reprise reste inconnue. Relisez sa même référence.')});
        await queryClient.invalidateQueries({queryKey: recoverySourceKey, exact: true, refetchType: 'none'});
        if (context.isCurrent(operation)) await recoveryJournalQuery.refetch();
      }
    } finally {if (context.isCurrent(operation)) setWorking(false); context.finish(operation);}
  };

  const perform = async (action: Action) => {
    if (authenticationLock.current) return;
    let operation;
    try {operation = context.start();} catch {return;}
    if (!operation) return;
    setWorking(true);
    // A confirmation belongs to this explicit attempt, including a lost
    // response. It cannot silently confirm a later request after neutralization.
    if (action !== 'observe') setConfirmation({frame: context.frame, focus: context.focusRevision, value: false});
    const assertContext = () => {
      context.assertCurrent(operation);
      if (action === 'submit' && recoveryAllowsNewReport) assertRecoverySource(operation);
    };
    try {
      let result: AccountSecurityObservation;
      if (action === 'submit') result = await AccountSecurityService.submit(operation.base.session.uid, accepted, assertContext);
      else if (action === 'resume') result = await AccountSecurityService.resume(operation.base.session.uid, assertContext);
      else if (action === 'neutralize') result = await AccountSecurityService.neutralize(operation.base.session.uid, assertContext);
      else if (action === 'acknowledge') result = await AccountSecurityService.acknowledge(operation.base.session.uid, assertContext);
      else result = await AccountSecurityService.read(operation.base.session.uid, assertContext);
      assertContext(); queryClient.setQueryData(queryKey, result); setReadsPaused(false);
      if (action === 'submit' || action === 'resume') {
        recoveryInteraction.current++;
        await queryClient.invalidateQueries({queryKey: recoverySourceKey, exact: true, refetchType: 'none'});
        context.assertCurrent(operation);
      }
      setNotice({frame: context.frame, focus: context.focusRevision, text: action === 'acknowledge'
        ? 'Le reçu natif a été relu et reconnu. Sa référence reste conservée ; aucune autorisation commerciale ni levée de blocage n’a été accordée.' : ''});
    } catch (error) {
      if (context.isCurrent(operation)) {
        setNotice({frame: context.frame, focus: context.focusRevision, text: privateSessionFailure(error) ?? (error instanceof Error ? error.message : 'Le résultat reste inconnu. Relisez la même intention avant tout nouvel envoi.')});
        if (action === 'submit' || action === 'resume') {
          recoveryInteraction.current++;
          await queryClient.invalidateQueries({queryKey: recoverySourceKey, exact: true, refetchType: 'none'});
          if (!context.isCurrent(operation)) return;
        }
        await query.refetch();
      }
    } finally {if (context.isCurrent(operation)) setWorking(false); context.finish(operation);}
  };
  const authenticate = async (method: 'password' | 'google.com' | 'apple.com' = usesPassword ? 'password' : provider === 'google.com' ? 'google.com' : 'apple.com') => {
    if (authenticationLock.current || working || !context.focused || AppState.currentState !== 'active' ||
      !auth.currentUser?.providerData.some(item => item.providerId === method) || method === 'apple.com' && Platform.OS !== 'ios') return;
    let operation;
    try {operation = reauthentication.start();} catch {return;}
    if (!operation) return;
    authenticationLock.current = true;
    recoveryInteraction.current++;
    setAuthenticationForm({key: authenticationKey, passwordFrame: context.frame, password: '', pending: true, notice: ''});
    // Hide earlier observations before the credential challenge. No journal is
    // removed, and completing authentication never resends an instruction.
    setReadsPaused(true); setReadRevision(value => value + 1);
    const current = () => reauthentication.assertCurrent(operation);
    try {
      if (method === 'password') {
        if (!password) throw new Error('Entrez votre mot de passe pour confirmer votre identité.');
        await AuthService.reauthenticate(password, current);
      } else if (method === 'google.com') await AuthService.reauthenticateWithGoogle(current);
      else await AuthService.reauthenticateWithApple(current);
      current();
      const owner = auth.currentUser;
      if (owner?.uid !== uid) throw new Error('La session a changé.');
      const token = await owner.getIdTokenResult(true); current();
      const authenticatedAt = token.claims.auth_time;
      if (auth.currentUser !== owner || typeof authenticatedAt !== 'number' || !Number.isSafeInteger(authenticatedAt) || authenticatedAt <= 0) {
        throw new Error('La session authentifiée ne peut pas être confirmée. Relisez le dossier ou contactez l’équipe.');
      }
      setAuthenticationForm({key: authenticationKey, passwordFrame: context.frame, password: '', pending: false,
        notice: 'Authentification effectuée. Relisez explicitement le résultat serveur et les conditions de reprise. Le serveur vérifiera cette session ; aucune levée du blocage n’est déduite de cette authentification.'});
    } catch (error) {
      if (reauthentication.isCurrent(operation)) setAuthenticationForm({key: authenticationKey, passwordFrame: context.frame, password: '', pending: false,
        notice: error instanceof Error ? error.message : 'La vérification doit être reprise. Vos demandes conservées restent inchangées.'});
    } finally {authenticationLock.current = false; reauthentication.finish(operation);}
  };
  const neutralize = () => {
    let captured;
    try {captured = context.capture();} catch {return;}
    Alert.alert('Neutraliser cette intention ?', 'Cette action annule uniquement cette intention si elle n’a pas été exécutée. Elle ne lève aucun blocage du compte.', [
      {text: 'Conserver', style: 'cancel'},
      {text: 'Neutraliser l’intention', onPress: () => {if (context.isCurrent(captured)) void perform('neutralize');}},
    ]);
  };
  const navigate = (path: '/my-orders' | '/my-sales' | '/wallet' | '/settings/support') => {
    try {context.capture(); router.push(path as Href);} catch { /* A cached UID does not authorize private navigation. */ }
  };
  return <View style={styles.container}>
    <ScreenHeader title="Sécuriser mon compte" onBack={() => router.back()} />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.body}>Si vous soupçonnez une utilisation non autorisée, demandez le blocage des nouvelles opérations et la révocation des sessions. Une reprise exige une nouvelle authentification avec un moyen déjà lié et votre confirmation explicite, après vérification serveur.</Text>
      {uid && !user ? <Text style={styles.caption}>Votre session est authentifiée, mais votre profil est indisponible. La sécurisation et le suivi des opérations existantes restent accessibles.</Text> : null}
      {!uid ? <Text style={styles.body}>Connectez-vous au compte concerné. Si vous ne pouvez plus vous connecter, contactez l’équipe depuis le Centre d’aide.</Text> : null}
      {notice.frame === context.frame && notice.focus === context.focusRevision && notice.text ? <Text selectable style={styles.body}>{notice.text}</Text> : null}
      {!ready ? <Text style={styles.body}>{privateSessionFailure(query.error) ?? (readsPaused ? 'Le résultat actuel doit être relu après la vérification d’identité. Aucun ancien résultat n’est présenté comme une nouvelle lecture.' : query.isError ? 'Le journal ou le résultat serveur ne peut pas être confirmé actuellement. Une absence de réponse ne signifie ni absence de blocage ni échec de la révocation. Vos intentions conservées ne sont pas remplacées.' : 'Relecture du compte et de son intention conservée…')}</Text> : null}
      <Button variant="secondary" disabled={working || authentication.pending || !uid || !context.focused} onPress={() => {void perform('observe');}}>Relire le résultat serveur</Button>
      {uid ? <View style={styles.card}>
        <Text style={styles.title}>Confirmer à nouveau mon identité</Text>
        <Text style={styles.body}>Après une révocation, une nouvelle authentification peut être nécessaire pour consulter vos opérations et vos recours. Elle n’autorise pas de nouvelles opérations et ne rétablit pas le compte.</Text>
        {hasPassword ? <TextInput value={password} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" editable={!working && !authentication.pending && context.focused}
          onChangeText={value => {try {context.capture(); setAuthenticationForm({...authentication, passwordFrame: context.frame, password: value, notice: ''});} catch { /* An old view cannot retain a credential. */ }}}
          style={styles.input} accessibilityLabel="Mot de passe pour confirmer à nouveau votre identité" /> : null}
        {canAuthenticate ? <Button variant="secondary" disabled={working || authentication.pending || !context.focused || usesPassword && !password} onPress={() => {void authenticate();}}>{authentication.pending ? 'Vérification en cours…' : usesPassword ? 'Confirmer avec mon mot de passe' : provider === 'google.com' ? 'Confirmer avec Google' : 'Confirmer avec Apple'}</Button>
          : <Text style={styles.caption}>Utilisez un appareil où votre méthode de connexion est disponible, ou contactez l’équipe depuis le Centre d’aide. Vos références conservées ne sont pas effacées.</Text>}
        {linkedGoogle && (provider !== 'google.com' || usesPassword) ? <Button variant="secondary" disabled={working || authentication.pending || !context.focused} onPress={() => {void authenticate('google.com');}}>Confirmer avec Google</Button> : null}
        {linkedApple && (provider !== 'apple.com' || usesPassword) ? <Button variant="secondary" disabled={working || authentication.pending || !context.focused} onPress={() => {void authenticate('apple.com');}}>Confirmer avec Apple</Button> : null}
        {hasPassword && !usesPassword ? <Button variant="secondary" disabled={working || authentication.pending || !context.focused || !password} onPress={() => {void authenticate('password');}}>Confirmer avec mon mot de passe</Button> : null}
        {linkedGoogle || linkedApple || hasPassword ? <Text style={styles.caption}>Ces méthodes sont liées au compte actuellement connecté. Le serveur vérifie séparément si le moyen utilisé était déjà présent lors du signalement.</Text> : null}
        {authentication.notice ? <Text accessibilityRole="alert" style={styles.caption}>{authentication.notice}</Text> : null}
      </View> : null}
      {receipt ? <View style={styles.card}>
        <Text style={styles.title}>Blocage des nouvelles opérations</Text>
        <Text style={styles.body}>{receipt.newEffectsBlocked ? 'Ce reçu de sécurisation indique que les nouvelles opérations ont été bloquées. Consultez séparément la situation actuelle de reprise. Les commandes, le portefeuille et les recours historiques restent accessibles.' : 'Aucun blocage de sécurisation n’est observé par ce reçu. Ce résultat n’accorde aucune permission de nouvelle opération.'}</Text>
        {!observation?.linkedToLocalIntent ? <Text style={styles.caption}>Cette lecture n’est reliée à aucune intention conservée sur cet appareil. Un blocage déjà présent n’est pas attribué à cette référence de consultation. Contactez l’équipe pour son suivi.</Text> : null}
        <Text style={styles.title}>Révocation des sessions</Text>
        <Text style={styles.body}>{!observation?.linkedToLocalIntent ? 'Sans intention liée, cette lecture ne qualifie pas le résultat d’une demande antérieure de révocation.'
          : receipt.state === 'contained' ? 'Le serveur a observé la révocation demandée. Cela ne certifie ni la fin d’une compromission ni l’invalidation immédiate de tous les jetons déjà émis.'
            : receipt.state === 'revocation_pending' ? 'La demande de révocation est enregistrée ; son résultat n’est pas encore observé.'
              : receipt.state === 'revocation_unknown' ? 'Le résultat de la révocation est inconnu. Le blocage des nouvelles opérations reste observé ; reprenez la même référence ou contactez l’équipe.'
                : receipt.state === 'neutralized' ? 'Cette intention a été neutralisée sans nouvelle exécution. Aucun blocage existant n’a été levé et aucune révocation n’est certifiée par ce reçu.'
                  : 'Aucun reçu natif de cette intention n’est visible lors de cette lecture. Le résultat reste inconnu ; un éventuel blocage déjà présent n’est pas attribué à cette demande.'}</Text>
        {observation?.linkedToLocalIntent && receipt.receivedAt ? <Text style={styles.caption}>Réception serveur : {date(receipt.receivedAt)}</Text> : null}
        {observation?.linkedToLocalIntent && receipt.authTokensValidAfter ? <Text style={styles.caption}>Seuil de révocation observé : {date(receipt.authTokensValidAfter)}</Text> : null}
      </View> : null}
      {receipt ? <View style={styles.card}>
        <Text style={styles.title}>Protection des photos</Text>
        <Text style={styles.body}>{!media || media.state === 'unknown' ? 'La progression de protection des photos reste inconnue dans cette lecture. Un ancien reçu sans information sur les photos ne prouve ni une absence de photos ni leur protection.'
          : media.state === 'pending' ? 'La protection des photos est en attente. Aucun résultat global de retrait des accès n’est confirmé.'
            : media.state === 'in_progress' ? 'Le traitement des références de photos est en cours. Relisez explicitement le résultat pour consulter sa progression.'
              : media.state === 'observed_for_scanned_references' ? 'Une observation de protection est disponible pour les références de photos parcourues. Les compteurs précisent les retraits d’accès observés ; toutes les copies possibles ne sont pas couvertes.'
                : media.state === 'review_required' ? 'Certaines références de photos nécessitent un examen. Leur protection complète n’est pas confirmée ; contactez l’équipe pour le suivi.'
                  : 'Aucune protection des photos n’a été demandée par cette intention selon le reçu natif. Cette indication ne signifie pas qu’aucune photo n’existe sur le compte.'}</Text>
        {media ? <>
          <Text style={styles.caption}>Références natives inspectées : {mediaCount(media.nativeReferencesInspected)} · Objets mis en traitement : {mediaCount(media.objectsQueued)}.</Text>
          <Text style={styles.caption}>Objets conservés en privé : {mediaCount(media.privatelyPreservedCount)} · Retraits d’accès observés : {mediaCount(media.observedRevokedCount)}.</Text>
          <Text style={styles.caption}>Couverture : {media.referenceCoverage === 'native_references_only' ? 'références natives uniquement' : 'inconnue'}. {media.scanReachedEnd ? 'La fin du parcours de ces références est observée.' : 'La fin du parcours de ces références n’est pas confirmée.'} Aucune couverture globale n’est certifiée.</Text>
          {media.cutoffAt ? <Text style={styles.caption}>Date de référence de la protection : {date(media.cutoffAt)}</Text> : null}
          {media.lastObservedAt ? <Text style={styles.caption}>Dernière observation des photos : {date(media.lastObservedAt)}</Text> : null}
        </> : null}
        <Text style={styles.caption}>Cette progression est distincte de la révocation des sessions de connexion. Elle ne prouve pas l’effacement des téléchargements, anciennes copies ou caches et n’accorde aucun nouvel accès aux photos ni aucune permission commerciale.</Text>
      </View> : null}
      {journal ? <View style={styles.card}>
        <Text style={styles.title}>Intention d’origine conservée</Text>
        <Text selectable style={styles.caption}>{journal.intent.requestId}</Text>
        <Text style={styles.body}>{journal.intent.statement}</Text>
        <Text style={styles.caption}>Cette référence identifie la même demande ; sa reprise conserve exactement la confirmation initiale.</Text>
        {canResume ? <Button disabled={working} onPress={() => {void perform('resume');}}>Reprendre cette même demande</Button> : null}
        {!journal.acknowledged && receipt?.state === 'unrecorded' ? <Button variant="secondary" disabled={working} onPress={neutralize}>Neutraliser cette intention non exécutée</Button> : null}
        {!journal.acknowledged && (receipt?.state === 'contained' || receipt?.state === 'neutralized') ? <Button variant="secondary" disabled={working} onPress={() => {void perform('acknowledge');}}>Reconnaître le reçu après relecture</Button> : null}
        {journal.acknowledged ? <Text style={styles.caption}>Reçu reconnu ; référence conservée pour les prochaines consultations.</Text> : null}
      </View> : null}
      {uid ? <View style={styles.card}>
        <Text style={styles.title}>Demander la reprise après sécurisation</Text>
        <Text style={styles.body}>Reconnectez-vous avec un moyen déjà lié à ce compte lors du signalement, puis relisez les conditions actuelles. Une actualisation de jeton ou un retour de Google ou Apple ne déclenche aucune reprise.</Text>
        <Button variant="secondary" disabled={working || authentication.pending || !context.focused} onPress={() => {void performRecovery('read');}}>Relire les conditions de reprise et mon reçu</Button>
        {!recoverySource ? <Text style={styles.caption}>Les conditions actuelles doivent être relues explicitement. Aucun ancien reçu de sécurisation ne suffit à rétablir le compte.</Text> :
          <Text style={styles.body}>{recoverySource.reason === 'ready' ? 'Le serveur qualifie la connexion actuelle pour présenter votre demande. Confirmez séparément la déclaration ci-dessous.'
            : recoverySource.reason === 'already_restored' ? 'La reprise de cet épisode est enregistrée côté serveur. Chaque nouvelle opération reste soumise aux vérifications actuelles et aux autres restrictions.'
              : recoverySource.reason === 'no_episode' ? 'Aucun épisode de sécurisation n’est observé par cette lecture. Ce résultat n’accorde aucune permission de nouvelle opération.'
                : recoverySource.reason === 'reauthentication_required' ? 'Une nouvelle authentification avec un moyen déjà lié est nécessaire. Confirmez votre identité ci-dessus, puis relisez ces conditions.'
                  : recoverySource.reason === 'linked_method_required' ? 'Cette connexion ne peut pas être reliée aux moyens présents au signalement. Utilisez un moyen déjà lié à ce compte ; aucun nouveau moyen ne remplace cette preuve.'
                    : recoverySource.reason === 'revocation_unknown' ? 'Le résultat de la révocation reste inconnu. Reprenez son intention d’origine ou contactez l’équipe avant une demande de reprise.'
                      : 'La preuve native de sécurisation ou des moyens liés ne peut pas être qualifiée. La reprise est indisponible ; contactez l’équipe pour le suivi.'}</Text>}
        {recoverySource?.canStartNewContainment ? <Text style={styles.caption}>Vous pouvez aussi demander une nouvelle sécurisation ci-dessous si vous soupçonnez une utilisation non autorisée. Cette demande ne nécessite pas de déclarer vos moyens de connexion déjà sécurisés et ne rétablit aucune nouvelle opération.</Text> : null}
        {recoverySource?.canRestore && recoveryJournal && (!recoveryJournal.journal || recoveryJournal.journal.acknowledged) ? <>
          <Checkbox checked={recoveryAccepted} disabled={working} accessibilityLabel={ACCOUNT_SECURITY_RECOVERY_STATEMENT}
            onToggle={() => {try {const operation = context.capture(); assertRecoverySource(operation); recoveryInteraction.current++; setRecoveryConfirmation({frame: context.frame,
              focus: context.focusRevision, sourceHash: recoverySource.sourceHash ?? '', sourceReadAt: recoverySourceQuery.dataUpdatedAt, value: !recoveryAccepted});} catch {/* Fresh native source only. */}}}>
            <Text style={styles.body}>{ACCOUNT_SECURITY_RECOVERY_STATEMENT}</Text>
          </Checkbox>
          <Button disabled={working || !recoveryAccepted} onPress={() => {void performRecovery('submit');}}>Confirmer ma demande de reprise</Button>
        </> : null}
        {recoveryJournal?.journal ? <>
          <Text style={styles.title}>Même demande de reprise conservée</Text>
          <Text selectable style={styles.caption}>{recoveryJournal.journal.intent.requestId}</Text>
          <Text style={styles.body}>{recoveryJournal.receipt?.state === 'restored' ? 'Le reçu natif enregistre la reprise de cet épisode. Il ne lève aucune autre restriction et ne certifie pas la fin d’une compromission.'
            : recoveryJournal.receipt?.state === 'neutralized' ? 'Cette intention de reprise a été neutralisée sans lever le blocage. Son ancien envoi ne peut plus l’exécuter.'
              : 'Aucun reçu terminal de cette intention n’est observé. Son résultat reste inconnu ; relisez ou reprenez la même référence.'}</Text>
          {recoveryJournal.receipt?.receivedAt ? <Text style={styles.caption}>Réception serveur : {date(recoveryJournal.receipt.receivedAt)}</Text> : null}
          {!recoveryJournal.journal.acknowledged && recoveryJournal.receipt?.state === 'unrecorded' ? <>
            <Button variant="secondary" disabled={working} onPress={() => {void performRecovery('resume');}}>Reprendre cette même demande de reprise</Button>
            <Button variant="secondary" disabled={working} onPress={() => {void performRecovery('neutralize');}}>Neutraliser cette intention de reprise non exécutée</Button>
          </> : null}
          {!recoveryJournal.journal.acknowledged && recoveryJournal.receipt && recoveryJournal.receipt.state !== 'unrecorded' ?
            <Button variant="secondary" disabled={working} onPress={() => {void performRecovery('acknowledge');}}>Reconnaître le reçu de reprise après relecture</Button> : null}
          {recoveryJournal.journal.acknowledged ? <Text style={styles.caption}>Reçu reconnu ; référence conservée.</Text> : null}
        </> : recoveryJournalQuery.isError ? <Text style={styles.caption}>Le journal de reprise ne peut pas être qualifié. Il reste conservé ; aucun nouvel envoi n’est autorisé.</Text> : null}
        <Text style={styles.caption}>Cette démarche ne certifie ni un changement de mot de passe chez Google ou Apple, ni la sécurisation complète du compte. Les contrôles d’âge, d’activité, de paiement et les autres restrictions restent applicables.</Text>
      </View> : null}
      {canSubmit ? <View style={styles.card}>
        <Text style={styles.title}>Demander la sécurisation de ce compte</Text>
        <Checkbox checked={accepted} disabled={working} onToggle={() => {try {context.capture(); recoveryInteraction.current++; setConfirmation({frame: context.frame, focus: context.focusRevision, value: !accepted});} catch { /* Stale owner session. */ }}}
          accessibilityLabel={ACCOUNT_SECURITY_STATEMENT}><Text style={styles.body}>{ACCOUNT_SECURITY_STATEMENT}</Text></Checkbox>
        <Button disabled={working || !accepted} onPress={() => {void perform('submit');}}>Bloquer les nouvelles opérations et demander la révocation</Button>
      </View> : null}
      <View style={styles.section}>
        <Text style={styles.title}>Suivre les opérations existantes</Text>
        <Button variant="secondary" disabled={!uid || !context.focused} onPress={() => navigate('/my-orders')}>Mes commandes</Button>
        <Button variant="secondary" disabled={!uid || !context.focused} onPress={() => navigate('/my-sales')}>Mes ventes</Button>
        <Button variant="secondary" disabled={!uid || !context.focused} onPress={() => navigate('/wallet')}>Mon portefeuille et son historique</Button>
        <Button variant="secondary" disabled={!uid || !context.focused} onPress={() => navigate('/settings/support')}>Contacter l’équipe et suivre mes demandes</Button>
        <Button variant="ghost" onPress={() => router.push('/settings/help')}>Centre d’aide</Button>
      </View>
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md, gap: spacing.md},
  card: {padding: spacing.md, gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md},
  section: {gap: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground},
  input: {...typography.bodySmall, color: colors.foreground, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md},
  caption: {...typography.caption, color: colors.muted}});
