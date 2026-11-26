import {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {randomUUID} from 'expo-crypto';
import {Button} from '@/components/ui';
import {auth} from '@/config/firebaseConfig';
import {colors, spacing, typography} from '@/constants/theme';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {SellerTaxService, sellerTaxEqual} from '@/services/sellerTaxService';
import type {SellerTaxDocumentReference, SellerTaxScope} from '@/types/sellerTax';

export function SellerTaxPrivateCopy({uid, scope, delivery, qualifySource, kind = 'annual_copy'}: {
  uid: string; scope: SellerTaxScope; delivery: SellerTaxDocumentReference; qualifySource: () => void; kind?: 'annual_copy' | 'credit_note';
}) {
  const context = useLabelLifecycleContext(`seller-tax-copy:${JSON.stringify([scope, delivery, kind])}`, uid), lock = useRef(false);
  const [state, setState] = useState<{frame: symbol; focus: string; busy: boolean; notice: string;
    available: null | {sourceVersionHash: string}}>({frame: context.frame, focus: context.focusRevision, busy: false, notice: '', available: null});
  const stamp = {frame: context.frame, focus: context.focusRevision}, active = state.frame === stamp.frame && state.focus === stamp.focus;
  const currentState = active ? state : {...stamp, busy: false, notice: '', available: null};
  const update = (patch: Partial<typeof state>) => setState(previous => ({...(previous.frame === stamp.frame && previous.focus === stamp.focus ? previous : {...stamp, busy: false, notice: '', available: null}), ...patch}));
  const credit = kind === 'credit_note';
  const read = async (share: boolean) => {
    if (lock.current || !context.focused || scope.access !== 'owner' || scope.ownerId !== uid || share && !currentState.available) return;
    let op; try {op = context.start();} catch {return;} if (!op) return;
    lock.current = true; const availability = currentState.available;
    const guard = () => {context.assertCurrent(op); qualifySource(); if (auth.currentUser?.uid !== uid) throw new Error('Session modifiée.');};
    update({busy: true, notice: ''}); let path: string | null = null, cleanupFailed = false;
    try {
      guard();
      const recent = async () => {
        const user = auth.currentUser; if (!user || user.uid !== uid) throw new Error('Session requise.');
        const token = await user.getIdTokenResult(true); guard();
        const t = token.claims.auth_time, now = Math.floor(Date.now() / 1000);
        return auth.currentUser === user && typeof t === 'number' && Number.isSafeInteger(t) && t > 0 && t <= now && now - t <= 300;
      };
      if (!await recent()) throw new Error('Confirmez à nouveau votre identité dans le formulaire des pièces privées, puis relisez le dossier avant cette pièce.');
      const fetch = () => credit ? SellerTaxService.privateCreditNote(uid, scope, delivery, guard) : SellerTaxService.privateCopy(uid, scope, delivery, guard);
      const copy = await fetch(); guard();
      if (copy.availability === 'unavailable') {update({available: null, notice: credit ? 'Aucun fichier individuel de note de crédit n’est enregistré pour cette ancienne preuve. Aucune note téléchargeable n’est créée par cette lecture.' : 'Aucun fichier individuel privé n’est enregistré pour cette preuve de remise. Il n’y a pas de copie à ouvrir dans cette lecture.'}); return;}
      const metadata = {sourceVersionHash: copy.sourceVersionHash};
      if (!share) {update({available: metadata, notice: credit ? 'Un fichier individuel privé de note de crédit est disponible. Son partage exige une action distincte ; sa validité légale n’est pas certifiée.' : 'Une copie individuelle privée est disponible. Le partage reste une action distincte ; sa lecture ou son enregistrement sur votre appareil n’est pas attesté.'}); return;}
      if (!availability || !sellerTaxEqual(metadata, availability) || !copy.file || !copy.dataBase64) throw new Error('La copie a changé. Vérifiez à nouveau sa disponibilité.');
      const possible = await Sharing.isAvailableAsync(); guard();
      if (!possible || !FileSystem.cacheDirectory) throw new Error('Le partage de fichier est indisponible sur cet appareil.');
      path = `${FileSystem.cacheDirectory}seconde_tax_copy_${randomUUID()}.${copy.file.contentType === 'application/pdf' ? 'pdf' : 'xml'}`;
      await FileSystem.writeAsStringAsync(path, copy.dataBase64, {encoding: FileSystem.EncodingType.Base64}); guard();
      // A fresh native read binds the exact documents and file again after cache I/O.
      const fresh = await fetch(); guard();
      if (fresh.availability !== 'available' || fresh.sourceVersionHash !== copy.sourceVersionHash || !sellerTaxEqual(fresh.file, copy.file) ||
          fresh.protocol !== copy.protocol) throw new Error('La pièce privée doit être relue.');
      await Sharing.shareAsync(path, {mimeType: copy.file.contentType, UTI: copy.file.contentType === 'application/pdf' ? 'com.adobe.pdf' : 'public.xml', dialogTitle: credit ? 'Partager ma note de crédit privée' : 'Partager ma copie fiscale privée'});
      guard(); update({notice: 'Le dialogue de partage est revenu. Cela ne confirme ni une copie enregistrée, ni sa remise ou sa lecture. Aucune déclaration d’accès n’a été enregistrée automatiquement.'});
    } catch (error) {
      try {guard(); update({available: null, notice: error instanceof Error ? error.message : 'La copie privée reste à relire.'});} catch {/* No private result is projected into another source/session. */}
    } finally {
      if (path) {try {await FileSystem.deleteAsync(path, {idempotent: true});} catch {cleanupFailed = true; /* Never log private paths or bytes. */}}
      lock.current = false; context.finish(op);
      if (context.isCurrent(op)) update({busy: false, ...cleanupFailed ? {available: null, notice: 'La suppression du fichier temporaire de cette demande n’a pas pu être confirmée sur cet appareil. Aucun enregistrement ou envoi de copie n’est attesté.'} : {}});
    }
  };
  if (!context.focused || auth.currentUser?.uid !== uid) return null;
  return <View style={styles.section}>
    <Text style={styles.caption}>{credit ? 'Note de crédit privée : un ancien enregistrement de preuve ne suffit pas à créer un fichier.' : 'Copie privée : une preuve de remise ne suffit pas à créer un fichier.'} La disponibilité, votre session récente et la pièce individuelle sont vérifiées avant tout partage. Aucun NAS ou autre renseignement fiscal ne doit être saisi ici.</Text>
    <Button variant="secondary" disabled={currentState.busy} onPress={() => {void read(false);}}>{credit ? 'Vérifier la disponibilité de ma note de crédit privée' : 'Vérifier la disponibilité de ma copie privée'}</Button>
    {currentState.available ? <Button variant="secondary" disabled={currentState.busy} onPress={() => {void read(true);}}>{credit ? 'Obtenir et partager cette note de crédit privée' : 'Obtenir et partager cette copie privée'}</Button> : null}
    {currentState.notice ? <Text style={styles.caption} accessibilityRole="alert">{currentState.notice}</Text> : null}
    <Text style={styles.caption}>La suppression du fichier temporaire propre à cette demande est tentée après la fermeture du partage. Les copies enregistrées ailleurs restent sous votre contrôle. La conformité légale du document n’est pas certifiée par cette lecture.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, caption: {...typography.caption, color: colors.muted}});
