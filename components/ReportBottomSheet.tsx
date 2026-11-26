import {
  ModerationService,
  ReportReason,
  ReportReasonLabels,
  ReportType,
} from '@/services/moderationService';
import { useAuthenticatedSession } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import { articleReportProjection, readArticleReportAttempt } from '@/services/articleReportJournal';
import type { Article } from '@/types/article';
import type { ArticleReportAttempt, ArticleReportObservation } from '@/types/articleReportEvidence';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { useRouter } from 'expo-router';
import {MessageReportPanel} from '@/components/MessageReportPanel';
import type {MessageReportSelection} from '@/types/messageReportEvidence';
import {ContentSafetyPanel} from '@/components/ContentSafetyPanel';
import type {ContentSafetySelection} from '@/types/contentSafety';

export type ReportSourceScreen = 'chat' | 'public_profile' | 'article_detail';

export interface ReportBottomSheetRef {
  openReview: (selection: ContentSafetySelection | null) => void;
  openMessage: (selection: MessageReportSelection) => void;
  open: (
    type: ReportType,
    targetId: string,
    source: ReportSourceScreen,
    targetOwnerId?: string,
    displayedArticle?: Article,
  ) => void;
  close: () => void;
}

interface Props {
  onReportSubmitted?: () => void;
  onClose?: () => void;
}

