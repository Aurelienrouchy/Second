import { useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui';
import { auth } from '@/config/firebaseConfig';
import { colors, spacing, typography } from '@/constants/theme';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useProductParcelContext } from '@/hooks/useProductParcelContext';
import { AuthService } from '@/services/authService';

interface Props {uid: string; sourceKey: string; disabled: boolean; onVerified: () => void; onChallengeStart?: () => void; onChallengeEnd?: () => void; purpose?: 'financial' | 'commercial' | 'privacy' | 'moderation' | 'relationship' | 'tax' | 'account_review' | 'manual_restitution' | 'legal_review' | 'bank_review' | 'orphan_capture' | 'privacy_operations'; parcel?: boolean}
export function AdminFinancialReauthentication({uid, sourceKey, disabled, onVerified, onChallengeStart, onChallengeEnd, purpose = 'financial', parcel = false}: Props) {
  const nativeOrphan = purpose === 'orphan_capture', nativePrivacy = purpose === 'privacy_operations', nativePurpose = nativeOrphan || nativePrivacy;
  const activityGuarded = nativePurpose || parcel || purpose === 'privacy' || purpose === 'moderation' || purpose === 'relationship' || purpose === 'tax' || purpose === 'account_review' || (purpose === 'manual_restitution' || (purpose === 'legal_review' || purpose === 'bank_review'));
  // Tax uses this hook's SDK/focus context for the native challenge only.
  // Its caller keeps private projections separately fenced by AppState.
  const sdkUid = useAuthenticatedUid(), context = useProductParcelContext(`admin-financial-reauth:${sourceKey}`, uid, purpose !== 'tax' && purpose !== 'account_review' && purpose !== 'manual_restitution' && purpose !== 'legal_review' && purpose !== 'bank_review' && !nativePurpose && activityGuarded);
  const challenge = context;
  const inFlight = useRef(false);
  const key = activityGuarded ? JSON.stringify([uid, sourceKey, challenge.focusRevision]) : null;
  const [form, setForm] = useState<{key: string | null; password: string; busy: boolean; notice: string | null}>({key, password: '', busy: false, notice: null});
  const {password, busy, notice} = form.key === key ? form : {password: '', busy: false, notice: null};
  const update = (patch: Partial<Omit<typeof form, 'key'>>) => setForm(old => ({...(old.key === key ? old : {key, password: '', busy: false, notice: null}), ...patch}));
  const setPassword = (password: string) => update({password}), setBusy = (busy: boolean) => update({busy}), setNotice = (notice: string | null) => update({notice});
  const provider = AuthService.getAuthProvider();
  const passwordAvailable = auth.currentUser?.uid === uid && auth.currentUser.providerData.some(value => value.providerId === 'password');
  const verify = async () => {
    if (inFlight.current || disabled || sdkUid !== uid || (nativePurpose || purpose === 'tax' || purpose === 'account_review' || (purpose === 'manual_restitution' || (purpose === 'legal_review' || purpose === 'bank_review'))) && AppState.currentState !== 'active') return;
    let operation; try {operation = challenge.start();} catch {return;} if (!operation) return;
    inFlight.current = true; setBusy(true); setNotice(null);
    const assertCurrent = () => challenge.assertCurrent(operation!);
    try {
      assertCurrent();
      if (nativePurpose || purpose === 'tax' || purpose === 'account_review' || (purpose === 'manual_restitution' || (purpose === 'legal_review' || purpose === 'bank_review'))) {onChallengeStart?.(); assertCurrent();}
      const recent = async () => {
        const current = auth.currentUser; if (!current || current.uid !== uid) throw new Error('La session a changé.');
        const token = await current.getIdTokenResult(true); assertCurrent();
        const time = token.claims.auth_time, now = Math.floor(Date.now() / 1000);
        return auth.currentUser === current && token.claims.admin === true && typeof time === 'number' && Number.isSafeInteger(time) && time > 0 && time <= now && now - time <= 300;
      };
      if (!await recent()) {
        if (provider === 'password' || passwordAvailable && (provider === 'unknown' || provider === 'apple.com' && Platform.OS !== 'ios')) {
          if (!password) throw new Error('Entrez votre mot de passe pour confirmer à nouveau votre identité.');
          await AuthService.reauthenticate(password, assertCurrent);
        } else if (provider === 'google.com') await AuthService.reauthenticateWithGoogle(assertCurrent);
        else if (provider === 'apple.com' && Platform.OS === 'ios') await AuthService.reauthenticateWithApple(assertCurrent);
        else throw new Error('Reconnectez-vous avec un moyen de connexion disponible, puis relisez le dossier.');
        assertCurrent(); if (!await recent()) throw new Error('Votre identité doit être confirmée à nouveau avant cette instruction.');
      }
      assertCurrent(); setNotice(nativePrivacy ? 'Identité confirmée. Relisez les sources privées actuelles avant de préparer ou enregistrer cette opération. Une instruction enregistrée ne prouve pas l’effacement des données.' : nativeOrphan ? 'Identité confirmée. La capture, son attribution et les remboursements seront relus avant une instruction limitée au moyen de paiement d’origine. Aucune arrivée bancaire n’est déduite de cette connexion.' : purpose === 'bank_review' ? 'Identité confirmée. Relisez les sources bancaires et les pièces actuelles ; cette connexion ne prouve ni envoi au prestataire, résultat bancaire ou mouvement de fonds.' : purpose === 'legal_review' ? 'Identité confirmée. Relisez le dossier, les champs exacts et les pièces privées. Aucun pouvoir légal, mandat ou envoi externe n’est déduit de cette confirmation.' : purpose === 'manual_restitution' ? 'Identité confirmée. Relisez les sources et les preuves privées avant une attestation de virement manuel. Cette confirmation n’atteste ni un remboursement Stripe ni l’arrivée de l’argent chez le bénéficiaire.' : purpose === 'account_review' ? 'Identité confirmée. Relisez les sources et les pièces privées avec votre connexion actuelle avant de prendre une décision motivée.' : purpose === 'tax' ? 'Session récente vérifiée. Le serveur requalifiera votre habilitation avant l’acte fiscal documentaire.' : purpose === 'relationship' ? 'Session récente vérifiée. Le serveur requalifiera votre habilitation avant cet examen des liens entre comptes.' : purpose === 'moderation' ? 'Session récente vérifiée. Le serveur requalifiera votre habilitation avant de lire le message conservé dans ce dossier privé.' : purpose === 'privacy' ? 'Session récente vérifiée. Le serveur vérifiera encore votre habilitation avant cette action sur la demande de confidentialité.' : purpose === 'commercial' ? 'Session récente vérifiée. Le serveur la vérifiera encore avant l’instruction commerciale.' : 'Session récente vérifiée. Le serveur la vérifiera encore au moment de la confirmation financière.'); onVerified();
    } catch (error) {
      if (challenge.isCurrent(operation)) setNotice(error instanceof Error ? error.message : 'La vérification doit être reprise.');
    } finally {
      challenge.finish(operation); inFlight.current = false;
      if (challenge.isCurrent(operation)) {setPassword(''); setBusy(false); if (nativePurpose || purpose === 'tax' || purpose === 'account_review' || (purpose === 'manual_restitution' || (purpose === 'legal_review' || purpose === 'bank_review'))) onChallengeEnd?.();}
    }
  };
  if (sdkUid !== uid || !context.focused || (nativePurpose || purpose === 'tax' || purpose === 'account_review' || (purpose === 'manual_restitution' || (purpose === 'legal_review' || purpose === 'bank_review'))) && AppState.currentState !== 'active') return null;
  return <View style={styles.section}>
    <Text style={styles.caption}>{nativePrivacy ? 'Confirmez votre identité pour préparer ou enregistrer une opération sur les renseignements personnels. Une instruction enregistrée ne prouve pas l’effacement des données.' : nativeOrphan ? 'Confirmez votre identité pour examiner le remboursement de cette capture au seul moyen de paiement d’origine. Le serveur relira les sources et les tentatives ; cette connexion ne prouve aucun remboursement ou crédit bancaire.' : purpose === 'bank_review' ? 'Confirmez votre identité pour ce dossier bancaire privé. Les sources et les preuves seront relues ; cette connexion ne confirme aucun règlement, envoi au prestataire ou réception bancaire.' : purpose === 'legal_review' ? 'Confirmez votre identité avant cet examen privé limité. Les sources et les preuves seront relues ; votre connexion ne désigne aucun mandataire et ne prouve aucun envoi externe.' : purpose === 'manual_restitution' ? 'Confirmez votre identité avant cet acte de restitution manuelle. Les sources et les preuves devront être relues ; une attestation bancaire manuelle ne prouve pas le crédit du bénéficiaire et ne constitue pas un remboursement Stripe.' : purpose === 'account_review' ? 'Confirmez votre identité avant cet examen privé. Une nouvelle lecture des sources et des pièces sera requise ; cette confirmation ne prouve ni identité commune, pouvoir de représentation ou règlement financier.' : purpose === 'tax' ? 'Une confirmation récente de votre identité est requise pour cet acte fiscal documentaire. Elle ne certifie aucun fait fiscal, aucune inscription ni aucun dépôt officiel.' : purpose === 'relationship' ? 'Une confirmation récente de votre identité est requise pour cet examen privé. Elle ne confirme ni une identité commune, ni une fraude et n’accorde aucune confiscation ou autorisation financière.' : purpose === 'moderation' ? 'Une confirmation récente de votre identité est requise avant la lecture de cette preuve de modération. Elle ne certifie ni le récit du membre, ni une faute ou un paiement.' : purpose === 'privacy' ? 'Une confirmation récente de votre identité est requise pour cette demande de confidentialité. Elle ne certifie ni la recherche des données, ni une rectification ou une autorisation de suppression.' : purpose === 'commercial' ? 'Une confirmation récente de votre identité est requise pour examiner ou enregistrer cette instruction commerciale. Elle ne confirme ni le récit ni le contenu du produit.' : 'Une confirmation récente de votre identité est requise pour cette instruction financière. Cette vérification ne confirme pas le récit ni un mouvement de fonds.'}</Text>
    {provider === 'password' || passwordAvailable && (provider === 'unknown' || provider === 'apple.com' && Platform.OS !== 'ios') ?
      <TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!busy && !disabled}
        style={styles.input} placeholder="Mot de passe si une nouvelle connexion est requise" placeholderTextColor={colors.muted} accessibilityLabel="Mot de passe pour confirmer votre identité" /> : null}
    <Button variant="secondary" disabled={busy || disabled} onPress={() => {void verify();}}>Vérifier mon identité pour cette instruction</Button>
    {notice ? <Text accessibilityRole="alert" style={styles.caption}>{notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, caption: {...typography.caption, color: colors.muted},
  input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
