import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import {
    Dimensions,
    Modal,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import {
    Gesture,
    GestureDetector,
    GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { colors } from '@/constants/theme';
import { track } from '@/lib/analytics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ArticleImage {
  url: string;
  blurhash?: string;
}

interface ImageGalleryProps {
  images: ArticleImage[];
  onImageIndexChange?: (index: number) => void;
  /** When provided, opening the full-screen zoom emits `article_image_zoomed`. */
  articleId?: string;
}

// ─── Animated Dot ───
interface AnimatedDotProps {
  index: number;
  currentIndex: number;
  total: number;
}

const AnimatedDot: React.FC<AnimatedDotProps> = ({ index, currentIndex }) => {
  const isActive = index === currentIndex;
  const width = useSharedValue(isActive ? 20 : 6);
  const opacity = useSharedValue(isActive ? 1 : 0.45);

  useEffect(() => {
    width.value = withTiming(isActive ? 20 : 6, {
      duration: 200,
      easing: Easing.out(Easing.ease),
    });
    opacity.value = withTiming(isActive ? 1 : 0.45, { duration: 200 });
  }, [isActive]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: width.value,
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.dot,
        animatedStyle,
        isActive && styles.activeDot,
      ]}
    />
  );
};

// ─── Main Component ───
const ImageGallery: React.FC<ImageGalleryProps> = ({ images, onImageIndexChange }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isZoomModalVisible, setIsZoomModalVisible] = useState(false);
  const scale = useSharedValue(1);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    const clampedIndex = Math.max(0, Math.min(index, images.length - 1));
    if (clampedIndex !== currentIndex) {
      setCurrentIndex(clampedIndex);
      onImageIndexChange?.(clampedIndex);
    }
  }, [currentIndex, images.length, onImageIndexChange]);

  const handleImagePress = useCallback((index: number) => {
    setCurrentIndex(index);
    setIsZoomModalVisible(true);
  }, []);

  const handleCloseZoom = useCallback(() => {
    scale.value = withTiming(1, { duration: 250, easing: Easing.out(Easing.ease) });
    setIsZoomModalVisible(false);
  }, [scale]);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = event.scale;
    })
    .onEnd(() => {
      if (scale.value < 1) {
        scale.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) });
      } else if (scale.value > 3) {
        scale.value = withTiming(3, { duration: 200, easing: Easing.out(Easing.ease) });
      }
    });

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
    };
  });

  return (
    <>
      {/* Main Gallery */}
      <View style={styles.container}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScroll}
          scrollEventThrottle={16}
        >
          {images.map((image, index) => (
            <Pressable key={index} onPress={() => handleImagePress(index)}>
              <Image
                source={{ uri: image.url }}
                style={styles.image}
                contentFit="cover"
                transition={300}
                placeholder={image.blurhash ? { blurhash: image.blurhash } : undefined}
              />
            </Pressable>
          ))}
        </ScrollView>

        {/* Animated dots */}
        {images.length > 1 && (
          <View style={styles.dotsContainer}>
            {images.map((_, index) => (
              <AnimatedDot
                key={index}
                index={index}
                currentIndex={currentIndex}
                total={images.length}
              />
            ))}
          </View>
        )}
      </View>

      {/* Zoom Modal — Full-screen pinch-to-zoom */}
      <Modal
        visible={isZoomModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseZoom}
      >
        <View style={styles.modalContainer}>
          <StatusBar style="light" />
          <View style={styles.modalHeader}>
            <Text style={styles.modalCounter}>
              {currentIndex + 1} / {images.length}
            </Text>
            <Pressable onPress={handleCloseZoom} style={styles.closeButton}>
              <Ionicons name="close" size={28} color="#FFFFFF" />
            </Pressable>
          </View>

          <GestureHandlerRootView style={styles.gestureContainer}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={handleScroll}
              contentOffset={{ x: currentIndex * SCREEN_WIDTH, y: 0 }}
            >
              {images.map((image, index) => (
                <View key={index} style={styles.zoomImageContainer}>
                  <GestureDetector gesture={pinchGesture}>
                    <Animated.View style={[styles.zoomImageWrapper, animatedStyle]}>
                      <Image
                        source={{ uri: image.url }}
                        style={styles.zoomImage}
                        contentFit="contain"
                        transition={300}
                      />
                    </Animated.View>
                  </GestureDetector>
                </View>
              ))}
            </ScrollView>
          </GestureHandlerRootView>

          <View style={styles.modalFooter}>
            <Text style={styles.zoomHint}>Pincez pour zoomer</Text>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    backgroundColor: colors.surfaceWarm,
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH * 1.2,
    backgroundColor: colors.surfaceWarm,
  },
  dotsContainer: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
  },
  activeDot: {
    backgroundColor: '#FFFFFF',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
  },
  modalCounter: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  closeButton: {
    padding: 8,
  },
  gestureContainer: {
    flex: 1,
  },
  zoomImageContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT - 150,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomImageWrapper: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT - 150,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT - 150,
  },
  modalFooter: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  zoomHint: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
  },
});

export default ImageGallery;
