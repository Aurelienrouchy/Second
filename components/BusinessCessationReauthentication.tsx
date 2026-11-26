import { useLayoutEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui';
import { auth } from '@/config/firebaseConfig';
import { colors, spacing, typography } from '@/constants/theme';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { AuthService } from '@/services/authService';
import type { BusinessCessationAccess } from '@/types/businessCessation';

/** Core credential prompt shared by owner servicing and administrative inventory. */
export function BusinessCessationReauthentication({uid, access, sourceKey, disabled, onStart, onEnd, onVerified}: {
  uid: string; access: BusinessCessationAccess; sourceKey: string; disabled: boolean; onStart: () => void; onEnd: () => void; onVerified: () => void;
}) {
  const native = useShippingPurchaseContext(`business-cessation-reauth:${sourceKey}`, uid), owner = auth.currentUser;
  const key = JSON.stringify([uid, access, sourceKey, native.focusRevision]), lock = useRef<symbol | null>(null), identity = useRef({key, owner});
  const [form, setForm] = useState({key, owner, password: '', busy: false, notice: ''});
  const current = form.key === key && form.owner === owner ? form : {key, owner, password: '', busy: false, notice: ''};
  useLayoutEffect(() => {if (identity.current.key !== key || identity.current.owner !== owner) {identity.current = {key, owner}; lock.current = null;}}, [key, owner]);
  const update = (patch: Partial<typeof form>) => setForm(old => ({...(old.key === key && old.owner === owner ? old : {key, owner, password: '', busy: false, notice: ''}), ...patch}));
  const provider = AuthService.getAuthProvider(), hasPassword = owner?.uid === uid && owner.providerData.some(p => p.providerId === 'password');
  const password = provider === 'password' || hasPassword && (provider === 'unknown' || provider === 'apple.com' && Platform.OS !== 'ios');
  const verify = async () => {
    if (auth.currentUser !== owner || lock.current || disabled || AppState.currentState !== 'active') return;
    let op; try {op = native.start();} catch {return;} if (!op) return;
    const token = Symbol(); lock.current = token; update({busy: true, notice: ''});
    const guard = () => {native.assertCurrent(op); if (auth.currentUser !== owner) throw new Error('La connexion Firebase a changé.');};
    try {
      guard(); onStart(); guard();
      const recent = async () => {if (!owner || owner.uid !== uid) throw new Error('Session requise.'); const result = await owner.getIdTokenResult(true); guard();
        const t = result.claims.auth_time, now = Math.floor(Date.now() / 1000); return (access !== 'admin' || result.claims.admin === true) && typeof t === 'number' && Number.isSafeInteger(t) && t > 0 && t <= now && now - t <= 300;};
      if (!await recent()) {
        if (password) {if (!current.password) throw new Error('Entrez votre mot de passe pour confirmer votre identité.'); await AuthService.reauthenticate(current.password, guard);}
        else if (provider === 'google.com') await AuthService.reauthenticateWithGoogle(guard);
        else if (provider === 'apple.com' && Platform.OS === 'ios') await AuthService.reauthenticateWithApple(guard);
        else throw new Error('Reconnectez-vous avec un moyen Firebase déjà lié, puis relisez le dossier.');
        guard(); if (!await recent()) throw new Error('Une connexion récente et l’autorité actuelle sont requises.');
      }
      guard(); update({notice: 'Identité confirmée. Les sources actuelles restent à qualifier avant cette seule instruction. Aucun règlement, arrêt commercial ou effacement n’est accordé par cette connexion.'}); onVerified();
    } catch (error) {try {guard(); update({notice: error instanceof Error ? error.message : 'La vérification doit être reprise.'});} catch { /* No former-session projection. */ }}
    finally {native.finish(op); if (lock.current === token) {lock.current = null; if (native.isCurrent(op) && auth.currentUser === owner) {update({password: '', busy: false}); onEnd();}}}
  };
  if (!native.focused || auth.currentUser !== owner || owner?.uid !== uid || AppState.currentState !== 'active') return null;
  return <View style={styles.section}>
    <Text style={styles.caption}>Confirmez votre identité pour cette instruction de continuité. Le serveur vérifiera à nouveau votre autorité ; les obligations et les fonds ne sont pas réglés par cet examen.</Text>
    {password ? <TextInput secureTextEntry autoCapitalize="none" autoCorrect={false} style={styles.input} value={current.password} editable={!disabled && !current.busy} accessibilityLabel="Mot de passe pour le dossier de continuité" onChangeText={value => {if (auth.currentUser === owner) update({password: value});}} /> : null}
    <Button variant="secondary" disabled={disabled || current.busy} onPress={() => {void verify();}}>Confirmer mon identité pour cette instruction de continuité</Button>
    {current.notice ? <Text accessibilityRole="alert" style={styles.caption}>{current.notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: spacing.md}});
