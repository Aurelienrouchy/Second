import {
  ModerationService,
  ReportReason,
  ReportReasonLabels,
  ReportType,
} from '@/services/moderationService';
import { useAuthStore } from '@/store/authStore';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
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
import { colors } from '@/constants/theme';
import { track } from '@/lib/analytics';

export type ReportSourceScreen = 'chat' | 'public_profile' | 'article_detail';

export interface ReportBottomSheetRef {
  open: (
    type: ReportType,
    targetId: string,
    source: ReportSourceScreen,
    targetOwnerId?: string,
  ) => void;
  close: () => void;
}

interface Props {
  onReportSubmitted?: () => void;
}

const ReportBottomSheet = forwardRef<ReportBottomSheetRef, Props>(
  ({ onReportSubmitted }, ref) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const user = useAuthStore((s) => s.user);
    const [isOpen, setIsOpen] = useState(false);

    const [targetType, setTargetType] = useState<ReportType>('user');
    const [targetId, setTargetId] = useState<string>('');
    const [targetOwnerId, setTargetOwnerId] = useState<string | undefined>();
    const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState<'reason' | 'description'>('reason');
    // Latest step + submit flag for the abandon event fired from onChange.
    const stepRef = useRef<'reason' | 'description'>('reason');
    stepRef.current = step;
    const submittedRef = useRef(false);

    const snapPoints = useMemo(() => ['60%', '80%'], []);

    useImperativeHandle(ref, () => ({
      open: (type: ReportType, id: string, source: ReportSourceScreen, ownerId?: string) => {
        setTargetType(type);
        setTargetId(id);
        setTargetOwnerId(ownerId);
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
      close: () => {
        bottomSheetRef.current?.close();
      },
    }));

    const renderBackdrop = useCallback(
      (props: any) => (
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

    const handleSubmit = async () => {
      if (!user || !selectedReason) return;

      setLoading(true);
      try {
        await ModerationService.createReport(
          user.id,
          user.displayName || 'Utilisateur',
          targetType,
          targetId,
          selectedReason,
          description.trim() || undefined,
          targetOwnerId
        );

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
                bottomSheetRef.current?.close();
                onReportSubmitted?.();
              },
            },
          ]
        );
      } catch (error: any) {
        track('report_submitted', {
          target_type: targetType,
          target_id: targetId,
          reason: selectedReason,
          has_description: description.trim().length > 0,
          success: false,
        });
        Alert.alert('Erreur', error.message || 'Une erreur est survenue');
      } finally {
        setLoading(false);
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
            <View style={styles.header}>
              <Ionicons name="flag" size={24} color={colors.danger} />
              <Text style={styles.title}>{getTitle()}</Text>
            </View>

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
                  textAlignVertical="top"
                />

                <TouchableOpacity
                  style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                  onPress={handleSubmit}
                  disabled={loading}
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
          </BottomSheetScrollView>
      </BottomSheet>
    );
  }
);

const styles = StyleSheet.create({
  bottomSheetBackground: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handleIndicator: {
    backgroundColor: colors.border,
    width: 40,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.foreground,
    marginLeft: 10,
  },
  subtitle: {
    fontSize: 14,
    color: colors.foregroundSecondary,
    marginBottom: 20,
  },
  reasonsList: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: 12,
    overflow: 'hidden',
  },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reasonText: {
    fontSize: 15,
    color: colors.foreground,
  },
  selectedReasonBox: {
    backgroundColor: colors.dangerLight,
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.dangerLight,
  },
  selectedReasonLabel: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 4,
  },
  selectedReasonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.danger,
  },
  changeButton: {
    position: 'absolute',
    right: 12,
    top: 12,
  },
  changeButtonText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '500',
  },
  descriptionLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.foreground,
    marginBottom: 8,
  },
  descriptionInput: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: colors.foreground,
    minHeight: 100,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  submitButton: {
    backgroundColor: colors.danger,
    borderRadius: 8,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: colors.muted,
  },
  submitButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceWarm,
    borderRadius: 8,
    padding: 12,
    marginTop: 20,
  },
  infoText: {
    fontSize: 12,
    color: colors.foregroundSecondary,
    marginLeft: 8,
    flex: 1,
    lineHeight: 18,
  },
});

export default ReportBottomSheet;
