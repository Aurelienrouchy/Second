import {useRef, useState} from 'react';
import {AppState, Platform, StyleSheet, Text, TextInput, View} from 'react-native';
import {Button} from '@/components/ui';
import {auth} from '@/config/firebaseConfig';
import {colors, spacing, typography} from '@/constants/theme';
import {useShippingPurchaseContext} from '@/hooks/useShippingPurchaseContext';
import {AuthService} from '@/services/authService';
import {getAuthSessionGeneration} from '@/store/authStore';

/** Mounted outside private projections: native OAuth may briefly make the app inactive. */
export function SellerTaxPrivateReauthentication({uid, sourceKey, active, onStart}: {
  uid: string; sourceKey: string; active: boolean; onStart: () => void;
}) {
  const context = useShippingPurchaseContext(`seller-tax-private-reauth:${sourceKey}`, uid), lock = useRef(false);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), sourceKey, context.focusRevision]);
  const [form, setForm] = useState({key, password: '', busy: false, notice: ''});
  const current = form.key === key ? form : {key, password: '', busy: false, notice: ''};
  const update = (patch: Partial<typeof form>) => setForm(previous => ({...(previous.key === key ? previous : {key, password: '', busy: false, notice: ''}), ...patch}));
  const provider = AuthService.getAuthProvider(), hasPassword = AuthService.hasPasswordProvider();
  const password = provider === 'password' || hasPassword && (provider === 'unknown' || provider === 'apple.com' && Platform.OS !== 'ios');
  const supported = password || provider === 'google.com' || provider === 'apple.com' && Platform.OS === 'ios';
  const verify = async () => {
    if (lock.current || !active || AppState.currentState !== 'active' || !supported) return;
    let op; try {op = context.start();} catch {return;} if (!op) return;
    lock.current = true; const guard = () => context.assertCurrent(op);
    update({busy: true, password: '', notice: ''});
    try {
      guard(); onStart(); guard();
      if (password) {if (!current.password) throw new Error('Entrez votre mot de passe pour confirmer votre identité.'); await AuthService.reauthenticate(current.password, guard);}
      else if (provider === 'google.com') await AuthService.reauthenticateWithGoogle(guard);
      else await AuthService.reauthenticateWithApple(guard);
      guard(); const owner = auth.currentUser;
      if (!owner || owner.uid !== uid) throw new Error('La session a changé.');
      const token = await owner.getIdTokenResult(true); guard();
      const t = token.claims.auth_time, now = Math.floor(Date.now() / 1000);
      if (auth.currentUser !== owner || typeof t !== 'number' || !Number.isSafeInteger(t) || t <= 0 || t > now || now - t > 300) throw new Error('La session récente doit être vérifiée.');
      update({notice: 'Identité confirmée. Revenez dans la page active, relisez explicitement le dossier fiscal puis vérifiez la disponibilité de la pièce. Aucun ancien accès n’est réautorisé par cette confirmation.'});
    } catch (error) {if (context.isCurrent(op)) update({notice: error instanceof Error ? error.message : 'La vérification doit être reprise.'});}
    finally {lock.current = false; context.finish(op); if (context.isCurrent(op)) update({busy: false, password: ''});}
  };
  if (!active || !context.focused || auth.currentUser?.uid !== uid) return null;
  return <View style={styles.section}>
    <Text style={styles.title}>Identité pour les pièces fiscales privées</Text>
    <Text style={styles.caption}>Si votre connexion récente ne peut pas être confirmée, utilisez un moyen déjà lié. Après la vérification, une nouvelle lecture explicite du dossier et de la pièce reste nécessaire.</Text>
    {password ? <TextInput style={styles.input} value={current.password} onChangeText={value => update({password: value})} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!current.busy}
      accessibilityLabel="Mot de passe pour les pièces fiscales privées"/> : null}
    {supported ? <Button variant="secondary" disabled={current.busy || password && !current.password} onPress={() => {void verify();}}>Confirmer mon identité pour les pièces privées</Button> : <Text style={styles.caption}>Reconnectez-vous avec un moyen déjà lié disponible sur cet appareil.</Text>}
    {current.notice ? <Text style={styles.caption} accessibilityRole="alert">{current.notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted},
  input: {...typography.bodySmall, color: colors.foreground, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: spacing.md}});
