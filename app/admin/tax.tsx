import {useRef, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useRouter} from 'expo-router';
import {useQuery} from '@tanstack/react-query';
import {Button, Input, ScreenHeader} from '@/components/ui';
import {SellerTaxDossierPanel} from '@/components/SellerTaxDossierPanel';
import {SellerTaxCommandJournal} from '@/components/SellerTaxCommandJournal';
import {AdminFinancialReauthentication, AdminSectionNav} from '@/features/admin';
import {SellerTaxService, sellerTaxEqual, sellerTaxId} from '@/services/sellerTaxService';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {useShippingPurchaseContext} from '@/hooks/useShippingPurchaseContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {colors, spacing, typography} from '@/constants/theme';

export default function AdminTaxScreen() {
  const uid = useAuthenticatedUid(), router = useRouter(), generation = getAuthSessionGeneration();
  const [subject, setSubject] = useState<'seller' | 'operator'>('seller'), [transactionId, setTransactionId] = useState(''), [partyRole, setPartyRole] = useState<'buyer' | 'seller'>('seller');
  const [yearText, setYearText] = useState(String(new Date().getUTCFullYear()));
  const [sourceChanged, setSourceChanged] = useState(false);
  const sequence = useRef(0);
  const [choice, setChoice] = useState<{year: number; subject: 'seller' | 'operator'; transactionId: string; partyRole: 'buyer' | 'seller'; sequence: number; readFocus: string} | null>(null);
  const [readsPaused, setReadsPaused] = useState(false), [pendingAuthenticationKey, setPendingAuthenticationKey] = useState<string | null>(null);
  const context = useLabelLifecycleContext(`admin-tax:${uid}:${generation}:${JSON.stringify(choice)}`, uid);
  const year = /^\d{4}$/.test(yearText) ? Number(yearText) : null, validYear = year !== null && year >= 2024 && year <= new Date().getUTCFullYear() + 1;
  const source = useQuery({queryKey: ['seller-tax-source-owner', uid, generation, choice, context.focusRevision],
    enabled: !!uid && context.focused && !readsPaused && choice?.subject === 'seller', staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = context.capture(); if (!uid || !choice || choice.subject !== 'seller') throw new Error('Source native à sélectionner.');
      return SellerTaxService.sourceOwner(uid, choice.transactionId, choice.partyRole, () => context.assertCurrent(op));}});
  const sourceReady = !!uid && context.focused && !readsPaused && !!choice && (choice.subject === 'operator' || source.isSuccess && !source.isFetching && !source.isError);
  const sourceHash = choice?.subject === 'seller' && sourceReady ? source.data?.sourceVersionHash ?? null : null;
  const challengeSourceKey = JSON.stringify([uid, generation, choice && {year: choice.year, subject: choice.subject, transactionId: choice.transactionId, partyRole: choice.partyRole}]);
  const challengeContext = useShippingPurchaseContext(`admin-tax-challenge:${challengeSourceKey}`, uid);
  const reauthenticationKey = JSON.stringify([challengeSourceKey, challengeContext.focusRevision]);
  const authenticationPending = pendingAuthenticationKey === reauthenticationKey;
  const [verification, setVerification] = useState<{key: string; sequence: number} | null>(null);
  const newCommandsEnabled = sourceReady && !authenticationPending && verification?.key === reauthenticationKey && !!choice && choice.sequence > verification.sequence && choice.readFocus === context.focusRevision;
  const ownerId = choice?.subject === 'operator' ? null : sourceReady ? source.data?.ownerId ?? null : null;
  const qualifySubject = async () => {
    const op = context.capture(); if (!uid || !choice || !newCommandsEnabled) throw new Error('Confirmez votre identité puis relisez explicitement la source actuelle.');
    if (choice.subject === 'operator') return;
    const expected = source.data, fresh = await SellerTaxService.sourceOwner(uid, choice.transactionId, choice.partyRole, () => context.assertCurrent(op)).catch(error => {
      if (context.isCurrent(op)) {setSourceChanged(true); setChoice(null); setVerification(null);} throw error;
    });
    context.assertCurrent(op); if (!expected || !sellerTaxEqual(expected, fresh)) {
      setSourceChanged(true); setChoice(null); setVerification(null);
      throw new Error('La partie native de cette commande a changé. Relisez-la.');
    }
  };
  return <View style={styles.container}>
    <ScreenHeader title="Dossiers fiscaux documentaires" onBack={() => router.back()}/><AdminSectionNav/>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.body}>Sélectionnez le dossier annuel de l’exploitant, ou une partie issue d’une commande native. Une saisie de UID ou un paramètre de navigation ne donne aucune autorité. Les pièces du coffre sont importées par références opaques ; aucun identifiant fiscal, nom, adresse, date de naissance ou note libre n’est recueilli ici.</Text>
      <Input label="Année fiscale administrative" value={yearText} onChangeText={setYearText} keyboardType="number-pad" maxLength={4}/>
      <Button variant={subject === 'operator' ? 'secondary' : 'ghost'} disabled={!context.focused} onPress={() => setSubject('operator')}>Dossier annuel de l’exploitant</Button>
      <Button variant={subject === 'seller' ? 'secondary' : 'ghost'} disabled={!context.focused} onPress={() => setSubject('seller')}>Partie native d’une commande</Button>
      {subject === 'seller' ? <>
        <Input label="Référence native de commande pour sélectionner la partie" value={transactionId} onChangeText={setTransactionId} maxLength={128} autoCapitalize="none"/>
        <Button variant={partyRole === 'seller' ? 'secondary' : 'ghost'} disabled={!context.focused} onPress={() => setPartyRole('seller')}>Vendeur natif</Button>
        <Button variant={partyRole === 'buyer' ? 'secondary' : 'ghost'} disabled={!context.focused} onPress={() => setPartyRole('buyer')}>Acheteur natif pour une note de crédit</Button>
      </> : null}
      <Button disabled={!uid || !context.focused || authenticationPending || !validYear || subject === 'seller' && !sellerTaxId(transactionId)} onPress={() => {
        try {context.capture(); if (validYear && year !== null) {setSourceChanged(false); setReadsPaused(false); setChoice({year, subject, transactionId, partyRole, sequence: ++sequence.current, readFocus: context.focusRevision});}} catch {/* Current SDK operator only. */}
      }}>Lire la sélection fiscale native</Button>
      {source.isError && choice?.subject === 'seller' ? <Text style={styles.body}>Cette partie ou vos droits actuels ne peuvent pas être confirmés. Aucun ancien propriétaire n’est affiché.</Text> : null}
      {sourceChanged && context.focused ? <Text style={styles.body}>La source native ou les droits actuels ne peuvent plus être confirmés. La sélection précédente est masquée ; relisez explicitement la source avant une nouvelle instruction.</Text> : null}
      {uid && choice ? <AdminFinancialReauthentication key={reauthenticationKey} uid={uid} sourceKey={reauthenticationKey} disabled={!context.focused || authenticationPending} purpose="tax"
        onChallengeStart={() => {setReadsPaused(true); setPendingAuthenticationKey(reauthenticationKey); setVerification(null);}}
        onChallengeEnd={() => setPendingAuthenticationKey(previous => previous === reauthenticationKey ? null : previous)} onVerified={() => setVerification({key: reauthenticationKey, sequence: choice.sequence})}/> : null}
      {readsPaused && context.focused ? <Text style={styles.caption}>Relisez explicitement la sélection fiscale native après la confirmation d’identité. Aucun ancien dossier ne redevient autorisé par le retour du challenge.</Text> : null}
      {uid && sourceReady && choice ? <>
        <Text style={styles.caption}>Année {choice.year} · {choice.subject === 'operator' ? 'exploitant distinct de tout UID de vendeur' : `partie ${choice.partyRole === 'buyer' ? 'acheteur' : 'vendeur'} native : ${ownerId}`}.</Text>
        <SellerTaxDossierPanel key={`${uid}:${generation}:${JSON.stringify(choice)}:${sourceHash}`} uid={uid}
          scope={{access: 'admin', subject: choice.subject, ownerId, year: choice.year}} newCommandsEnabled={newCommandsEnabled}
          qualifySubject={qualifySubject} sourceId={choice.subject === 'seller' ? choice.transactionId : undefined}/>
      </> : uid ? <SellerTaxCommandJournal uid={uid}/> : <Text style={styles.body}>Une session SDK actuelle est requise pour relire vos propres reçus.</Text>}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md, gap: spacing.md},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
