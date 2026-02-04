import { useAuth } from '@/contexts/AuthContext';
import {
  ModerationService,
  ReportReason,
  ReportReasonLabels,
  ReportType,
} from '@/services/moderationService';
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

export interface ReportBottomSheetRef {
  open: (type: ReportType, targetId: string, targetOwnerId?: string) => void;
  close: () => void;
}

interface Props {
  onReportSubmitted?: () => void;
}

const ReportBottomSheet = forwardRef<ReportBottomSheetRef, Props>(
  ({ onReportSubmitted }, ref) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const { user } = useAuth();

    const [targetType, setTargetType] = useState<ReportType>('user');
    const [targetId, setTargetId] = useState<string>('');
    const [targetOwnerId, setTargetOwnerId] = useState<string | undefined>();
    const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState<'reason' | 'description'>('reason');

    const snapPoints = useMemo(() => ['60%', '80%'], []);

    useImperativeHandle(ref, () => ({
      open: (type: ReportType, id: string, ownerId?: string) => {
        setTargetType(type);
        setTargetId(id);
        setTargetOwnerId(ownerId);
        setSelectedReason(null);
        setDescription('');
        setStep('reason');
        bottomSheetRef.current?.snapToIndex(0);
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

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.bottomSheetBackground}
        handleIndicatorStyle={styles.handleIndicator}
      >
        <BottomSheetScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Ionicons name="flag" size={24} color="#ff4757" />
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
                    <Ionicons name="chevron-forward" size={20} color="#ccc" />
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
                placeholderTextColor="#999"
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
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="send" size={18} color="#fff" />
                    <Text style={styles.submitButtonText}>Envoyer le signalement</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}

          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={20} color="#666" />
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
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handleIndicator: {
    backgroundColor: '#ddd',
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
    color: '#333',
    marginLeft: 10,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  reasonsList: {
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    overflow: 'hidden',
  },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  reasonText: {
    fontSize: 15,
    color: '#333',
  },
  selectedReasonBox: {
    backgroundColor: '#fff5f5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#ffe0e0',
  },
  selectedReasonLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  selectedReasonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ff4757',
  },
  changeButton: {
    position: 'absolute',
    right: 12,
    top: 12,
  },
  changeButtonText: {
    fontSize: 13,
    color: '#09B1BA',
    fontWeight: '500',
  },
  descriptionLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 8,
  },
  descriptionInput: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#333',
    minHeight: 100,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  submitButton: {
    backgroundColor: '#ff4757',
    borderRadius: 8,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#ccc',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    marginTop: 20,
  },
  infoText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 8,
    flex: 1,
    lineHeight: 18,
  },
});

export default ReportBottomSheet;
