import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ConfidenceLevel, ConfidenceScore } from '@/types/ai';

interface ConfidenceIndicatorProps {
  confidence?: ConfidenceScore | null;
  confidenceLevel?: ConfidenceLevel;
  level?: ConfidenceLevel; // Legacy prop for backward compatibility
  fromLabel?: boolean;
  size?: 'small' | 'medium';
  showLabel?: boolean;
  style?: any;
}

// Color scheme for confidence levels
const CONFIDENCE_COLORS = {
  high: {
    background: '#DCFCE7',
    text: '#166534',
    border: '#22C55E',
  },
  medium: {
    background: '#FEF3C7',
    text: '#92400E',
    border: '#F59E0B',
  },
  low: {
    background: '#FEE2E2',
    text: '#991B1B',
    border: '#EF4444',
  },
};

// Labels for confidence levels
const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  high: 'Fiable',
  medium: 'Probable',
  low: 'Incertain',
};

// Tooltip explanations
const CONFIDENCE_EXPLANATIONS: Record<ConfidenceLevel, string> = {
  high: "L'IA est tres confiante dans cette information. Elle a ete clairement identifiee dans l'image.",
  medium: "L'IA pense que cette information est correcte, mais vous devriez verifier.",
  low: "L'IA n'est pas sure de cette information. Nous vous recommandons de la verifier et de la corriger si necessaire.",
};

export default function ConfidenceIndicator({
  confidence,
  confidenceLevel,
  level, // Legacy prop
  fromLabel,
  size = 'small',
  showLabel = false,
  style,
}: ConfidenceIndicatorProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  // Get the confidence level (support multiple prop formats)
  const resolvedLevel = confidence?.level || confidenceLevel || level;
  const isFromLabel = confidence?.fromLabel || fromLabel;

  // Don't render if no confidence data
  if (!resolvedLevel) return null;

  const colors = CONFIDENCE_COLORS[resolvedLevel];
  const isSmall = size === 'small';

  const handleLongPress = () => {
    setShowTooltip(true);
  };

  return (
    <>
      <TouchableOpacity
        onLongPress={handleLongPress}
        delayLongPress={300}
        activeOpacity={0.7}
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
            paddingHorizontal: isSmall ? 6 : 10,
            paddingVertical: isSmall ? 2 : 4,
          },
          style,
        ]}
      >
        {/* Label badge (if from product label) */}
        {isFromLabel && (
          <View style={[styles.labelBadge, { marginRight: isSmall ? 4 : 6 }]}>
            <Ionicons
              name="pricetag"
              size={isSmall ? 10 : 12}
              color="#6D28D9"
            />
          </View>
        )}

        {/* Confidence icon */}
        <View style={styles.iconContainer}>
          {resolvedLevel === 'high' && (
            <Ionicons
              name="checkmark-circle"
              size={isSmall ? 12 : 14}
              color={colors.text}
            />
          )}
          {resolvedLevel === 'medium' && (
            <Ionicons
              name="help-circle"
              size={isSmall ? 12 : 14}
              color={colors.text}
            />
          )}
          {resolvedLevel === 'low' && (
            <Ionicons
              name="alert-circle"
              size={isSmall ? 12 : 14}
              color={colors.text}
            />
          )}
        </View>

        {/* Label text (optional) */}
        {showLabel && (
          <Text
            style={[
              styles.label,
              {
                color: colors.text,
                fontSize: isSmall ? 10 : 12,
                marginLeft: isSmall ? 4 : 6,
              },
            ]}
          >
            {isFromLabel ? 'Etiquette' : CONFIDENCE_LABELS[resolvedLevel]}
          </Text>
        )}
      </TouchableOpacity>

      {/* Tooltip Modal */}
      <Modal
        visible={showTooltip}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTooltip(false)}
      >
        <Pressable
          style={styles.tooltipOverlay}
          onPress={() => setShowTooltip(false)}
        >
          <View style={styles.tooltipContainer}>
            <View style={styles.tooltipHeader}>
              <View
                style={[
                  styles.tooltipBadge,
                  { backgroundColor: colors.background },
                ]}
              >
                <Text style={[styles.tooltipBadgeText, { color: colors.text }]}>
                  {isFromLabel ? "Extrait de l'etiquette" : CONFIDENCE_LABELS[resolvedLevel]}
                </Text>
              </View>
            </View>

            <Text style={styles.tooltipText}>
              {isFromLabel
                ? "Cette information a ete extraite directement de l'etiquette du produit visible sur l'une des photos."
                : CONFIDENCE_EXPLANATIONS[resolvedLevel]}
            </Text>

            {confidence && confidence.value !== undefined && (
              <View style={styles.confidenceBar}>
                <View
                  style={[
                    styles.confidenceBarFill,
                    {
                      width: `${Math.round(confidence.value * 100)}%`,
                      backgroundColor: colors.border,
                    },
                  ]}
                />
                <Text style={styles.confidenceBarText}>
                  Confiance: {Math.round(confidence.value * 100)}%
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.tooltipClose}
              onPress={() => setShowTooltip(false)}
            >
              <Text style={styles.tooltipCloseText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * Standalone component for "From Label" badge
 */
export function LabelBadge({ style }: { style?: any }) {
  return (
    <View style={[styles.labelBadgeStandalone, style]}>
      <Ionicons name="pricetag" size={12} color="#6D28D9" />
      <Text style={styles.labelBadgeText}>Etiquette</Text>
    </View>
  );
}

/**
 * Banner component for label detection
 */
export function LabelDetectedBanner({
  onPress,
  style,
}: {
  onPress?: () => void;
  style?: any;
}) {
  return (
    <TouchableOpacity
      style={[styles.labelBanner, style]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.labelBannerIcon}>
        <Ionicons name="pricetag" size={20} color="#6D28D9" />
      </View>
      <View style={styles.labelBannerContent}>
        <Text style={styles.labelBannerTitle}>Etiquette detectee</Text>
        <Text style={styles.labelBannerSubtitle}>
          Des informations ont ete extraites de l'etiquette du produit
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#A78BFA" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    fontWeight: '600',
  },
  labelBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#EDE9FE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  labelBadgeStandalone: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  labelBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6D28D9',
  },

  // Tooltip styles
  tooltipOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  tooltipContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 320,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  tooltipHeader: {
    marginBottom: 12,
  },
  tooltipBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  tooltipBadgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tooltipText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#4B5563',
    marginBottom: 16,
  },
  confidenceBar: {
    height: 24,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    justifyContent: 'center',
  },
  confidenceBarFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 12,
  },
  confidenceBarText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
    zIndex: 1,
  },
  tooltipClose: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  tooltipCloseText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },

  // Label banner styles
  labelBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F3FF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  labelBannerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EDE9FE',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  labelBannerContent: {
    flex: 1,
  },
  labelBannerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5B21B6',
    marginBottom: 2,
  },
  labelBannerSubtitle: {
    fontSize: 12,
    color: '#7C3AED',
  },
});
