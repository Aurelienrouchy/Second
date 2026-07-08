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
  View,
} from 'react-native';

import { AUTH_MESSAGES } from '@/constants/authMessages';
import { useUser } from '@/hooks/useAuth';
import { useRequireAuth } from '@/hooks/useAuthRequired';
import { getLeafCategoryLabel } from '@/data/categories-v2';
import { track } from '@/lib/analytics';
import { SavedSearchService } from '@/services/savedSearchService';
import { SearchFilters } from '@/types';
import { colors } from '@/constants/theme';

/** Active filter dimension names for a saved-search snapshot. */
function filterKeysOf(f: Partial<SearchFilters> & { categoryIds?: string[] }): string[] {
  const keys: string[] = [];
  if ((f.categoryIds?.length ?? 0) > 0) keys.push('category');
  if ((f.colors?.length ?? 0) > 0) keys.push('colors');
  if ((f.sizes?.length ?? 0) > 0) keys.push('sizes');
  if ((f.materials?.length ?? 0) > 0) keys.push('materials');
  if ((f.brands?.length ?? 0) > 0) keys.push('brands');
  if (f.condition) keys.push('condition');
  if (f.minPrice !== undefined || f.maxPrice !== undefined) keys.push('price');
  if (f.sortBy && f.sortBy !== 'recent') keys.push('sort');
  return keys;
}

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
function SaveSearchButtonComponent({
  query,
  filters,
  onSaved,
  style,
}: SaveSearchButtonProps) {
  const user = useUser();
  const { requireAuth } = useRequireAuth();
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
      if (__DEV__) console.error('Error saving search:', error);
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
      const categoryLabel = getLeafCategoryLabel(f.categoryIds);
      parts.push(categoryLabel || f.categoryIds[f.categoryIds.length - 1]);
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
      <Pressable
        style={({ pressed }) => [styles.button, style, pressed && { opacity: 0.7 }]}
        onPress={handleOpenModal}
      >
        <Ionicons name="bookmark-outline" size={20} color={colors.primary} />
        <Text style={styles.buttonText}>Sauvegarder</Text>
      </Pressable>

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
              <Ionicons name="close" size={24} color={colors.foreground} />
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
                placeholderTextColor={colors.muted}
                autoCapitalize="sentences"
                maxLength={50}
              />
            </View>

            {/* Notification Toggle */}
            <View style={styles.switchRow}>
              <View style={styles.switchLabel}>
                <Ionicons name="notifications-outline" size={22} color={colors.foreground} />
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
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            </View>

            {/* Search Summary */}
            <View style={styles.summaryContainer}>
              <Text style={styles.summaryTitle}>Résumé de la recherche</Text>
              {query ? (
                <View style={styles.summaryRow}>
                  <Ionicons name="search" size={16} color={colors.muted} />
                  <Text style={styles.summaryText}>"{query}"</Text>
                </View>
              ) : null}
              {filters.categoryIds && filters.categoryIds.length > 0 && (
                <View style={styles.summaryRow}>
                  <Ionicons name="folder-outline" size={16} color={colors.muted} />
                  <Text style={styles.summaryText}>
                    Catégorie: {getLeafCategoryLabel(filters.categoryIds) || filters.categoryIds[filters.categoryIds.length - 1]}
                  </Text>
                </View>
              )}
              {filters.brands && filters.brands.length > 0 && (
                <View style={styles.summaryRow}>
                  <Ionicons name="pricetag-outline" size={16} color={colors.muted} />
                  <Text style={styles.summaryText}>
                    Marques: {filters.brands.join(', ')}
                  </Text>
                </View>
              )}
              {(filters.minPrice !== undefined || filters.maxPrice !== undefined) && (
                <View style={styles.summaryRow}>
                  <Ionicons name="cash-outline" size={16} color={colors.muted} />
                  <Text style={styles.summaryText}>
                    Prix: {filters.minPrice ?? 0} $ - {filters.maxPrice ?? '∞'} $
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Save Button */}
          <View style={styles.modalFooter}>
            <Pressable
              style={({ pressed }) => [
                styles.saveButton,
                isSaving && styles.saveButtonDisabled,
                pressed && { opacity: 0.8 },
              ]}
              onPress={handleSave}
              disabled={isSaving || !searchName.trim()}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="bookmark" size={20} color="#FFFFFF" />
                  <Text style={styles.saveButtonText}>Sauvegarder</Text>
                </>
              )}
            </Pressable>
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
    color: colors.primary,
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
    borderBottomColor: colors.surfaceWarm,
  },
  closeButton: {
    padding: 4,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.foreground,
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
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.foreground,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.surfaceWarm,
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
    color: colors.foreground,
  },
  switchSubtitle: {
    fontSize: 13,
    color: colors.muted,
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
    color: colors.foreground,
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
    borderTopColor: colors.surfaceWarm,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
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

export default React.memo(SaveSearchButtonComponent);
