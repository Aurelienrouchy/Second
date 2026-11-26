import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { LateCommercialHistory } from '@/components/LateCommercialHistory';
import { LateCommercialLinkSummary } from '@/components/LateCommercialLinkSummary';
import { LateCommercialFinancialSummary } from '@/components/LateCommercialFinancialSummary';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { COMMERCIAL_CLAIM_REVIEW_ENABLED } from '@/config/featureFlags';
import { CommercialClaimReviewService, commercialClaimReviewFailure } from '@/services/commercialClaimReviewService';
import { LateCommercialRecourseService } from '@/services/lateCommercialRecourseService';
import { LateCommercialRecourseJournal } from '@/services/lateCommercialRecourseJournal';
import { productReviewEqual } from '@/services/productReviewService';
import { createCommercialClaimInteraction, COMMERCIAL_CLAIM_LIMITS } from '@/utils/commercialClaimReviewPresentation';
import type { CommercialClaimReviewReference } from '@/types/commercialClaimReview';
import type { ProductPhysicalDocumentaryAdmission } from '@/types/productPhysicalReview';
import type { LateCommercialEntry, LateCommercialReference } from '@/types/lateCommercialRecourse';
import { AdminFinancialReauthentication } from './AdminFinancialReauthentication';
import { AdminLateCommercialDecision } from './AdminLateCommercialDecision';
import { AdminProductFinancialEntry } from './AdminProductFinancialEntry';
import { colors, spacing, typography } from '@/constants/theme';

