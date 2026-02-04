import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { AI_CONFIG } from '@/config/aiConfig';
import { AIAnalysisError, AnalysisPhase, RecoveryOption } from '@/types/ai';

interface AIAnalysisLoaderProps {
  visible: boolean;
  imageUri?: string;
  onCancel: () => void;
  onManualEntry: () => void;
  onRetry?: () => void;
  onChangePhotos?: () => void;
  error?: AIAnalysisError | string;
  progress?: number;
  phase?: AnalysisPhase;
  phaseMessage?: string;
}

// Phase-specific messages
const PHASE_MESSAGES: Record<AnalysisPhase, string[]> = {
  upload: [
    'Envoi des images...',
    'Preparation des photos...',
  ],
  category: [
    'Detection de la categorie...',
    'Analyse du type de produit...',
  ],
  analysis: [
    'Analyse en cours...',
    'Detection des couleurs...',
    'Identification des materiaux...',
    'Evaluation de l\'etat...',
    'Generation du titre...',
  ],
  brand: [
    'Identification de la marque...',
    'Recherche dans la base de donnees...',
  ],
  validation: [
    'Validation finale...',
    'Preparation des resultats...',
  ],
};

// Default loading messages (fallback)
const LOADING_MESSAGES = [
  'Analyse de l\'image en cours...',
  'Detection des couleurs...',
  'Identification de la categorie...',
  'Generation du titre...',
  'Estimation de l\'etat...',
];

// Recovery option configurations
const RECOVERY_OPTIONS: Record<RecoveryOption, { icon: string; label: string; color: string }> = {
  retry: {
    icon: 'refresh',
    label: 'Reessayer',
    color: '#8B5CF6',
  },
  manual_entry: {
    icon: 'create-outline',
    label: 'Remplir manuellement',
    color: '#8B5CF6',
  },
  change_photos: {
    icon: 'camera-outline',
    label: 'Changer les photos',
    color: '#F59E0B',
  },
};

