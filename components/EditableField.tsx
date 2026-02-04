import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Keyboard,
  KeyboardTypeOptions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ConfidenceIndicator from './ConfidenceIndicator';
import { ConfidenceLevel } from '@/types/ai';

interface EditableFieldProps {
  label: string;
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  confidenceLevel?: ConfidenceLevel;
  required?: boolean;
  keyboardType?: KeyboardTypeOptions;
  suffix?: string;
}

export default function EditableField({
  label,
  value,
  onSave,
  placeholder = '',
  multiline = false,
  maxLength,
  confidenceLevel,
  required = false,
  keyboardType = 'default',
  suffix,
}: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<TextInput>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      // Focus with slight delay for animation
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start();
    }
  }, [isEditing]);

  const handleStartEdit = () => {
    setEditValue(value);
    setIsEditing(true);
  };

  const handleCancel = () => {
    Keyboard.dismiss();
    setEditValue(value);
    setIsEditing(false);
  };

  const handleConfirm = () => {
    Keyboard.dismiss();
    onSave(editValue.trim());
    setIsEditing(false);
  };

  const isEmpty = !value || value.trim() === '';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.labelContainer}>
          <Text style={styles.label}>
            {label}
            {required && <Text style={styles.required}> *</Text>}
          </Text>
          {confidenceLevel && !isEditing && (
            <ConfidenceIndicator level={confidenceLevel} />
          )}
        </View>
        {!isEditing && (
          <TouchableOpacity
            onPress={handleStartEdit}
            style={styles.editButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="pencil" size={16} color="#6B7280" />
          </TouchableOpacity>
        )}
      </View>

      {/* Content */}
      {isEditing ? (
        <Animated.View style={[styles.editContainer, { opacity: fadeAnim }]}>
          {multiline ? (
            <TextInput
              ref={inputRef}
              style={[styles.input, styles.inputMultiline]}
              value={editValue}
              onChangeText={setEditValue}
              placeholder={placeholder}
              placeholderTextColor="#9CA3AF"
              multiline={true}
              maxLength={maxLength}
              textAlignVertical="top"
            />
          ) : (
            <View style={styles.inputRow}>
              <TextInput
                ref={inputRef}
                style={[
                  styles.input,
                  suffix && styles.inputWithSuffix,
                ]}
                value={editValue}
                onChangeText={setEditValue}
                placeholder={placeholder}
                placeholderTextColor="#9CA3AF"
                maxLength={maxLength}
                keyboardType={keyboardType}
              />
              {suffix && <Text style={styles.suffix}>{suffix}</Text>}
            </View>
          )}

          {/* Character count */}
          {maxLength && (
            <Text style={styles.charCount}>
              {editValue.length}/{maxLength}
            </Text>
          )}

          {/* Action buttons */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCancel}
            >
              <Text style={styles.cancelButtonText}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmButton}
              onPress={handleConfirm}
            >
              <Text style={styles.confirmButtonText}>Confirmer</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      ) : (
        <TouchableOpacity
          style={styles.displayContainer}
          onPress={handleStartEdit}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.displayText,
              isEmpty && styles.displayTextEmpty,
              multiline && styles.displayTextMultiline,
            ]}
            numberOfLines={multiline ? 4 : 1}
          >
            {isEmpty ? placeholder || `Ajouter ${label.toLowerCase()}` : `${value}${suffix ? ` ${suffix}` : ''}`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
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
  editButton: {
    padding: 4,
  },
  displayContainer: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  displayText: {
    fontSize: 16,
    color: '#1F2937',
    lineHeight: 22,
  },
  displayTextEmpty: {
    color: '#9CA3AF',
    fontStyle: 'italic',
  },
  displayTextMultiline: {
    lineHeight: 24,
  },
  editContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#8B5CF6',
    padding: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#1F2937',
    padding: 0,
    minHeight: 24,
  },
  inputMultiline: {
    minHeight: 100,
    lineHeight: 24,
  },
  inputWithSuffix: {
    marginRight: 4,
  },
  suffix: {
    fontSize: 16,
    color: '#6B7280',
    fontWeight: '500',
  },
  charCount: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'right',
    marginTop: 8,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
  },
  confirmButton: {
    backgroundColor: '#8B5CF6',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  confirmButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