export function AdminCommercialClaimReexamination({uid, transactionId, claimId, reference, assertSelection, nativeAdmission}: {
  uid: string; transactionId: string; claimId: string; reference: CommercialClaimReviewReference; assertSelection: () => void; nativeAdmission: ProductPhysicalDocumentaryAdmission | null;
}) {
  const frame = useLabelLifecycleContext(`admin-claim-reexamination:${transactionId}:${claimId}:${JSON.stringify(reference)}`, uid), client = useQueryClient();
  const [interaction] = useState(createCommercialClaimInteraction), [revision, setRevision] = useState(0), [authenticated, setAuthenticated] = useState<string | null>(null);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), transactionId, claimId, reference, nativeAdmission?.key, frame.focusRevision, revision]);
  const parentAdmitted = !!nativeAdmission && nativeAdmission.uid === uid && nativeAdmission.scope === 'admin' && nativeAdmission.context.id === transactionId && nativeAdmission.materialCapability === 'product_review_material_v1' && nativeAdmission.parcelCapability === 'product_review_parcel_v1';
  const choice = interaction.capture(), currentChoice = () => {frame.capture(); assertSelection(); choice(); if (!parentAdmitted || !nativeAdmission) throw commercialClaimReviewFailure(); nativeAdmission.assertCurrent();};
  const allowed = frame.focused && parentAdmitted && authenticated === key;
  const journal = useQuery({queryKey: ['late-commercial-own-journal', key], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = frame.capture(); return LateCommercialRecourseJournal.read(uid, () => frame.assertCurrent(op));}});
  const journalReady = frame.focused && journal.isSuccess && !journal.isFetching && !journal.isError, pending = journalReady ? journal.data : null;
  const read = useQuery({queryKey: ['commercial-claim-admin-reexamination', key], enabled: allowed, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {
      const op = frame.capture(), current = () => {frame.assertCurrent(op); currentChoice();};
      current(); if (!nativeAdmission) throw commercialClaimReviewFailure(); await nativeAdmission.revalidate(); current();
      const claim = await CommercialClaimReviewService.source(uid, transactionId, claimId, 'admin', current); current();
      if (claim.qualification !== 'native_original_claim' || !claim.source || claim.source.reviewState !== 'reexamination_requested' || !productReviewEqual(claim.source.latestReference, reference) || claim.source.documentarySourceHash !== nativeAdmission.sourceHash || claim.source.reference.corpusHash !== nativeAdmission.corpusHash) throw commercialClaimReviewFailure();
      const preview = await LateCommercialRecourseService.previewReexamination(uid, transactionId, reference, current); current();
      const source = claim.source.reference;
      if (preview.originalDisputeId !== claimId || !productReviewEqual([preview.source.claimRevision, preview.source.claimHash, preview.source.reviewVersion, preview.source.reviewHash, preview.source.membersHash], [source.claimRevision, source.claimHash, source.reviewVersion, source.reviewHash, source.membersHash])) throw commercialClaimReviewFailure();
      return {claim: claim.source, preview};
    }});
  const data = allowed && read.isSuccess && !read.isFetching && !read.isError ? read.data : null;
  const sourceKey = JSON.stringify([key, data?.preview.sourceHash, data?.preview.currentAdmission]);
  const [financialInteraction] = useState(createCommercialClaimInteraction), financialChoice = financialInteraction.capture();
  const [financial, setFinancial] = useState<{key: string; reference: LateCommercialReference; nonce: string} | null>(null);
  const selected = financial?.key === sourceKey ? financial : null;
  const refresh = () => {try {currentChoice(); interaction.invalidate(); financialInteraction.invalidate(); setFinancial(null); setAuthenticated(null); setRevision(value => value + 1);} catch { /* No old source callback can reset a replacement claim. */ }};
  const selectFinancial = (entry: LateCommercialEntry) => {try {
    currentChoice();
    if (!data || entry.decision !== 'admit_examination' || entry.originalDisputeId !== claimId || !productReviewEqual(entry.claimReexamination, reference) || data.preview.currentAdmissionQualification !== 'native_admission' || !productReviewEqual(entry.reference, data.preview.currentAdmission)) return;
    financialInteraction.invalidate(); setFinancial({key: sourceKey, reference: entry.reference, nonce: randomUUID()});
  } catch { /* An old or different admission never opens the financial engine. */ }};
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.body}>Admission opérateur du réexamen de la plainte d’origine</Text><Text style={styles.caption}>{COMMERCIAL_CLAIM_LIMITS}</Text>
    <Text style={styles.caption}>Une demande de réexamen ne rouvre pas la plainte. L’instruction d’admission, l’issue documentaire actuelle puis toute décision financière sont des actes distincts. La contradiction du vendeur reste possible sans veto à l’examen.</Text>
    <AdminFinancialReauthentication key={key} uid={uid} sourceKey={`commercial-claim-admin-reader:${key}`} purpose="commercial" parcel disabled={!frame.focused || !parentAdmitted || read.isFetching}
      onVerified={() => {try {currentChoice(); setAuthenticated(key);} catch { /* No superseded reauthentication. */ }}}/>
    {data ? <>
      <Text selectable style={styles.body}>Plainte d’origine {data.preview.originalDisputeId} · reçue {data.claim.originalCreatedAt} · demande {reference.entryId}.</Text>
      <Text style={styles.caption}>La décision initiale et ses faits sont conservés. L’admission n’annule aucun remboursement, événement bancaire ou retour déjà engagé.</Text>
      {typeof data.preview.source.originClaim.details === 'string' ? <Text selectable style={styles.body}>Récit initial conservé : {data.preview.source.originClaim.details}</Text> : <Text style={styles.caption}>Récit initial inconnu dans cette projection.</Text>}
      <LateCommercialLinkSummary link={data.preview.source.link}/><LateCommercialFinancialSummary situation={data.preview.source.financialSituation}/>
      <AdminLateCommercialDecision key={sourceKey} uid={uid} preview={data.preview}
          nativeAdmission={nativeAdmission}
          assertSelection={currentChoice} disabled={!journalReady || !!pending || !!selected} onRecorded={receipt => {if (receipt?.state === 'committed') refresh();}}
          onJournalChanged={() => {void client.invalidateQueries({queryKey: ['late-commercial-own-journal']});}}/>
      <LateCommercialHistory uid={uid} transactionId={transactionId} scope="admin" claimReview refreshKey={read.dataUpdatedAt} assertSelection={currentChoice} onSelect={selectFinancial}/>
      {selected ? <AdminProductFinancialEntry key={selected.nonce} uid={uid} material parcel topic={data.preview.source.link.topic}
        selection={{transactionId, disputeId: data.preview.originalDisputeId}} lateCommercial={selected.reference}
        assertSelection={() => {currentChoice(); financialChoice(); if (!COMMERCIAL_CLAIM_REVIEW_ENABLED) throw commercialClaimReviewFailure();}} disabled={!COMMERCIAL_CLAIM_REVIEW_ENABLED || !journalReady || !!pending} blockedTransactions={[]} onRecorded={refresh}/> : null}
    </> : read.isError ? <Text accessibilityRole="alert" style={styles.caption}>La demande, le retrait, la plainte ou leur corpus actuel ne peuvent pas être qualifiés. Aucun examen ni résultat financier n’est déduit.</Text> : null}
    <Button variant="secondary" disabled={!frame.focused} onPress={refresh}>Relire explicitement cette demande et ses sources</Button>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
