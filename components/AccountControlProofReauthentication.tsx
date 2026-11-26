import {useRef, useState} from 'react';
import {AppState, Platform, StyleSheet, Text, TextInput, View} from 'react-native';
import {Button} from '@/components/ui';
import {auth} from '@/config/firebaseConfig';
import {AuthService} from '@/services/authService';
import {useShippingPurchaseContext} from '@/hooks/useShippingPurchaseContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {colors, spacing, typography} from '@/constants/theme';
export function AccountControlProofReauthentication({uid, onStart}: {uid: string; onStart: () => void}) {
  const context = useShippingPurchaseContext('account-control-primary-reauthentication', uid), lock = useRef(false);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), context.focusRevision]);
  const [form, setForm] = useState({key, password: '', busy: false, notice: ''});
  const current = form.key === key ? form : {key, password: '', busy: false, notice: ''};
  const update = (patch: Partial<typeof form>) => setForm(previous => ({...(previous.key === key ? previous : {key, password: '', busy: false, notice: ''}), ...patch}));
  const provider = AuthService.getAuthProvider(), password = AuthService.hasPasswordProvider() && (provider === 'password' || provider === 'unknown' || provider === 'apple.com' && Platform.OS !== 'ios');
  const supported = password || provider === 'google.com' || provider === 'apple.com' && Platform.OS === 'ios';
  const verify = async () => {
    if (lock.current || !supported || AppState.currentState !== 'active') return;
    let op; try {op = context.start();} catch {return;} if (!op) return; lock.current = true;
    const guard = () => context.assertCurrent(op); update({busy: true, password: '', notice: ''});
    try {guard(); onStart(); guard();
      if (password) {if (!current.password) throw new Error('Entrez votre mot de passe actuel.'); await AuthService.reauthenticate(current.password, guard);}
      else if (provider === 'google.com') await AuthService.reauthenticateWithGoogle(guard);
      else await AuthService.reauthenticateWithApple(guard);
      guard(); const owner = auth.currentUser; if (!owner || owner.uid !== uid) throw new Error('La connexion primaire a changé.');
      await owner.getIdToken(true); guard(); update({notice: 'Authentification effectuée. Relisez explicitement l’étape actuelle avant un nouveau consentement. Aucune commande n’a été renvoyée.'});
    } catch (error) {if (context.isCurrent(op)) update({notice: error instanceof Error ? error.message : 'La vérification doit être reprise.'});}
    finally {lock.current = false; context.finish(op); if (context.isCurrent(op)) update({busy: false});}
  };
  if (!context.focused) return null;
  return <View style={styles.section}>
    <Text style={styles.caption}>Si la connexion récente est demandée, confirmez un moyen déjà lié à ce compte. Le compte A puis le compte B utilisent chacun leur propre connexion à Seconde, successivement.</Text>
    {password ? <TextInput style={styles.input} accessibilityLabel="Mot de passe pour le rapprochement de comptes" value={current.password} onChangeText={value => update({password: value})} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!current.busy}/> : null}
    {supported ? <Button variant="secondary" disabled={current.busy || password && !current.password} onPress={() => {void verify();}}>Confirmer ma connexion primaire actuelle</Button> : <Text style={styles.caption}>Reconnectez-vous avec une méthode déjà liée disponible sur cet appareil.</Text>}
    {current.notice ? <Text accessibilityRole="alert" style={styles.caption}>{current.notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border}});
