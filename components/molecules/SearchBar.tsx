import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { colors, fonts, radius, spacing } from '@/constants/theme';

export interface SearchBarProps {
  placeholder?: string;
  onPress?: () => void;
  onCameraPress?: () => void;
  style?: ViewStyle;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  placeholder = 'Veste, sneakers, robe…',
  onPress,
  onCameraPress,
  style,
}) => {
  return (
    <View style={[styles.container, style]}>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor="rgba(245,240,232,0.35)"
        editable={false}
        onPressIn={onPress}
      />
      <Pressable style={styles.cameraButton} onPress={onCameraPress}>
        <Ionicons name="camera-outline" size={22} color={colors.cream} />
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245,240,232,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,240,232,0.12)',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    height: 48,
    gap: spacing.xs,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: 'rgba(245,240,232,0.7)',
    fontFamily: fonts.sans,
  },
  cameraButton: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.rust,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