const ReportBottomSheet = forwardRef<ReportBottomSheetRef, Props>(
  ({ onReportSubmitted, onClose }, ref) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const {uid, identity: user} = useAuthenticatedSession();
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [messageSelection, setMessageSelection] = useState<MessageReportSelection | null>(null);
    const [contentSelection,setContentSelection]=useState<ContentSafetySelection|null>(null);
    const [contentOpen,setContentOpen]=useState(false);

    const [targetType, setTargetType] = useState<ReportType>('user');
    const [targetId, setTargetId] = useState<string>('');
    const [targetOwnerId, setTargetOwnerId] = useState<string | undefined>();
    const [displayedProjection, setDisplayedProjection] = useState<Record<string, unknown> | null>(null);
    const [openRevision, setOpenRevision] = useState(0);
    const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState<'reason' | 'description'>('reason');
    const [articleReceipt, setArticleReceipt] = useState<ArticleReportObservation | null>(null);
    const [localAttempt, setLocalAttempt] = useState<ArticleReportAttempt | null>(null);
    const [reportNotice, setReportNotice] = useState('');
    const [neutralizingRequestId, setNeutralizingRequestId] = useState<string | null>(null);
    const context = useShippingPurchaseContext(JSON.stringify(['report', isOpen, targetType, targetId, openRevision]), uid);
    const [previousFrame, setPreviousFrame] = useState(context.frame);
    if (previousFrame !== context.frame) {
      setPreviousFrame(context.frame); setLocalAttempt(null); setArticleReceipt(null); setReportNotice(''); setLoading(false); setNeutralizingRequestId(null);
      setSelectedReason(null); setDescription(''); setStep('reason');
    }
    const [previousFocus, setPreviousFocus] = useState(context.focusRevision);
    if (previousFocus !== context.focusRevision) {setPreviousFocus(context.focusRevision); setArticleReceipt(null); setLoading(false); setNeutralizingRequestId(null);}
    const journal = useQuery({queryKey: ['article-report-journal', uid, targetId, openRevision, context.focusRevision],
      enabled: !!uid && isOpen && context.focused && targetType === 'article', staleTime: 0, gcTime: 0, retry: false,
      queryFn: () => {const operation = context.capture(); return readArticleReportAttempt(operation.session.uid, targetId, () => context.assertCurrent(operation));} });
    const journalReady = journal.isSuccess && !journal.isFetching && !journal.isError && context.focused;
    const pendingAttempt = journalReady ? journal.data ?? localAttempt : localAttempt;
    const preview = useQuery({queryKey: ['article-report-preview', uid, targetId, targetOwnerId, openRevision, displayedProjection, context.focusRevision],
      enabled: !!uid && isOpen && context.focused && targetType === 'article' && !!targetOwnerId && !!displayedProjection && journalReady && !pendingAttempt,
      staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const operation = context.capture();
        return ModerationService.previewArticleReport(operation.session.uid, targetId, targetOwnerId!, displayedProjection!, () => context.assertCurrent(operation));} });
    const checkpoint = context.focused && preview.isSuccess && !preview.isFetching && !preview.isError ? preview.data : null;
    // Latest step + submit flag for the abandon event fired from onChange.
    const stepRef = useRef<'reason' | 'description'>('reason');
    stepRef.current = step;
    const submittedRef = useRef(false);

    const snapPoints = useMemo(() => ['60%', '80%'], []);

    useImperativeHandle(ref, () => ({
      open: (type: ReportType, id: string, source: ReportSourceScreen, ownerId?: string, displayedArticle?: Article) => {
        setMessageSelection(null);
        setContentSelection(null);
        setContentOpen(false);
        // Exact message reports require their participating conversation source.
        if (type === 'message') return;
        setTargetType(type);
        setTargetId(id);
        setTargetOwnerId(ownerId);
        setDisplayedProjection(type === 'article' && displayedArticle?.id === id && displayedArticle.sellerId === ownerId
          ? articleReportProjection(displayedArticle) : null);
        setOpenRevision(value => value + 1); setLocalAttempt(null); setArticleReceipt(null); setReportNotice('');
        setSelectedReason(null);
        setDescription('');
        setStep('reason');
        submittedRef.current = false;
        track('report_opened', {
          target_type: type,
          target_id: id,
          source_screen: source,
        });
        setIsOpen(true);
      },
      openMessage: (selection) => {
        setContentSelection(null);
        setContentOpen(false);
        setMessageSelection({...selection}); setTargetType('message'); setTargetId(selection.messageId ?? '');
        setOpenRevision(value => value + 1); setIsOpen(true); submittedRef.current = false;
      },
      openReview: (selection) => {
        setMessageSelection(null);setContentOpen(true);setContentSelection(selection?{...selection}:null);setTargetId(selection?.targetId??'');
        setOpenRevision(value=>value+1);setIsOpen(true);submittedRef.current=false;
      },
      close: () => {
        setContentSelection(null);
        setContentOpen(false);onClose?.();
        if (messageSelection) {setIsOpen(false); setMessageSelection(null);}
        bottomSheetRef.current?.close();
      },
    }));

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.5}
        />
      ),
      []
    );

    const handleSelectReason = (reason: ReportReason) => {
      setSelectedReason(reason);
      setStep('description');
    };

    const executeArticle = async (mode: 'submit' | 'observe' | 'neutralize' | 'acknowledge') => {
      if (!uid || loading || !context.focused || !journalReady) return;
      let attempt = pendingAttempt;
      if (!attempt) {
        if (mode !== 'submit' || !checkpoint || !selectedReason) return;
        attempt = {version: 1, uid, targetType: 'article', targetId, requestId: randomUUID(), reason: selectedReason,
          description: description.trim() || null, expectedArticleRevision: checkpoint.articleRevision,
          expectedArticleContentHash: checkpoint.contentHash, expectedMedia: checkpoint.expectedMedia.map(media => ({...media}))};
      }
      if (mode === 'neutralize' && (neutralizingRequestId !== attempt.requestId || articleReceipt?.state !== 'unrecorded')) return;
      let operation; try { operation = context.start(); } catch { return; } if (!operation) return;
      const assertContext = () => context.assertCurrent(operation);
      setLoading(true); setReportNotice('');
      // Keep the exact intention visible even if the local durable write fails.
      if (mode === 'submit') setLocalAttempt(attempt);
      try {
        const receipt = mode === 'submit' ? await ModerationService.submitArticleReport(attempt, assertContext)
          : mode === 'acknowledge' ? await ModerationService.acknowledgeArticleReport(attempt, assertContext)
            : mode === 'neutralize' ? await ModerationService.neutralizeArticleReport(attempt, assertContext)
            : await ModerationService.observeArticleReport(attempt, assertContext);
        assertContext(); setArticleReceipt(receipt); setNeutralizingRequestId(null);
        if (receipt.state === 'unrecorded') setReportNotice('L’envoi reste à vérifier. Vérifiez son état ou reprenez-le.');
        else if (receipt.state === 'historical_unknown') setReportNotice('Ce signalement doit être vérifié par notre équipe.');
        else {
          submittedRef.current = receipt.state !== 'not_executed'; setReportNotice(receipt.state === 'not_executed'
            ? 'Cet envoi a été annulé.'
            : 'Votre signalement a été reçu.');
          if (mode === 'acknowledge') {setLocalAttempt(null); await journal.refetch(); assertContext(); onReportSubmitted?.(); bottomSheetRef.current?.close();}
        }
        if (mode !== 'acknowledge') {await journal.refetch(); assertContext();}
      } catch (error) {if (context.isCurrent(operation)) {setArticleReceipt(null); setReportNotice(error instanceof Error ? error.message : 'Le signalement reste à vérifier.'); await journal.refetch();}}
      finally {if (context.isCurrent(operation)) setLoading(false); context.finish(operation);}
    };
    const handleSubmit = async () => {
      if (targetType === 'article') {await executeArticle('submit'); return;}
      if (!uid || !selectedReason || loading) return;
      let operation; try {operation = context.start();} catch {return;} if (!operation) return;

      setLoading(true);
      try {
        await ModerationService.createReport(
          uid,
          user?.displayName || 'Utilisateur',
          targetType,
          targetId,
          selectedReason,
          description.trim() || undefined,
          targetOwnerId
        );
        context.assertCurrent(operation);

        submittedRef.current = true;
        track('report_submitted', {
          target_type: targetType,
          target_id: targetId,
          reason: selectedReason,
          has_description: description.trim().length > 0,
          success: true,
        });

        Alert.alert(
          'Signalement envoyé',
          'Merci pour votre signalement. Notre équipe va l\'examiner dans les plus brefs délais.',
          [
            {
              text: 'OK',
              onPress: () => {
                try {context.assertCurrent(operation);} catch {return;}
                bottomSheetRef.current?.close();
                onReportSubmitted?.();
              },
            },
          ]
        );
      } catch (error: unknown) {
        if (!context.isCurrent(operation)) return;
        track('report_submitted', {
          target_type: targetType,
          target_id: targetId,
          reason: selectedReason,
          has_description: description.trim().length > 0,
          success: false,
        });
        Alert.alert('Erreur', error instanceof Error ? error.message : 'Une erreur est survenue');
      } finally {
        if (context.isCurrent(operation)) setLoading(false); context.finish(operation);
      }
    };

    const getTitle = () => {
      switch (targetType) {
        case 'user':
          return 'Signaler cet utilisateur';
        case 'article':
          return 'Signaler cet article';
        case 'message':
          return 'Signaler ce message';
        default:
          return 'Signaler';
      }
    };

    const getReasons = (): ReportReason[] => {
      if (targetType === 'article') {
        return [
          'counterfeit',
          'dangerous_item',
          'scam',
          'inappropriate_content',
          'spam',
          'other',
        ];
      }
      return [
        'harassment',
        'scam',
        'spam',
        'inappropriate_content',
        'other',
      ];
    };

    if (!isOpen) return null;

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.bottomSheetBackground}
        handleIndicatorStyle={styles.handleIndicator}
        enableDynamicSizing={false}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="none"
        android_keyboardInputMode="adjustResize"
        onChange={(index) => {
          if (index === -1) {
            onClose?.();
            if (!submittedRef.current) {
              track('report_abandoned', {
                target_type: targetType,
                step_reached: stepRef.current,
              });
            }
            setIsOpen(false);
          }
        }}
      >
        <BottomSheetScrollView contentContainerStyle={styles.content}>
          {contentOpen?<ContentSafetyPanel key={`${uid}:${openRevision}`} scope="own" selection={contentSelection}/>:messageSelection ? <MessageReportPanel key={`${uid}:${openRevision}`} selection={messageSelection} onDone={() => {
            submittedRef.current = true; setIsOpen(false); setMessageSelection(null); onReportSubmitted?.();
          }} /> : <>
            <View style={styles.header}>
              <Ionicons name="flag" size={24} color={colors.danger} />
              <Text style={styles.title}>{getTitle()}</Text>
            </View>

            {targetType === 'article' ? <View style={styles.selectedReasonBox}>
              {!displayedProjection ? <Text style={styles.infoText}>Revenez à l’annonce et ouvrez le signalement depuis sa version affichée.</Text> : null}
              {journal.isError ? <><Text style={styles.infoText}>Impossible de vérifier votre dernier signalement.</Text>
                <TouchableOpacity disabled={loading} onPress={() => {void journal.refetch();}}><Text style={styles.changeButtonText}>Réessayer</Text></TouchableOpacity></> : !journalReady ? <ActivityIndicator color={colors.muted} /> : null}
              {pendingAttempt ? <>
                <Text style={styles.reasonText}>Envoi à vérifier : {pendingAttempt.reason}</Text>
                <Text style={styles.infoText}>{pendingAttempt.description ?? 'Aucun détail supplémentaire saisi.'}</Text>
                <TouchableOpacity disabled={loading || !journalReady} onPress={() => {void executeArticle('observe');}}><Text style={styles.changeButtonText}>Vérifier l’envoi</Text></TouchableOpacity>
                <TouchableOpacity disabled={loading || !journalReady} onPress={() => {void executeArticle('submit');}}><Text style={styles.changeButtonText}>Reprendre l’envoi</Text></TouchableOpacity>
                {articleReceipt?.state === 'unrecorded' ? neutralizingRequestId !== pendingAttempt.requestId ?
                  <TouchableOpacity disabled={loading} onPress={() => setNeutralizingRequestId(pendingAttempt.requestId)}><Text style={styles.changeButtonText}>Annuler cet envoi</Text></TouchableOpacity> : <>
                    <Text style={styles.infoText}>Si le signalement est déjà reçu, il sera conservé.</Text>
                    <TouchableOpacity disabled={loading} onPress={() => {void executeArticle('neutralize');}}><Text style={styles.changeButtonText}>Confirmer l’annulation</Text></TouchableOpacity>
                    <TouchableOpacity disabled={loading} onPress={() => setNeutralizingRequestId(null)}><Text style={styles.changeButtonText}>Garder cet envoi</Text></TouchableOpacity>
                  </> : null}
              </> : checkpoint ? <>
                <Text style={styles.reasonText}>{typeof checkpoint.snapshot.title === 'string' ? checkpoint.snapshot.title : 'Titre à examiner'}</Text>
                <Text style={styles.infoText}>{typeof checkpoint.snapshot.description === 'string' ? checkpoint.snapshot.description : 'Description non communiquée'}</Text>
                <Text style={styles.infoText}>Prix annoncé : {typeof checkpoint.snapshot.price === 'number' ? `${checkpoint.snapshot.price} $` : 'inconnu'} · État : {typeof checkpoint.snapshot.condition === 'string' ? checkpoint.snapshot.condition : 'inconnu'}</Text>
                <View style={styles.photos}>{Array.isArray(checkpoint.snapshot.images) ? checkpoint.snapshot.images.map((image, index) => {
                  const url = image && typeof image === 'object' && 'url' in image && typeof image.url === 'string' ? image.url : null;
                  return url ? <Image key={`${index}:${url}`} source={{uri: url}} style={styles.photo} cachePolicy="none" contentFit="contain" accessibilityLabel={`Photo examinée ${index + 1}`} /> : null;
                }) : null}</View>
                {checkpoint.conservation !== 'ready' ? <Text style={styles.infoText}>Certaines photos sont indisponibles.</Text> : null}
              </> : preview.isFetching ? <ActivityIndicator color={colors.muted} /> : <Text style={styles.infoText}>L’aperçu ne correspond plus à l’annonce affichée ou ne peut pas être lu. Fermez ce panneau, relisez l’annonce, puis ouvrez un nouveau signalement.</Text>}
              {articleReceipt?.state === 'not_executed' ? <>
                <Text style={styles.reasonText}>Envoi annulé</Text>
                <TouchableOpacity disabled={loading || !pendingAttempt} onPress={() => {void executeArticle('acknowledge');}}><Text style={styles.changeButtonText}>Terminer</Text></TouchableOpacity>
              </> : articleReceipt && articleReceipt.state !== 'unrecorded' && articleReceipt.state !== 'historical_unknown' ? <>
                <Text selectable style={styles.reasonText}>Signalement enregistré : {articleReceipt.reportId}</Text>
                <Text style={styles.infoText}>Conservation des photos : {articleReceipt.conservation === 'preserved' ? 'conservées dans le dossier privé' : articleReceipt.conservation === 'pending' ? 'en attente' : 'à rapprocher'}.</Text>
                <TouchableOpacity disabled={loading || !context.focused} onPress={() => {
                  try {const op = context.capture(); if (articleReceipt.actorUid !== op.session.uid || articleReceipt.articleId !== targetId) return;
                    context.assertCurrent(op); router.push({pathname: '/product-review', params: {contextKind: 'article_report', contextId: articleReceipt.reportId}} as never);
                    bottomSheetRef.current?.close();
                  } catch { /* The recorded report supplies a reference, not a new private permission. */ }}}><Text style={styles.changeButtonText}>Ajouter une déclaration ou consulter les échanges de ce signalement</Text></TouchableOpacity>
                <TouchableOpacity disabled={loading || !pendingAttempt} onPress={() => {void executeArticle('acknowledge');}}><Text style={styles.changeButtonText}>Terminer</Text></TouchableOpacity>
              </> : null}
              {reportNotice ? <Text accessibilityRole="alert" style={styles.infoText}>{reportNotice}</Text> : null}
            </View> : null}

            {step === 'reason' ? (
              <>
                <Text style={styles.subtitle}>
                  Pourquoi souhaitez-vous signaler ce contenu ?
                </Text>

                <View style={styles.reasonsList}>
                  {getReasons().map((reason) => (
                    <TouchableOpacity
                      key={reason}
                      style={styles.reasonItem}
                      disabled={loading || !!pendingAttempt}
                      onPress={() => handleSelectReason(reason)}
                    >
                      <Text style={styles.reasonText}>
                        {ReportReasonLabels[reason]}
                      </Text>
                      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : (
              <>
                <View style={styles.selectedReasonBox}>
                  <Text style={styles.selectedReasonLabel}>Raison sélectionnée :</Text>
                  <Text style={styles.selectedReasonText}>
                    {selectedReason && ReportReasonLabels[selectedReason]}
                  </Text>
                  <TouchableOpacity
                    style={styles.changeButton}
                    disabled={loading || !!pendingAttempt}
                    onPress={() => setStep('reason')}
                  >
                    <Text style={styles.changeButtonText}>Modifier</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.descriptionLabel}>
                  Détails supplémentaires (optionnel)
                </Text>
                <TextInput
                  style={styles.descriptionInput}
                  placeholder="Décrivez le problème en détail..."
                  placeholderTextColor={colors.muted}
                  multiline
                  numberOfLines={4}
                  value={description}
                  onChangeText={setDescription}
                  maxLength={2000}
                  editable={!pendingAttempt && !loading}
                  textAlignVertical="top"
                />

                <TouchableOpacity
                  style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                  onPress={handleSubmit}
                  disabled={loading || targetType === 'article' && (!journalReady || !!pendingAttempt || !checkpoint)}
                >
                  {loading ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <>
                      <Ionicons name="send" size={18} color={colors.white} />
                      <Text style={styles.submitButtonText}>Envoyer le signalement</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}

            <View style={styles.infoBox}>
              <Ionicons name="information-circle" size={20} color={colors.foregroundSecondary} />
              <Text style={styles.infoText}>
                Les signalements abusifs peuvent entraîner la suspension de votre compte.
              </Text>
            </View>
          </>}
          </BottomSheetScrollView>
      </BottomSheet>
    );
  }
);

const styles = StyleSheet.create({
  bottomSheetBackground: {backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg},
  handleIndicator: {backgroundColor: colors.border, width: spacing.xl},
  content: {padding: spacing.lg, paddingBottom: spacing.xl},
  header: {flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md},
  title: {...typography.h3, color: colors.foreground, marginLeft: spacing.sm},
  subtitle: {...typography.bodySmall, color: colors.foregroundSecondary, marginBottom: spacing.md},
  reasonsList: {backgroundColor: colors.surfaceWarm, borderRadius: radius.lg, overflow: 'hidden'},
  reasonItem: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border},
  reasonText: {...typography.body, color: colors.foreground},
  selectedReasonBox: {backgroundColor: colors.surfaceWarm, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm},
  selectedReasonLabel: {...typography.caption, color: colors.muted, marginBottom: spacing.xs},
  selectedReasonText: {...typography.body, color: colors.danger},
  changeButton: {alignSelf: 'flex-start'},
  changeButtonText: {...typography.bodySmall, color: colors.primary},
  descriptionLabel: {...typography.bodySmall, color: colors.foreground, marginBottom: spacing.sm},
  descriptionInput: {...typography.body, backgroundColor: colors.surfaceWarm, borderRadius: radius.md, padding: spacing.md, color: colors.foreground, minHeight: spacing['3xl'] + spacing.xl, marginBottom: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border},
  submitButton: {backgroundColor: colors.danger, borderRadius: radius.md, padding: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center'},
  submitButtonDisabled: {backgroundColor: colors.muted},
  submitButtonText: {...typography.body, color: colors.white, marginLeft: spacing.sm},
  infoBox: {flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.surfaceWarm, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md},
  infoText: {...typography.caption, color: colors.foregroundSecondary, flexShrink: 1},
  photos: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  photo: {width: spacing['3xl'] + spacing.xl, aspectRatio: 1, backgroundColor: colors.surface},
});

ReportBottomSheet.displayName = 'ReportBottomSheet';
export default ReportBottomSheet;
