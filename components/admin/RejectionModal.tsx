import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

export interface RejectionModalRef {
  show: () => void;
  hide: () => void;
}

interface RejectionModalProps {
  shopName: string;
  onConfirm: (reason: string) => void;
}

const RejectionModal = forwardRef<RejectionModalRef, RejectionModalProps>(
  ({ shopName, onConfirm }, ref) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const [reason, setReason] = useState('');

    const snapPoints = React.useMemo(() => ['60%'], []);

    useImperativeHandle(ref, () => ({
      show: () => {
        bottomSheetRef.current?.expand();
        setReason('');
      },
      hide: () => {
        bottomSheetRef.current?.close();
      },
    }));

    const handleConfirm = () => {
      if (reason.trim()) {
        onConfirm(reason.trim());
        bottomSheetRef.current?.close();
      }
    };

    const renderBackdrop = useCallback(
      (props: any) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
      ),
      []
    );

    const predefinedReasons = [
      'Photos insuffisantes ou de mauvaise qualité',
      'Informations incomplètes',
      'Adresse non valide',
      'Type de boutique non approprié',
      'Suspicion de fraude',
    ];

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
      >
        <BottomSheetView style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerContent}>
              <Ionicons name="alert-circle-outline" size={24} color="#FF3B30" />
              <Text style={styles.title}>Rejeter la boutique</Text>
            </View>
            <TouchableOpacity
              onPress={() => bottomSheetRef.current?.close()}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={24} color="#1C1C1E" />
            </TouchableOpacity>
          </View>

          {/* Shop name */}
          <View style={styles.shopInfo}>
            <Text style={styles.shopName}>{shopName}</Text>
          </View>

          {/* Raisons prédéfinies */}
          <Text style={styles.sectionTitle}>Raisons fréquentes</Text>
          <View style={styles.reasonsList}>
            {predefinedReasons.map((predefinedReason, index) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.reasonChip,
                  reason === predefinedReason && styles.reasonChipSelected,
                ]}
                onPress={() => setReason(predefinedReason)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.reasonChipText,
                    reason === predefinedReason && styles.reasonChipTextSelected,
                  ]}
                >
                  {predefinedReason}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Input personnalisé */}
          <Text style={styles.sectionTitle}>Ou saisir une raison personnalisée</Text>
          <TextInput
            style={styles.input}
            placeholder="Expliquez la raison du rejet..."
            placeholderTextColor="#8E8E93"
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            maxLength={200}
          />
          <Text style={styles.charCount}>{reason.length}/200 caractères</Text>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => bottomSheetRef.current?.close()}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelButtonText}>Annuler</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.confirmButton,
                !reason.trim() && styles.confirmButtonDisabled,
              ]}
              onPress={handleConfirm}
              disabled={!reason.trim()}
              activeOpacity={0.7}
            >
              <Text style={styles.confirmButtonText}>Rejeter</Text>
            </TouchableOpacity>
          </View>
        </BottomSheetView>
      </BottomSheet>
    );
  }
);

RejectionModal.displayName = 'RejectionModal';

export default RejectionModal;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
    marginBottom: 16,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  shopInfo: {
    backgroundColor: '#F9F9F9',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  shopName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 12,
  },
  reasonsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  reasonChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#F2F2F7',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  reasonChipSelected: {
    backgroundColor: '#FFEBEE',
    borderColor: '#FF3B30',
  },
  reasonChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#1C1C1E',
  },
  reasonChipTextSelected: {
    color: '#FF3B30',
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    color: '#1C1C1E',
    minHeight: 100,
    marginBottom: 8,
  },
  charCount: {
    fontSize: 12,
    color: '#8E8E93',
    textAlign: 'right',
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  confirmButton: {
    flex: 1,
    backgroundColor: '#FF3B30',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: '#C7C7CC',
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

