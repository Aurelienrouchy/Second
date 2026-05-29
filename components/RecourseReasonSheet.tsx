/**
 * RecourseReasonSheet — reason selector for buyer recourse flows.
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
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
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
}

interface RecourseReasonSheetProps<Code extends string = string> {
  title: string;
  intro: string;
  reasons: readonly RecourseReasonOption<Code>[];
  /** Optional note shown above the submit button (e.g. return-fee disclaimer). */
  footerNote?: { title: string; body: string };
  /** Shows the free-text "Décrivez le problème" field when true. */
  showDetailsField?: boolean;
  submitLabel: string;
  isSubmitting?: boolean;
  onSubmit: (code: Code, details: string) => void;
}

function RecourseReasonSheetInner<Code extends string = string>(
  {
    title,
    intro,
    reasons,
    footerNote,
    showDetailsField = false,
    submitLabel,
    isSubmitting = false,
    onSubmit,
  }: RecourseReasonSheetProps<Code>,
  ref: React.Ref<RecourseReasonSheetRef>,
) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const insets = useSafeAreaInsets();
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<Code | null>(null);
  const [details, setDetails] = useState('');

  const snapPoints = useMemo(
    () => (showDetailsField ? ['70%', '90%'] : ['55%', '85%']),
    [showDetailsField],
  );

  useImperativeHandle(ref, () => ({
    present: () => {
      setSelected(null);
      setDetails('');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setIsOpen(true);
    },
    dismiss: () => {
      bottomSheetRef.current?.close();
    },
  }));

  const handleChange = useCallback((index: number) => {
    if (index === -1) setIsOpen(false);
  }, []);

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const handleSubmit = useCallback(() => {
    if (!selected || isSubmitting) return;
    onSubmit(selected, details.trim());
  }, [selected, isSubmitting, onSubmit, details]);

  if (!isOpen) return null;

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={0}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      enableDynamicSizing={false}
      topInset={insets.top}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.background}
      onChange={handleChange}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="none"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
      >
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.intro}>{intro}</Text>

        <View style={styles.reasonList}>
          {reasons.map((reason) => {
            const isActive = selected === reason.code;
            return (
              <Pressable
                key={reason.code}
                style={[styles.reasonItem, isActive && styles.reasonItemActive]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSelected(reason.code);
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
              style={styles.detailsInput}
              placeholder="Donnez-nous quelques détails…"
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={4}
              value={details}
              onChangeText={setDetails}
              textAlignVertical="top"
            />
          </View>
        )}

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
          style={[
            styles.submitButton,
            (!selected || isSubmitting) && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!selected || isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.cream} />
          ) : (
            <Text style={styles.submitButtonText}>{submitLabel}</Text>
          )}
        </Pressable>
      </BottomSheetScrollView>
    </BottomSheet>
  );
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
