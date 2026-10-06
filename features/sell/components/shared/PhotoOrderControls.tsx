import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, spacing } from '@/constants/theme';

interface PhotoOrderControlsProps {
  photoCount: number;
  disabled: boolean;
  onMove: (from: number, to: number) => void;
}

export const PhotoOrderControls = React.memo(function PhotoOrderControls({ photoCount, disabled, onMove }: PhotoOrderControlsProps) {
  if (photoCount < 2) return null;
  return (
    <View style={styles.container}>
      <Text style={styles.hint}>Réordonner les photos · la première est principale</Text>
      {Array.from({ length: photoCount }, (_, index) => (
        <View key={index} style={styles.row}>
          <Text style={styles.label}>Photo {index + 1}</Text>
          <Pressable
            testID={`sell-photo-move-up-${index}`}
            accessibilityLabel={`Avancer la photo ${index + 1}`}
            disabled={disabled || index === 0}
            style={[styles.button, (disabled || index === 0) && styles.disabled]}
            onPress={() => onMove(index, index - 1)}
          >
            <Ionicons name="arrow-up" size={18} color={colors.charcoal} />
          </Pressable>
          <Pressable
            testID={`sell-photo-move-down-${index}`}
            accessibilityLabel={`Reculer la photo ${index + 1}`}
            disabled={disabled || index === photoCount - 1}
            style={[styles.button, (disabled || index === photoCount - 1) && styles.disabled]}
            onPress={() => onMove(index, index + 1)}
          >
            <Ionicons name="arrow-down" size={18} color={colors.charcoal} />
          </Pressable>
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { marginBottom: spacing.md },
  hint: { fontFamily: fonts.sans, fontSize: 12, color: colors.muted, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { flex: 1, fontFamily: fonts.sansMedium, fontSize: 13, color: colors.charcoal },
  button: { padding: 10 },
  disabled: { opacity: 0.3 },
});
