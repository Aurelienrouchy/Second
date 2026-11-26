/**
 * RecourseReasonSheet — shared selector for private recourse declarations.
 * Design System: Editorial Luxe — all tokens from constants/theme.
 *
 * A single bottom sheet reused by both the "Signaler un problème" and
 * "Demander un retour" flows in `ShipmentTracking`. The parent supplies the
 * title, intro, the list of selectable reasons (UI label + backend reason code)
 * and an optional footer note; on submit it returns the chosen reason code and
 * the trimmed free-text details.
 *
 * Ref-based open/close (`present` / `dismiss`), @gorhom/bottom-sheet — the
 * scrim (BottomSheetBackdrop), drag handle and keyboard coordination are owned
 * by gorhom. Mounts its content only while open.
 */

import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetModal,
  type BottomSheetBackdropProps,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { getAuthSessionGeneration } from '@/store/authStore';
import { readRecourseDraft, writeRecourseDraft, type RecourseDraftScope } from '@/services/recourseDraftService';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import type { WholeSetDeclaration, WholeSetReportDraft, WholeSetReportSource } from '@/types/transactionProblem';

import { colors, fonts, radius, spacing } from '@/constants/theme';

export interface RecourseReasonOption<Code extends string = string> {
  /** Backend reason code sent to the callable. */
  code: Code;
  /** Buyer-facing label (FR). */
  label: string;
}

export interface RecourseReasonSheetRef {
  present: () => void;
  dismiss: () => void;
  clearAcknowledgedDraft: () => Promise<void>;
}

interface RecourseReasonSheetProps<Code extends string = string> {
  title: string;
  intro: string;
  reasons: readonly RecourseReasonOption<Code>[];
  /** Optional note shown above the submit button (e.g. return-fee disclaimer). */
  footerNote?: { title: string; body: string };
  /** Shows the free-text "Décrivez le problème" field when true. */
  showDetailsField?: boolean;
  detailsRequired?: boolean;
  submitLabel: string;
  isSubmitting?: boolean;
  onSubmit: (code: Code, details: string, setDeclaration?: WholeSetDeclaration) => void;
  /** Opt-in for a NEW whole-set complaint; undefined preserves all older importers. */
  wholeSetSource?: WholeSetReportSource | null;
  draftScope?: RecourseDraftScope;
  detailsMaxLength?: number;
  locked?: boolean;
  onClose?: () => void;
  modal?: boolean;
}

