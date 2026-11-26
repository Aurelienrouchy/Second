import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { readProductMaterialDraft, writeProductMaterialDraft, type ProductMaterialDraftRecord } from '@/services/productMaterialDraftService';
import { buildProductMaterialStatement, emptyProductMaterialStatementDraft } from '@/utils/productMaterialStatement';
import { ProductMaterialStatementFields } from './ProductMaterialStatementFields';
import { ProductMaterialComparison } from './ProductMaterialComparison';
import type { ProductMaterialSources, ProductMaterialStatement } from '@/types/productMaterialReview';
type Prepared = {statement: string; materialStatement: ProductMaterialStatement};
interface Frame {key: string; record: ProductMaterialDraftRecord; dirty: boolean; writeError: boolean}
export function ProductMaterialDraftForm({uid, transactionId, sourceKey, sourceHash, sources, enabled, onPrepared, actorRole}: {uid: string; transactionId: string;
  sourceKey: string; sourceHash: string; sources: ProductMaterialSources; enabled: boolean; onPrepared: (value: Prepared | null) => void; actorRole: 'buyer' | 'seller' | null}) {
  const navigation = useNavigation(), base = useShippingPurchaseContext(`product-material-draft:${transactionId}`, uid);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), transactionId, base.focusRevision]);
  const [frame, setFrame] = useState<Frame | null>(null), local = frame?.key === key ? frame : null;
  const [prepared, setPrepared] = useState<{key: string; value: Prepared; confirmed: boolean} | null>(null);
  const [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const allowLeave = useRef<string | null>(null), writeSequence = useRef(0);
  const draft = useQuery({queryKey: ['product-material-draft', key], enabled: base.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = base.capture(); return readProductMaterialDraft(uid, transactionId, () => base.assertCurrent(op));}});
  const ready = enabled && base.focused && draft.isSuccess && !draft.isFetching && !draft.isError;
  const record = local?.record ?? (ready ? draft.data : null) ?? {version: 1 as const, uid, transactionId, sourceHash, value: emptyProductMaterialStatementDraft()};
  const bound = ready && record.sourceHash === sourceHash, currentPrepared = bound && prepared?.key === sourceKey ? prepared : null;
  const edit = (next: ProductMaterialDraftRecord) => {
    if (!ready) return; let op; try {op = base.capture();} catch {return;}
    onPrepared(null); setPrepared(null); setNotice(null); const sequence = ++writeSequence.current;
    setFrame({key, record: next, dirty: true, writeError: false});
    void writeProductMaterialDraft(next, () => base.assertCurrent(op)).then(() => {
      if (base.isCurrent(op) && writeSequence.current === sequence) setFrame(old => old?.key === key ? {...old, writeError: false} : old);
    }).catch(() => {if (base.isCurrent(op) && writeSequence.current === sequence) setFrame(old => old?.key === key ? {...old, writeError: true} : old);});
  };
  useEffect(() => navigation.addListener('beforeRemove', event => {
    if (allowLeave.current === key || !local?.dirty || !base.focused) return;
    event.preventDefault(); Alert.alert('Quitter la déclaration ?', 'Votre brouillon sera conservé pour ce compte et cette commande. Une intention déjà envoyée reste conservée séparément avec ses références d’origine.',
      [{text: 'Rester', style: 'cancel'}, {text: 'Quitter et conserver', onPress: async () => {
        let op; try {op = base.capture(); await writeProductMaterialDraft(local.record, () => base.assertCurrent(op!)); base.assertCurrent(op);
          allowLeave.current = key; navigation.dispatch(event.data.action);
        } catch {if (!op || base.isCurrent(op)) setNotice({key, text: 'Le brouillon n’a pas pu être conservé. Réessayez avant de quitter.'});}
      }}]);
  }), [navigation, local, base, key]);
  useEffect(() => {if (!bound) onPrepared(null);}, [bound, sourceKey, onPrepared]);
  return <View style={styles.section}>
    {!ready ? <Text accessibilityRole="alert" style={styles.caption}>{draft.isError ? 'Le brouillon ne peut pas être qualifié. Relisez-le avant de le remplacer ou d’enregistrer une déclaration.' : 'Lecture du brouillon privé de cette commande…'}</Text> : <>
      {!bound ? <><Text style={styles.caption}>Ce brouillon est lié à une autre lecture des sources. Son récit est conservé ; aucune confirmation ne reprend automatiquement les nouvelles sources.</Text>
        <Button variant="secondary" onPress={() => edit({...record, sourceHash})}>Relier explicitement ce brouillon aux sources actuellement examinées</Button></> : null}
      <ProductMaterialStatementFields value={record.value} disabled={!bound} actorRole={actorRole} onChange={value => edit({...record, value})} />
      {local?.writeError ? <><Text accessibilityRole="alert" style={styles.caption}>Le brouillon visible n’est pas encore conservé. Aucune confirmation n’est disponible jusqu’à sa récupération.</Text>
        <Button variant="secondary" onPress={() => edit(record)}>Réessayer de conserver ce même brouillon</Button></> : null}
      <Button variant="secondary" disabled={!bound || !!local?.writeError} onPress={() => {
        try {base.capture(); const value = buildProductMaterialStatement(record.value); setPrepared({key: sourceKey, value, confirmed: false}); setNotice(null); onPrepared(null);}
        catch (error) {setPrepared(null); onPrepared(null); setNotice({key, text: error instanceof Error ? error.message : 'Les déclarations doivent être complétées.'});}
      }}>Examiner les déclarations préparées</Button>
      {currentPrepared ? <>
        <Text selectable style={styles.body}>{currentPrepared.value.statement}</Text>
        <ProductMaterialComparison sources={sources} statement={currentPrepared.value.materialStatement} statementState="draft" />
        <Checkbox checked={currentPrepared.confirmed} disabled={!!local?.writeError} onToggle={() => {
          const confirmed = !currentPrepared.confirmed; setPrepared({...currentPrepared, confirmed}); onPrepared(confirmed ? currentPrepared.value : null);
        }}><Text style={styles.caption}>Je confirme ce qui est déclaré dans cet aperçu, y compris les informations inconnues, les unités et les précisions de dates. Cela ne certifie pas un défaut ou la responsabilité d’une partie.</Text></Checkbox>
      </> : null}
      <Text style={styles.caption}>Décrivez les différences observées. Les photos ne permettent pas de confirmer une odeur, une matière ou la responsabilité d’une partie. Un défaut annoncé reste examinable.</Text>
    </>}
    <Button variant="ghost" disabled={!base.focused || draft.isFetching || !!local?.dirty} onPress={() => {onPrepared(null); setPrepared(null); void draft.refetch();}}>Relire le brouillon conservé</Button>
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
