import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { AUTH_MESSAGES } from '@/constants/authMessages';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthRequired } from '@/contexts/AuthRequiredContext';
import { SavedSearchService } from '@/services/savedSearchService';
import { SearchFilters } from '@/types';

interface SaveSearchButtonProps {
  query: string;
  filters: Partial<SearchFilters>;
  onSaved?: () => void;
  style?: any;
}

/**
 * Button component to save a search with optional notification alerts.
 * Opens a modal to configure the saved search name and notification preferences.
 */
export default function SaveSearchButton({
  query,
  filters,
  onSaved,
  style,
}: SaveSearchButtonProps) {
  const { user } = useAuth();
  const { requireAuth } = useAuthRequired();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [searchName, setSearchName] = useState('');
  const [notifyNewItems, setNotifyNewItems] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const openModal = () => {
    // Generate default name
    const defaultName = generateDefaultName(query, filters);
    setSearchName(defaultName);
    setNotifyNewItems(false);
    setIsModalVisible(true);
  };

  const handleOpenModal = () => {
    if (!user) {
      requireAuth(openModal, AUTH_MESSAGES.saveSearch);
      return;
    }

    openModal();
  };

  const handleSave = async () => {
    if (!user) return;

    setIsSaving(true);

    try {
      await SavedSearchService.saveSearch(
        user.id,
        searchName.trim(),
        query,
        filters,
        notifyNewItems
      );

      setIsModalVisible(false);

      Alert.alert(
        'Recherche sauvegardée',
        notifyNewItems
          ? 'Vous serez notifié(e) lorsque de nouveaux articles correspondront à cette recherche.'
          : 'Retrouvez cette recherche dans votre profil.',
        [{ text: 'OK' }]
      );

      onSaved?.();
    } catch (error) {
      console.error('Error saving search:', error);
      Alert.alert(
        'Erreur',
        'Impossible de sauvegarder la recherche. Veuillez réessayer.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsSaving(false);
    }
  };

  const generateDefaultName = (q: string, f: Partial<SearchFilters>): string => {
    const parts: string[] = [];

    if (q) {
      parts.push(q);
    }

    if (f.categoryIds && f.categoryIds.length > 0) {
      parts.push(f.categoryIds[f.categoryIds.length - 1]);
    }

    if (f.brands && f.brands.length > 0) {
      parts.push(f.brands[0]);
    }

    if (parts.length === 0) {
      return 'Ma recherche';
    }

    return parts.slice(0, 2).join(' - ');
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.button, style]}
        onPress={handleOpenModal}
        activeOpacity={0.7}
      >
        <Ionicons name="bookmark-outline" size={20} color="#F79F24" />
        <Text style={styles.buttonText}>Sauvegarder</Text>
      </TouchableOpacity>

      <Modal
        visible={isModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIsModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setIsModalVisible(false)} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#1C1C1E" />
            </Pressable>
            <Text style={styles.modalTitle}>Sauvegarder la recherche</Text>
            <View style={styles.placeholder} />
          </View>

          {/* Content */}
          <View style={styles.modalContent}>
            {/* Search Name */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Nom de la recherche</Text>
              <TextInput
                style={styles.textInput}
                value={searchName}
                onChangeText={setSearchName}
                placeholder="Ex: Nike Air Max taille 42"
                placeholderTextColor="#8E8E93"
                autoCapitalize="sentences"
                maxLength={50}
              />
            </View>

            {/* Notification Toggle */}
            <View style={styles.switchRow}>
              <View style={styles.switchLabel}>
                <Ionicons name="notifications-outline" size={22} color="#1C1C1E" />
                <View style={styles.switchTextContainer}>
                  <Text style={styles.switchTitle}>Alertes nouveautés</Text>
                  <Text style={styles.switchSubtitle}>
                    Recevoir une notification quand de nouveaux articles correspondent
                  </Text>
                </View>
              </View>
              <Switch
                value={notifyNewItems}
                onValueChange={setNotifyNewItems}
                trackColor={{ false: '#E5E5EA', true: '#F79F24' }}
                thumbColor="#FFFFFF"
              />
            </View>

            {/* Search Summary */}
            <View style={styles.summaryContainer}>
              <Text style={styles.summaryTitle}>Résumé de la recherche</Text>
              {query ? (
                <View style={styles.summaryRow}>
                  <Ionicons name="search" size={16} color="#8E8E93" />
                  <Text style={styles.summaryText}>"{query}"</Text>
                </View>
              ) : null}
              {filters.categoryIds && filters.categoryIds.length > 0 && (
                <View style={styles.summaryRow}>
                  <Ionicons name="folder-outline" size={16} color="#8E8E93" />
                  <Text style={styles.summaryText}>
                    Catégorie: {filters.categoryIds[filters.categoryIds.length - 1]}
                  </Text>
                </View>
              )}
              {filters.brands && filters.brands.length > 0 && (
                <View style={styles.summaryRow}>
                  <Ionicons name="pricetag-outline" size={16} color="#8E8E93" />
                  <Text style={styles.summaryText}>
                    Marques: {filters.brands.join(', ')}
                  </Text>
                </View>
              )}
              {(filters.minPrice !== undefined || filters.maxPrice !== undefined) && (
                <View style={styles.summaryRow}>
                  <Ionicons name="cash-outline" size={16} color="#8E8E93" />
                  <Text style={styles.summaryText}>
                    Prix: {filters.minPrice ?? 0}€ - {filters.maxPrice ?? '∞'}€
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Save Button */}
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={isSaving || !searchName.trim()}
              activeOpacity={0.8}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="bookmark" size={20} color="#FFFFFF" />
                  <Text style={styles.saveButtonText}>Sauvegarder</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF5E6',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F79F24',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  closeButton: {
    padding: 4,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  placeholder: {
    width: 32,
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  inputGroup: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1C1C1E',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#F2F2F7',
  },
  switchLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  switchTextContainer: {
    marginLeft: 12,
    flex: 1,
  },
  switchTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  switchSubtitle: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 2,
  },
  summaryContainer: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#F9F9F9',
    borderRadius: 12,
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  summaryText: {
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  modalFooter: {
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F79F24',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
