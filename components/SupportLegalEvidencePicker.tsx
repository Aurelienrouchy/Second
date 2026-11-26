import {useLayoutEffect, useRef, useState} from 'react';
import {AppState, StyleSheet, Text, View} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {File} from 'expo-file-system';
import {Button} from '@/components/ui';
import {auth} from '@/config/firebaseConfig';
import {useShippingPurchaseContext} from '@/hooks/useShippingPurchaseContext';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {prepareImageForUpload} from '@/utils/imageUtils';
import {productReviewEncodeBytes} from '@/services/productReviewEvidenceService';
import {colors, spacing, typography} from '@/constants/theme';
/** The native picker host survives AppState transitions. Its result is only a
 * volatile prepared photo; a separate fresh-source instruction uploads it. */
export function SupportLegalEvidencePicker({uid, sourceKey, disabled, onPrepared}: {uid: string; sourceKey: string; disabled: boolean; onPrepared: (jpegBase64: string, owner: NonNullable<typeof auth.currentUser>) => void}) {
  const picker = useShippingPurchaseContext(`legal-picker:${sourceKey}`, uid), active = useLabelLifecycleContext(`legal-preparation:${sourceKey}`, uid);
  const latest = useRef({sourceKey, active, onPrepared}), lock = useRef<symbol | null>(null), waits = useRef(new Set<() => void>());
  const [state, setState] = useState({key: sourceKey, busy: false, notice: ''});
  useLayoutEffect(() => {latest.current = {sourceKey, active, onPrepared};});
  useLayoutEffect(() => {const pending = waits.current; return () => {for (const cancel of pending) cancel();};}, []);
  const run = async () => {
    if (disabled || lock.current || AppState.currentState !== 'active') return; let operation; try {operation = picker.start();} catch {return;} if (!operation) return;
    const ticket = Symbol(), owner = auth.currentUser; if (!owner) {picker.finish(operation); return;} lock.current = ticket; setState({key: sourceKey, busy: true, notice: ''}); let prepared: File | null = null;
    const guard = () => {picker.assertCurrent(operation); if (latest.current.sourceKey !== sourceKey || auth.currentUser !== owner) throw new Error('La connexion ou le dossier a changé.');};
    const returned = async () => {guard(); if (AppState.currentState !== 'active') await new Promise<void>((resolve, reject) => {
      const cleanup = () => {subscription.remove(); waits.current.delete(cancel);};
      const cancel = () => {cleanup(); reject(new Error('Le choix a été interrompu.'));};
      const subscription = AppState.addEventListener('change', state => {if (state === 'active') {cleanup(); resolve();}}); waits.current.add(cancel);
      if (AppState.currentState === 'active') {cleanup(); resolve();}
    }); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); guard();};
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(); await returned(); if (permission.status !== 'granted') throw new Error('Autorisez la photo choisie.');
      const selected = await ImagePicker.launchImageLibraryAsync({mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible}); await returned(); if (selected.canceled || !selected.assets[0]) return;
      const context = latest.current.active, frame = context.capture(), current = () => {guard(); context.assertCurrent(frame);};
      const uri = await prepareImageForUpload(selected.assets[0].uri, {maxDimension: 1200, quality: 0.75}); current(); prepared = new File(uri);
      if (!prepared.exists || prepared.size < 4 || prepared.size > 5 * 1024 * 1024) throw new Error('La photo préparée doit faire moins de 5 Mio.');
      const bytes = await prepared.bytes(); current(); if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error('Une photo JPEG préparée est requise.');
      latest.current.onPrepared(productReviewEncodeBytes(bytes), owner); current(); setState({key: sourceKey, busy: false, notice: 'Photo préparée en mémoire. Relisez le dossier puis confirmez son dépôt privé.'});
    } catch {try {guard(); setState({key: sourceKey, busy: false, notice: 'Le choix doit être repris avec votre connexion et le dossier actuels.'});} catch {/* No late photo adoption. */}}
    finally {try {if (prepared?.exists) prepared.delete();} catch {/* A local cache cleanup never blocks the native operation lock. */} picker.finish(operation); if (lock.current === ticket) lock.current = null; if (picker.isCurrent(operation)) setState(old => old.key === sourceKey ? {...old, busy: false} : old);}
  };
  const current = state.key === sourceKey ? state : null;
  return <View style={styles.section}><Button variant="secondary" disabled={disabled || current?.busy || !active.focused} onPress={() => {void run();}}>Choisir une photo pour ce dossier privé</Button>{current?.notice && active.focused ? <Text style={styles.caption}>{current.notice}</Text> : null}</View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, caption: {...typography.caption, color: colors.muted}});
