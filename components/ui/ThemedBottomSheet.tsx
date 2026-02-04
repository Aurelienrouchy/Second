/**
 * ThemedBottomSheet Component
 * Design System: Luxe Français + Street
 *
 * Features:
 * - Glassmorphism backdrop (Revolut-style)
 * - Spring animations
 * - Haptic feedback on open
 */

import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  BottomSheetModal,
  BottomSheetModalProvider,
} from '@gorhom/bottom-sheet';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useMemo, forwardRef, useImperativeHandle, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
} from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { colors, radius, spacing, sizing, typography, shadows } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

interface ThemedBottomSheetProps {
  children: React.ReactNode;
  snapPoints?: (string | number)[];
  title?: string;
  onClose?: () => void;
  enablePanDownToClose?: boolean;
  showHandle?: boolean;
  showHeader?: boolean;
  headerRight?: React.ReactNode;
}

export interface ThemedBottomSheetRef {
  show: () => void;
  hide: () => void;
  snapToIndex: (index: number) => void;
}

// =============================================================================
// CUSTOM BACKDROP WITH BLUR
// =============================================================================

const CustomBackdrop: React.FC<any> = ({ animatedIndex, style }) => {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(animatedIndex.value, [-1, 0], [0, 1]),
  }));

  return (
    <Animated.View style={[style, styles.backdrop, animatedStyle]}>
      {Platform.OS === 'ios' ? (
        <BlurView
          style={StyleSheet.absoluteFill}
          intensity={20}
          tint="dark"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} />
      )}
    </Animated.View>
  );
};

// =============================================================================
// CUSTOM HANDLE
// =============================================================================

const CustomHandle: React.FC = () => (
  <View style={styles.handleContainer}>
    <View style={styles.handle} />
  </View>
);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const ThemedBottomSheet = forwardRef<ThemedBottomSheetRef, ThemedBottomSheetProps>(
  (
    {
      children,
      snapPoints: customSnapPoints,
      title,
      onClose,
      enablePanDownToClose = true,
      showHandle = true,
      showHeader = true,
      headerRight,
    },
    ref
  ) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const snapPoints = useMemo(
      () => customSnapPoints || ['50%', '90%'],
      [customSnapPoints]
    );

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      show: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        bottomSheetRef.current?.snapToIndex(0);
      },
      hide: () => {
        bottomSheetRef.current?.close();
      },
      snapToIndex: (index: number) => {
        bottomSheetRef.current?.snapToIndex(index);
      },
    }));

    // Callbacks
    const handleSheetChanges = useCallback(
      (index: number) => {
        if (index === -1 && onClose) {
          onClose();
        }
      },
      [onClose]
    );

    const handleClose = useCallback(() => {
      bottomSheetRef.current?.close();
    }, []);

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        onChange={handleSheetChanges}
        enablePanDownToClose={enablePanDownToClose}
        backdropComponent={CustomBackdrop}
        handleComponent={showHandle ? CustomHandle : null}
        backgroundStyle={styles.background}
        style={styles.sheet}
      >
        {/* Header */}
        {showHeader && title && (
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Pressable onPress={handleClose} hitSlop={8}>
                <Text style={styles.closeButton}>Fermer</Text>
              </Pressable>
            </View>
            <Text style={styles.title}>{title}</Text>
            <View style={styles.headerRight}>{headerRight}</View>
          </View>
        )}

        {/* Content */}
        <BottomSheetView style={styles.content}>{children}</BottomSheetView>
      </BottomSheet>
    );
  }
);

ThemedBottomSheet.displayName = 'ThemedBottomSheet';

// =============================================================================
// MODAL VERSION (for use with BottomSheetModalProvider)
// =============================================================================

export const ThemedBottomSheetModal = forwardRef<BottomSheetModal, ThemedBottomSheetProps>(
  (
    {
      children,
      snapPoints: customSnapPoints,
      title,
      onClose,
      enablePanDownToClose = true,
      showHandle = true,
      showHeader = true,
      headerRight,
    },
    ref
  ) => {
    const snapPoints = useMemo(
      () => customSnapPoints || ['50%', '90%'],
      [customSnapPoints]
    );

    const handleDismiss = useCallback(() => {
      onClose?.();
    }, [onClose]);

    return (
      <BottomSheetModal
        ref={ref}
        snapPoints={snapPoints}
        onDismiss={handleDismiss}
        enablePanDownToClose={enablePanDownToClose}
        backdropComponent={CustomBackdrop}
        handleComponent={showHandle ? CustomHandle : null}
        backgroundStyle={styles.background}
        style={styles.sheet}
      >
        {/* Header */}
        {showHeader && title && (
          <View style={styles.header}>
            <View style={styles.headerLeft} />
            <Text style={styles.title}>{title}</Text>
            <View style={styles.headerRight}>{headerRight}</View>
          </View>
        )}

        {/* Content */}
        <BottomSheetView style={styles.content}>{children}</BottomSheetView>
      </BottomSheetModal>
    );
  }
);

ThemedBottomSheetModal.displayName = 'ThemedBottomSheetModal';

// Re-export provider for convenience
export { BottomSheetModalProvider };

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sheet: {
    ...shadows.elevated,
  },
  background: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },

  // Handle
  handleContainer: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    alignItems: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    width: 60,
    alignItems: 'flex-start',
  },
  headerRight: {
    width: 60,
    alignItems: 'flex-end',
  },
  title: {
    fontFamily: typography.h3.fontFamily,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    color: colors.foreground,
    flex: 1,
    textAlign: 'center',
  },
  closeButton: {
    fontFamily: typography.label.fontFamily,
    fontSize: typography.label.fontSize,
    color: colors.primary,
  },

  // Content
  content: {
    flex: 1,
    padding: spacing.lg,
  },
});

export default ThemedBottomSheet;
