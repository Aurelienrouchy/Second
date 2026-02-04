import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface SaveIndicatorProps {
  status: SaveStatus;
  visible?: boolean;
}

export default function SaveIndicator({
  status,
  visible = true,
}: SaveIndicatorProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    if (status === 'idle' || !visible) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
      return;
    }

    // Show indicator
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 50,
        friction: 7,
      }),
    ]).start();

    // Auto-hide after saved
    if (status === 'saved') {
      const timer = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [status, visible]);

  const getStatusConfig = () => {
    switch (status) {
      case 'saving':
        return {
          icon: 'cloud-upload-outline' as const,
          text: 'Sauvegarde...',
          color: '#6B7280',
          bgColor: '#F3F4F6',
        };
      case 'saved':
        return {
          icon: 'cloud-done' as const,
          text: 'Sauvegardé',
          color: '#059669',
          bgColor: '#D1FAE5',
        };
      case 'error':
        return {
          icon: 'cloud-offline-outline' as const,
          text: 'Erreur',
          color: '#DC2626',
          bgColor: '#FEE2E2',
        };
      default:
        return {
          icon: 'cloud-outline' as const,
          text: '',
          color: '#6B7280',
          bgColor: '#F3F4F6',
        };
    }
  };

  const config = getStatusConfig();

  if (status === 'idle') return null;

  return (
    <Animated.View
      style={[
        styles.container,
        { backgroundColor: config.bgColor },
        {
          opacity,
          transform: [{ scale }],
        },
      ]}
    >
      <Ionicons name={config.icon} size={14} color={config.color} />
      <Text style={[styles.text, { color: config.color }]}>{config.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  text: {
    fontSize: 12,
    fontWeight: '500',
  },
});