function RecourseReasonSheetInner<Code extends string = string>(
  {
    title,
    intro,
    reasons,
    footerNote,
    showDetailsField = false,
    detailsRequired = false,
    submitLabel,
    isSubmitting = false,
    onSubmit,
    draftScope,
    detailsMaxLength = 4000,
    locked = false,
    onClose,
    modal = false,
    wholeSetSource,
  }: RecourseReasonSheetProps<Code>,
  ref: React.Ref<RecourseReasonSheetRef>,
) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const modalRef = useRef<BottomSheetModal>(null);
  const insets = useSafeAreaInsets();
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<Code | null>(null);
  const [details, setDetails] = useState('');
  const [wholeSetDraft, setWholeSetDraft] = useState<WholeSetReportDraft | undefined>();
  const [draftErrorState, setDraftError] = useState<{scope: string; value: boolean} | null>(null);
  const [edited, setEdited] = useState(false);
  const generation = getAuthSessionGeneration();
  const draftContext = useShippingPurchaseContext(`draft:${draftScope?.transactionId ?? ''}:${draftScope?.purpose ?? ''}`, draftScope?.uid ?? null);
  const scopeKey = JSON.stringify([draftScope?.uid, draftScope?.transactionId, draftScope?.purpose, generation]);
  const draftError = draftErrorState?.scope === scopeKey && draftErrorState.value;
  const disabled = isSubmitting || locked || !!draftScope && !draftContext.focused;
  const [renderScope, setRenderScope] = useState(scopeKey);
  if (renderScope !== scopeKey) {
    setRenderScope(scopeKey);
    setEdited(false); setSelected(null); setDetails(''); setWholeSetDraft(undefined); setDraftError(null); setIsOpen(false);
  }
  const draftQuery = useQuery({ queryKey: ['recourse-draft', draftScope?.uid, draftScope?.transactionId, draftScope?.purpose, generation, draftContext.focusRevision],
    enabled: !!draftScope && isOpen && draftContext.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: async () => {const operation = draftContext.capture(); const result = await readRecourseDraft(draftScope!); draftContext.assertCurrent(operation); return result;} });
  const shownSelected = edited ? selected : draftQuery.data?.reason && reasons.some(reason => reason.code === draftQuery.data.reason)
    ? draftQuery.data.reason as Code : selected;
  const shownDetails = edited ? details : draftQuery.data?.details ?? details;
  const shownWholeSet = edited ? wholeSetDraft : draftQuery.data?.wholeSet ?? wholeSetDraft;
  const setContract = wholeSetSource?.qualification === 'native_whole_set_snapshot' ? wholeSetSource.source : null;
  const setRequested = shownSelected === 'not_as_described' && wholeSetSource !== undefined;
  const setDraftCurrent = !!setContract && shownWholeSet?.snapshotHash === setContract.snapshotHash;
  const declaration: WholeSetDeclaration | null = setDraftCurrent && shownWholeSet?.claim && shownWholeSet.received.status && shownWholeSet.missing.status &&
    (shownWholeSet.received.status !== 'described' || !!shownWholeSet.received.description.trim()) &&
    (shownWholeSet.missing.status !== 'described' || !!shownWholeSet.missing.description.trim()) &&
    (shownWholeSet.claim !== 'incomplete_set' || shownWholeSet.missing.status !== 'none_observed') ? {
      protocol: 'whole_set_declaration_v1', snapshotHash: setContract.snapshotHash, claim: shownWholeSet.claim,
      received: {status: shownWholeSet.received.status, description: shownWholeSet.received.status === 'described' ? shownWholeSet.received.description.trim() : null},
      missing: {status: shownWholeSet.missing.status, description: shownWholeSet.missing.status === 'described' ? shownWholeSet.missing.description.trim() : null}, recourseScope: 'whole_transaction',
    } : null;
  const setReady = !setRequested || wholeSetSource?.qualification === 'not_a_set' || wholeSetSource?.qualification === 'historical_unit_unrecorded' || !!declaration;
  const draftReady = !draftScope || draftQuery.isSuccess && !draftQuery.isFetching && !draftError;
  const submitDisabled = !shownSelected || disabled || !draftReady || !setReady || detailsRequired && !shownDetails.trim();
  // The first gesture must merge with the draft actually read for this scope.
  // Once edited, the in-memory story remains recoverable after a failed write.
  const editingDisabled = disabled || !!draftScope && !edited && (!draftQuery.isSuccess || draftQuery.isFetching || !!draftQuery.error);
  const editDraft = (reason: Code | null, text: string, wholeSet = shownWholeSet) => {
    if (editingDisabled) return;
    setEdited(true); setSelected(reason); setDetails(text); setWholeSetDraft(wholeSet);
    if (draftScope) {
      let operation: ReturnType<typeof draftContext.capture>;
      try {operation = draftContext.capture();} catch {return;}
      void writeRecourseDraft(draftScope, {reason, details: text, ...(wholeSet ? {wholeSet} : {})}).then(() => {
        if (draftContext.isCurrent(operation)) setDraftError({scope: scopeKey, value: false});
      }).catch(() => {if (draftContext.isCurrent(operation)) setDraftError({scope: scopeKey, value: true});});
    }
  };
  const recoverDraft = async () => {
    if (!draftScope || disabled) return;
    let operation: ReturnType<typeof draftContext.capture>;
    try {operation = draftContext.capture();} catch {return;}
    try {
      if (edited) await writeRecourseDraft(draftScope, {reason: shownSelected, details: shownDetails, ...(shownWholeSet ? {wholeSet: shownWholeSet} : {})});
      draftContext.assertCurrent(operation);
      const result = await draftQuery.refetch(); draftContext.assertCurrent(operation);
      if (!result.isSuccess || result.error || !result.data || edited &&
        (result.data.reason !== shownSelected || result.data.details !== shownDetails || JSON.stringify(result.data.wholeSet) !== JSON.stringify(shownWholeSet))) throw new Error('Brouillon à récupérer.');
      setDraftError({scope: scopeKey, value: false});
    } catch {if (draftContext.isCurrent(operation)) setDraftError({scope: scopeKey, value: true});}
  };

  const snapPoints = useMemo(
    () => (showDetailsField ? ['70%', '90%'] : ['55%', '85%']),
    [showDetailsField],
  );

  useImperativeHandle(ref, () => ({
    present: () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setIsOpen(true);
      if (draftScope) void recoverDraft();
    },
    dismiss: () => {
      if (modal) modalRef.current?.dismiss(); else bottomSheetRef.current?.close();
    },
    clearAcknowledgedDraft: async () => {
      const operation = draftScope ? draftContext.capture() : null;
      if (draftScope) await writeRecourseDraft(draftScope, null);
      if (operation) draftContext.assertCurrent(operation);
      setSelected(null); setDetails(''); setWholeSetDraft(undefined); setEdited(false); setDraftError(null);
      if (draftScope) await draftQuery.refetch();
    },
  }));
  useEffect(() => { if (modal && isOpen) modalRef.current?.present(); }, [modal, isOpen]);

  const handleChange = useCallback((index: number) => {
    if (index === -1) { setIsOpen(false); onClose?.(); }
  }, [onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const handleSubmit = useCallback(async () => {
    if (!shownSelected || disabled || !draftReady || !setReady || detailsRequired && !shownDetails.trim()) return;
    if (draftScope) {
      let operation: ReturnType<typeof draftContext.capture>;
      try {operation = draftContext.capture();} catch {return;}
      try { await writeRecourseDraft(draftScope, {reason: shownSelected, details: shownDetails, ...(shownWholeSet ? {wholeSet: shownWholeSet} : {})}); draftContext.assertCurrent(operation); }
      catch { if (draftContext.isCurrent(operation)) setDraftError({scope: scopeKey, value: true}); return; }
    }
    onSubmit(shownSelected, shownDetails.trim(), setRequested && declaration ? declaration : undefined);
  }, [shownSelected, disabled, onSubmit, shownDetails, shownWholeSet, declaration, setRequested, setReady, detailsRequired, draftReady, draftScope, draftContext.frame, draftContext.focusRevision, scopeKey]);

  if (!isOpen) return null;

  const content = (
      <BottomSheetScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
      >
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.intro}>{intro}</Text>
        {draftScope && !draftReady ? <Text style={styles.intro}>{draftError || draftQuery.isError ?
          'Le brouillon n’a pas pu être conservé ou relu. Votre récit affiché reste disponible ; relisez et conservez-le avant le dépôt.' : 'Relecture du brouillon…'}</Text> : null}
        {draftScope && (draftError || draftQuery.isError) ? <Pressable accessibilityRole="button" disabled={disabled}
          style={styles.submitButton} onPress={() => {void recoverDraft();}}><Text style={styles.submitButtonText}>Relire et conserver ce brouillon</Text></Pressable> : null}

        <View style={styles.reasonList} accessibilityRole="radiogroup" accessibilityLabel={`Motif : ${title}`}>
          {reasons.map((reason) => {
            const isActive = shownSelected === reason.code;
            return (
              <Pressable
                key={reason.code}
                accessibilityRole="radio"
                accessibilityLabel={reason.label}
                accessibilityState={{ checked: isActive, disabled: editingDisabled }}
                disabled={editingDisabled}
                style={[styles.reasonItem, isActive && styles.reasonItemActive]}
                onPress={() => {
                  Haptics.selectionAsync();
                  editDraft(reason.code, shownDetails);
                }}
              >
                <Text
                  style={[styles.reasonText, isActive && styles.reasonTextActive]}
                >
                  {reason.label}
                </Text>
                <Ionicons
                  name={isActive ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={isActive ? colors.primary : colors.muted}
                />
              </Pressable>
            );
          })}
        </View>

        {showDetailsField && (
          <View style={styles.detailsBlock}>
            <Text style={styles.detailsLabel}>Décrivez le problème</Text>
            <BottomSheetTextInput
              accessibilityLabel="Décrivez le problème"
              accessibilityState={{ disabled: editingDisabled }}
              editable={!editingDisabled}
              style={styles.detailsInput}
              placeholder="Donnez-nous quelques détails…"
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={4}
              value={shownDetails}
              maxLength={detailsMaxLength}
              onChangeText={(text) => editDraft(shownSelected, text)}
              textAlignVertical="top"
            />
          </View>
        )}

        {setRequested ? <View style={styles.detailsBlock}>
          <Text style={styles.detailsLabel}>Ensemble promis et contenu déclaré</Text>
          {setContract ? <><Text style={styles.intro}>Contenu enregistré lors de la commande : {setContract.title ?? 'titre inconnu'}.</Text>
            <Text selectable style={styles.intro}>{setContract.description ?? 'Le détail du contenu promis n’a pas été enregistré.'}</Text>
            <Text style={styles.intro}>Déclarez séparément ce que vous avez reçu et ce qui manque, ou indiquez explicitement que vous ne le savez pas. Le recours porte sur la commande entière ; aucun prix ou retour par composant n’est déduit.</Text>
            {!setDraftCurrent ? <><Text style={styles.intro}>{shownWholeSet ? 'Le brouillon concerne un autre contenu promis. Examinez cette source avant de recommencer explicitement la déclaration.' : 'Commencez une déclaration pour ce contenu promis.'}</Text>
              <Pressable accessibilityRole="button" disabled={editingDisabled} style={styles.submitButton} onPress={() => editDraft(shownSelected, shownDetails,
                {snapshotHash: setContract.snapshotHash, claim: null, received: {status: null, description: ''}, missing: {status: null, description: ''}})}><Text style={styles.submitButtonText}>Déclarer pour ce contenu enregistré</Text></Pressable></> : null}
            {setDraftCurrent && shownWholeSet ? <>
              {([{code: 'incomplete_set', label: 'Ensemble incomplet'}, {code: 'other_nonconformity', label: 'Autre différence sur cet ensemble'}] as const).map(option =>
                <Pressable key={option.code} accessibilityRole="radio" accessibilityState={{checked: shownWholeSet.claim === option.code, disabled: editingDisabled}}
                  disabled={editingDisabled} style={[styles.reasonItem, shownWholeSet.claim === option.code && styles.reasonItemActive]} onPress={() => editDraft(shownSelected, shownDetails, {...shownWholeSet, claim: option.code})}>
                  <Text style={styles.reasonText}>{option.label}</Text></Pressable>)}
              <Text style={styles.detailsLabel}>Ce que j’ai reçu</Text>
              {([{status: 'described', label: 'Je peux le décrire'}, {status: 'unknown', label: 'Contenu reçu inconnu'}] as const).map(option =>
                <Pressable key={option.status} accessibilityRole="radio" accessibilityState={{checked: shownWholeSet.received.status === option.status, disabled: editingDisabled}}
                  disabled={editingDisabled} style={[styles.reasonItem, shownWholeSet.received.status === option.status && styles.reasonItemActive]} onPress={() => editDraft(shownSelected, shownDetails,
                    {...shownWholeSet, received: {status: option.status, description: ''}})}><Text style={styles.reasonText}>{option.label}</Text></Pressable>)}
              {shownWholeSet.received.status === 'described' ? <BottomSheetTextInput accessibilityLabel="Contenu reçu déclaré" editable={!editingDisabled} style={styles.detailsInput}
                multiline maxLength={1000} value={shownWholeSet.received.description} onChangeText={description => editDraft(shownSelected, shownDetails,
                  {...shownWholeSet, received: {...shownWholeSet.received, description}})} /> : null}
              <Text style={styles.detailsLabel}>Ce qui manque selon moi</Text>
              {([{status: 'described', label: 'Je peux le décrire'}, {status: 'none_observed', label: 'Je n’ai constaté aucun élément manquant'}, {status: 'unknown', label: 'Éléments manquants inconnus'}] as const).map(option =>
                <Pressable key={option.status} accessibilityRole="radio" accessibilityState={{checked: shownWholeSet.missing.status === option.status, disabled: editingDisabled}}
                  disabled={editingDisabled || shownWholeSet.claim === 'incomplete_set' && option.status === 'none_observed'}
                  style={[styles.reasonItem, shownWholeSet.missing.status === option.status && styles.reasonItemActive]} onPress={() => editDraft(shownSelected, shownDetails,
                    {...shownWholeSet, missing: {status: option.status, description: ''}})}><Text style={styles.reasonText}>{option.label}</Text></Pressable>)}
              {shownWholeSet.missing.status === 'described' ? <BottomSheetTextInput accessibilityLabel="Éléments manquants déclarés" editable={!editingDisabled} style={styles.detailsInput}
                multiline maxLength={1000} value={shownWholeSet.missing.description} onChangeText={description => editDraft(shownSelected, shownDetails,
                  {...shownWholeSet, missing: {...shownWholeSet.missing, description}})} /> : null}
              <Text style={styles.intro}>Il s’agit de vos déclarations. Elles ne prouvent pas une réception physique, une faute ou un droit au remboursement.</Text>
            </> : null}
          </> : wholeSetSource?.qualification === 'historical_unit_unrecorded' ? <Text style={styles.intro}>Cette ancienne commande n’a pas enregistré le choix article ou ensemble. Vous pouvez décrire la différence dans le signalement général ; aucune unité n’est déduite de cette absence.</Text> :
            wholeSetSource?.qualification === 'not_a_set' ? <Text style={styles.intro}>La commande enregistrée ne porte pas sur un ensemble vendu comme un tout.</Text> :
            <Text accessibilityRole="alert" style={styles.intro}>Le contenu promis ne peut pas être qualifié dans cette lecture. Relisez la commande ou demandez un examen humain avant de déposer une nouvelle déclaration d’ensemble.</Text>}
        </View> : null}

        {footerNote && (
          <View style={styles.footerNote}>
            <Ionicons name="information-circle" size={18} color={colors.warning} />
            <View style={styles.footerNoteText}>
              <Text style={styles.footerNoteTitle}>{footerNote.title}</Text>
              <Text style={styles.footerNoteBody}>{footerNote.body}</Text>
            </View>
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={submitLabel}
          accessibilityState={{ disabled: submitDisabled, busy: isSubmitting }}
          style={[
            styles.submitButton,
            submitDisabled && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={submitDisabled}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.cream} />
          ) : (
            <Text style={styles.submitButtonText}>{submitLabel}</Text>
          )}
        </Pressable>
      </BottomSheetScrollView>
  );
  const sheetProps = { index: 0, snapPoints, backdropComponent: renderBackdrop, enablePanDownToClose: modal ? !isSubmitting : true,
    enableDynamicSizing: false, topInset: insets.top, handleIndicatorStyle: styles.handleIndicator, backgroundStyle: styles.background,
    onChange: handleChange, keyboardBehavior: 'interactive' as const, keyboardBlurBehavior: 'none' as const, android_keyboardInputMode: 'adjustResize' as const };
  return modal ? <BottomSheetModal ref={modalRef} {...sheetProps} onDismiss={() => handleChange(-1)}>{content}</BottomSheetModal>
    : <BottomSheet ref={bottomSheetRef} {...sheetProps}>{content}</BottomSheet>;
}

export const RecourseReasonSheet = forwardRef(RecourseReasonSheetInner) as <
  Code extends string = string,
>(
  props: RecourseReasonSheetProps<Code> & { ref?: React.Ref<RecourseReasonSheetRef> },
) => React.ReactElement;

const styles = StyleSheet.create({
  background: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  handleIndicator: {
    backgroundColor: colors.borderStrong,
    width: 40,
    height: 4,
  },
  content: {
    padding: spacing.lg,
  },
  title: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 20,
    color: colors.charcoal,
    marginBottom: spacing.xs,
  },
  intro: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.foregroundSecondary,
    marginBottom: spacing.lg,
  },
  reasonList: {
    gap: spacing.sm,
  },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  reasonItemActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  reasonText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.charcoal,
  },
  reasonTextActive: {
    fontFamily: fonts.sansMedium,
    color: colors.primary,
  },
  detailsBlock: {
    marginTop: spacing.lg,
  },
  detailsLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
    marginBottom: spacing.sm,
  },
  detailsInput: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: spacing.md,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.charcoal,
    minHeight: 96,
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.warningLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  footerNoteText: {
    flex: 1,
  },
  footerNoteTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
    marginBottom: spacing.xs,
  },
  footerNoteBody: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.foregroundSecondary,
  },
  submitButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rust,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: spacing.lg,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 1.5,
    color: colors.cream,
    textTransform: 'uppercase',
  },
});