export default function AIAnalysisLoader({
  visible,
  imageUri,
  onCancel,
  onManualEntry,
  onRetry,
  onChangePhotos,
  error,
  progress,
  phase,
  phaseMessage,
}: AIAnalysisLoaderProps) {
  const insets = useSafeAreaInsets();
  const [currentMessage, setCurrentMessage] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const sparkleAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Parse error (support both string and AIAnalysisError)
  const parsedError: AIAnalysisError | null = error
    ? typeof error === 'string'
      ? { code: 'API_ERROR', message: error, title: 'Erreur', recoveryOptions: ['retry', 'manual_entry'] }
      : error
    : null;

  // Get error info from config if available
  const errorInfo = parsedError?.code
    ? AI_CONFIG.errors[parsedError.code as keyof typeof AI_CONFIG.errors]
    : null;

  // Get current phase messages
  const messages = phase && PHASE_MESSAGES[phase]
    ? PHASE_MESSAGES[phase]
    : LOADING_MESSAGES;

  // Rotate through messages
  useEffect(() => {
    if (!visible || parsedError) return;

    const interval = setInterval(() => {
      setCurrentMessage((prev) => (prev + 1) % messages.length);
    }, 2000);

    return () => clearInterval(interval);
  }, [visible, parsedError, messages.length, phase]);

  // Reset message index when phase changes
  useEffect(() => {
    setCurrentMessage(0);
  }, [phase]);

  // Animate progress bar
  useEffect(() => {
    if (progress !== undefined) {
      Animated.timing(progressAnim, {
        toValue: progress / 100,
        duration: 300,
        useNativeDriver: false,
      }).start();
      setDisplayProgress(progress);
    }
  }, [progress]);

  // Pulse animation
  useEffect(() => {
    if (!visible) return;

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );

    pulse.start();
    return () => pulse.stop();
  }, [visible, pulseAnim]);

  // Sparkle rotation animation
  useEffect(() => {
    if (!visible) return;

    const rotate = Animated.loop(
      Animated.timing(sparkleAnim, {
        toValue: 1,
        duration: 3000,
        useNativeDriver: true,
      })
    );

    rotate.start();
    return () => rotate.stop();
  }, [visible, sparkleAnim]);

  const sparkleRotate = sparkleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  // Handle recovery option press
  const handleRecoveryOption = (option: RecoveryOption) => {
    switch (option) {
      case 'retry':
        onRetry?.();
        break;
      case 'manual_entry':
        onManualEntry();
        break;
      case 'change_photos':
        onChangePhotos?.();
        break;
    }
  };

  // Get recovery options to display
  const recoveryOptions: RecoveryOption[] = parsedError?.recoveryOptions || ['retry', 'manual_entry'];

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Background blur effect */}
        <View style={styles.backdrop} />

        <View style={styles.content}>
          {/* Image preview with overlay */}
          <View style={styles.imageContainer}>
            {imageUri && (
              <Image
                source={{ uri: imageUri }}
                style={styles.image}
                contentFit="cover"
              />
            )}
            <View style={[
              styles.imageOverlay,
              parsedError && styles.imageOverlayError
            ]} />

            {/* Animated sparkle icon or error icon */}
            {parsedError ? (
              <View style={styles.errorIconContainer}>
                <Ionicons
                  name={(errorInfo?.icon || 'alert-circle') as any}
                  size={48}
                  color="#EF4444"
                />
              </View>
            ) : (
              <Animated.View
                style={[
                  styles.sparkleContainer,
                  {
                    transform: [
                      { scale: pulseAnim },
                      { rotate: sparkleRotate },
                    ],
                  },
                ]}
              >
                <Ionicons name="sparkles" size={48} color="#8B5CF6" />
              </Animated.View>
            )}
          </View>

          {/* Progress bar (only when not error and progress available) */}
          {!parsedError && progress !== undefined && (
            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <Animated.View
                  style={[
                    styles.progressFill,
                    { width: progressWidth },
                  ]}
                />
              </View>
              <Text style={styles.progressText}>{displayProgress}%</Text>
            </View>
          )}

          {/* Status section */}
          <View style={styles.statusSection}>
            {parsedError ? (
              // Error state
              <>
                <Text style={styles.errorTitle}>
                  {errorInfo?.title || parsedError.title || 'Erreur d\'analyse'}
                </Text>
                <Text style={styles.errorMessage}>
                  {parsedError.message}
                </Text>
              </>
            ) : (
              // Loading state
              <>
                <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                  <View style={styles.loadingDots}>
                    {[0, 1, 2].map((i) => (
                      <View
                        key={i}
                        style={[
                          styles.dot,
                          currentMessage % 3 === i && styles.dotActive,
                        ]}
                      />
                    ))}
                  </View>
                </Animated.View>
                <Text style={styles.loadingTitle}>IA en action</Text>
                <Text style={styles.loadingMessage}>
                  {phaseMessage || messages[currentMessage]}
                </Text>
              </>
            )}
          </View>

          {/* Action buttons */}
          <View style={styles.actions}>
            {parsedError ? (
              // Error recovery buttons
              <>
                {recoveryOptions.map((option, index) => {
                  const config = RECOVERY_OPTIONS[option];
                  const isPrimary = index === 0;

                  // Skip if no handler available
                  if (option === 'retry' && !onRetry) return null;
                  if (option === 'change_photos' && !onChangePhotos) return null;

                  return (
                    <TouchableOpacity
                      key={option}
                      style={[
                        styles.actionButton,
                        isPrimary
                          ? styles.actionButtonPrimary
                          : styles.actionButtonSecondary,
                      ]}
                      onPress={() => handleRecoveryOption(option)}
                    >
                      <Ionicons
                        name={config.icon as any}
                        size={20}
                        color={isPrimary ? '#FFFFFF' : config.color}
                      />
                      <Text
                        style={[
                          styles.actionButtonText,
                          isPrimary
                            ? styles.actionButtonTextPrimary
                            : styles.actionButtonTextSecondary,
                        ]}
                      >
                        {config.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                {/* Cancel button for errors */}
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={onCancel}
                >
                  <Text style={styles.cancelButtonText}>Annuler</Text>
                </TouchableOpacity>
              </>
            ) : (
              // Loading cancel button
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={onCancel}
              >
                <Text style={styles.cancelButtonText}>Annuler</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
  content: {
    width: '85%',
    maxWidth: 340,
    alignItems: 'center',
  },
  imageContainer: {
    width: 200,
    height: 200,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 24,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(139, 92, 246, 0.3)',
  },
  imageOverlayError: {
    backgroundColor: 'rgba(239, 68, 68, 0.3)',
  },
  sparkleContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -24,
    marginLeft: -24,
  },
  errorIconContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -24,
    marginLeft: -24,
  },

  // Progress bar styles
  progressContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    gap: 12,
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#8B5CF6',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    minWidth: 40,
    textAlign: 'right',
  },

  statusSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  loadingDots: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  dotActive: {
    backgroundColor: '#8B5CF6',
  },
  loadingTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  loadingMessage: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#EF4444',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 20,
  },

  // Action buttons
  actions: {
    width: '100%',
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 12,
  },
  actionButtonPrimary: {
    backgroundColor: '#8B5CF6',
  },
  actionButtonSecondary: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  actionButtonTextPrimary: {
    color: '#FFFFFF',
  },
  actionButtonTextSecondary: {
    color: '#FFFFFF',
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  cancelButtonText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 16,
  },
});
