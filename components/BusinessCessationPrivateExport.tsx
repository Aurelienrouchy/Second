import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import { Button } from '@/components/ui';
import { auth } from '@/config/firebaseConfig';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { BusinessCessationService as Service } from '@/services/businessCessationService';
import type { BusinessCessationExportTarget } from '@/types/businessCessation';

export function BusinessCessationPrivateExport({uid, target}: {uid: string; target: BusinessCessationExportTarget}) {
  const owner = auth.currentUser, key = JSON.stringify(target), context = useLabelLifecycleContext(`cessation-export:${key}`, uid), lock = useRef<symbol | null>(null);
  const [state, setState] = useState<{owner: typeof owner; key: string; activity: string; available: null | {contentHash: string; generation: string}; notice: string; busy: boolean} | null>(null);
  const current = context.focused && state?.owner === owner && state.key === key && state.activity === context.focusRevision ? state : null;
  const read = async (share: boolean) => {
    if (owner !== auth.currentUser || lock.current || share && !current?.available) return;
    let op; try {op = context.start();} catch {return;} if (!op) return;
    const token = Symbol(), available = current?.available; lock.current = token;
    const guard = () => {context.assertCurrent(op); if (auth.currentUser !== owner) throw new Error('La connexion Firebase a changé.');};
    const update = (patch: Partial<NonNullable<typeof state>>) => setState(old => ({...(old?.owner === owner && old.key === key && old.activity === context.focusRevision ? old : {owner, key, activity: context.focusRevision, available: null, notice: '', busy: false}), ...patch}));
    update({busy: true, notice: ''}); let path: string | null = null, cleanupFailed = false;
    try {
      guard(); const copy = await Service.export(uid, target, guard); guard(); const pin = {contentHash: copy.contentHash, generation: copy.generation};
      if (!share) {update({available: pin, notice: 'Le fichier JSON privé exact est disponible. Une action distincte permet d’ouvrir le partage ; aucun accès futur hors application n’est garanti.'}); return;}
      if (!available || pin.contentHash !== available.contentHash || pin.generation !== available.generation) throw new Error('Le fichier doit être qualifié à nouveau.');
      const possible = await Sharing.isAvailableAsync(); guard(); if (!possible || !FileSystem.cacheDirectory) throw new Error('Le partage de fichier est indisponible sur cet appareil.');
      path = `${FileSystem.cacheDirectory}seconde_continuite_${randomUUID()}.json`;
      await FileSystem.writeAsStringAsync(path, copy.bytesBase64, {encoding: FileSystem.EncodingType.Base64}); guard();
      const local = await FileSystem.readAsStringAsync(path, {encoding: FileSystem.EncodingType.Base64}); guard(); if (local !== copy.bytesBase64) throw new Error('Le fichier temporaire diffère de la copie vérifiée.');
      const fresh = await Service.export(uid, target, guard); guard(); if (fresh.contentHash !== pin.contentHash || fresh.generation !== pin.generation || fresh.bytesBase64 !== copy.bytesBase64) throw new Error('La génération du fichier a changé.');
      await Sharing.shareAsync(path, {mimeType: 'application/json', UTI: 'public.json', dialogTitle: target.kind === 'claim' ? 'Obtenir ma réclamation privée' : 'Obtenir cette page d’inventaire expurgée'}); guard();
      update({notice: 'Le dialogue de partage est revenu. Cela ne prouve ni sauvegarde, transmission, lecture ou résolution des obligations.'});
    } catch (error) {try {guard(); update({available: null, notice: error instanceof Error ? error.message : 'Le fichier reste à relire.'});} catch { /* No old file result crosses an identity/activity change. */ }}
    finally {
      if (path) {try {await FileSystem.deleteAsync(path, {idempotent: true});} catch {cleanupFailed = true;}}
      context.finish(op); if (lock.current === token) {lock.current = null; if (context.isCurrent(op) && auth.currentUser === owner) update({busy: false, ...(cleanupFailed ? {available: null, notice: 'La suppression du fichier temporaire n’a pas pu être confirmée sur cet appareil.'} : {})});}
    }
  };
  if (!context.focused || auth.currentUser !== owner || owner?.uid !== uid) return null;
  return <View style={styles.section}>
    <Button variant="secondary" disabled={!!current?.busy} onPress={() => {void read(false);}}>Vérifier ce fichier privé de continuité</Button>
    {current?.available ? <Button variant="secondary" disabled={current.busy} onPress={() => {void read(true);}}>Obtenir et partager ce fichier privé exact</Button> : null}
    {current?.notice ? <Text accessibilityRole="alert" style={styles.caption}>{current.notice}</Text> : null}
    <Text style={styles.caption}>Le fichier temporaire propre à cette lecture est supprimé après fermeture du partage. Les copies que vous enregistrez ailleurs restent sous votre contrôle.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, caption: {...typography.caption, color: colors.muted}});
