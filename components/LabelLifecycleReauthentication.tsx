import { useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui';
import { auth } from '@/config/firebaseConfig';
import { colors, spacing, typography } from '@/constants/theme';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { AuthService } from '@/services/authService';
export function LabelLifecycleReauthentication({uid, sourceKey, disabled, onVerified}: {uid: string; sourceKey: string; disabled: boolean; onVerified: () => void}) {
  const sdkUid = useAuthenticatedUid(), frame = useLabelLifecycleContext(`label-lifecycle-reauth:${sourceKey}`, uid), lock = useRef(false);
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const provider = AuthService.getAuthProvider(), passwordAvailable = auth.currentUser?.uid === uid && auth.currentUser.providerData.some(v => v.providerId === 'password');
  const verify = async () => {
    if (lock.current || disabled || sdkUid !== uid) return; let op; try {op = frame.start();} catch {return;} if (!op) return;
    lock.current = true; setBusy(true); setNotice(null); const current = () => frame.assertCurrent(op);
    try {
      const recent = async () => {const user = auth.currentUser; if (user?.uid !== uid) throw new Error('La session a changé.'); const token = await user.getIdTokenResult(true); current();
        const time = token.claims.auth_time, now = Math.floor(Date.now() / 1000); return auth.currentUser === user && token.claims.admin === true && typeof time === 'number' && Number.isSafeInteger(time) && time > 0 && time <= now && now - time <= 300;};
      if (!await recent()) {
        if (provider === 'password' || passwordAvailable && (provider === 'unknown' || provider === 'apple.com' && Platform.OS !== 'ios')) {if (!password) throw new Error('Entrez votre mot de passe pour confirmer votre identité.'); await AuthService.reauthenticate(password, current);}
        else if (provider === 'google.com') await AuthService.reauthenticateWithGoogle(current);
        else if (provider === 'apple.com' && Platform.OS === 'ios') await AuthService.reauthenticateWithApple(current);
        else throw new Error('Reconnectez-vous puis relisez cette instruction.');
        current(); if (!await recent()) throw new Error('Une session opérateur récente est requise.');
      }
      current(); setNotice('Identité récente vérifiée. Le serveur requalifiera l’autorité avant chaque nouvel effet.'); onVerified();
    } catch (e) {if (frame.isCurrent(op)) setNotice(e instanceof Error ? e.message : 'La vérification doit être reprise.');}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op)) {setBusy(false); setPassword('');}}
  };
  if (sdkUid !== uid || !frame.focused) return null;
  return <View style={styles.section}><Text style={styles.caption}>Confirmez votre identité opérateur avant cette instruction de transport. Cette connexion ne prouve aucun dépôt, coût ou règlement.</Text>
    {provider === 'password' || passwordAvailable && (provider === 'unknown' || provider === 'apple.com' && Platform.OS !== 'ios') ? <TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!busy && !disabled} style={styles.input} accessibilityLabel="Mot de passe pour confirmer cette instruction" /> : null}
    <Button variant="secondary" disabled={busy || disabled} onPress={() => {void verify();}}>Confirmer mon identité opérateur</Button>
    {notice ? <Text accessibilityRole="alert" style={styles.caption}>{notice}</Text> : null}</View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
