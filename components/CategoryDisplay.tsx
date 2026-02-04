import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ConfidenceIndicator from './ConfidenceIndicator';
import { ConfidenceLevel } from '@/types/ai';

interface CategoryDisplayProps {
  icon: string;
  name: string;
  context?: string; // e.g., "dans Femmes · Vêtements"
  onPress: () => void;
  confidenceLevel?: ConfidenceLevel;
  required?: boolean;
  isEmpty?: boolean;
}

export default function CategoryDisplay({
  icon,
  name,
  context,
  onPress,
  confidenceLevel,
  required = true,
  isEmpty = false,
}: CategoryDisplayProps) {
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.labelContainer}>
          <Text style={styles.label}>
            Catégorie
            {required && <Text style={styles.required}> *</Text>}
          </Text>
          {confidenceLevel && !isEmpty && (
            <ConfidenceIndicator level={confidenceLevel} />
          )}
        </View>
      </View>

      {/* Category selector */}
      <TouchableOpacity
        style={[styles.selector, isEmpty && styles.selectorEmpty]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {isEmpty ? (
          <View style={styles.emptyContent}>
            <Ionicons name="pricetag-outline" size={24} color="#9CA3AF" />
            <Text style={styles.emptyText}>Sélectionner une catégorie</Text>
          </View>
        ) : (
          <View style={styles.content}>
            {/* Icon + Name */}
            <View style={styles.mainRow}>
              <Text style={styles.icon}>{icon}</Text>
              <Text style={styles.name}>{name}</Text>
            </View>

            {/* Context */}
            {context && (
              <Text style={styles.context} numberOfLines={1}>
                {context}
              </Text>
            )}
          </View>
        )}

        {/* Chevron */}
        <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  required: {
    color: '#EF4444',
  },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  selectorEmpty: {
    borderStyle: 'dashed',
  },
  content: {
    flex: 1,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  icon: {
    fontSize: 24,
  },
  name: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1F2937',
  },
  context: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
    marginLeft: 34, // Align with name
  },
  emptyContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 16,
    color: '#9CA3AF',
  },
});
