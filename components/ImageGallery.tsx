import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useState } from 'react';
import {
    Dimensions,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { GestureHandlerRootView, PinchGestureHandler } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedGestureHandler,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ArticleImage {
  url: string;
  blurhash?: string;
}

interface ImageGalleryProps {
  images: ArticleImage[];
  onImageIndexChange?: (index: number) => void;
}

const ImageGallery: React.FC<ImageGalleryProps> = ({ images, onImageIndexChange }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isZoomModalVisible, setIsZoomModalVisible] = useState(false);
  const scale = useSharedValue(1);

  const handleScroll = (event: any) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (index !== currentIndex) {
      setCurrentIndex(index);
      onImageIndexChange?.(index);
    }
  };

  const handleImagePress = (index: number) => {
    setCurrentIndex(index);
    setIsZoomModalVisible(true);
  };

  const handleCloseZoom = () => {
    scale.value = withSpring(1);
    setIsZoomModalVisible(false);
  };

  const pinchHandler = useAnimatedGestureHandler({
    onActive: (event) => {
      scale.value = event.scale;
    },
    onEnd: () => {
      if (scale.value < 1) {
        scale.value = withSpring(1);
      } else if (scale.value > 3) {
        scale.value = withSpring(3);
      }
    },
  });

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
    };
  });

  const renderDots = () => {
    if (images.length <= 1) return null;

    return (
      <View style={styles.dotsContainer}>
        {images.map((_, index) => (
          <View
            key={index}
            style={[styles.dot, index === currentIndex && styles.activeDot]}
          />
        ))}
      </View>
    );
  };

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
              <Animated.View sharedTransitionTag={index === 0 ? 'article-image' : undefined}>
                <Image
                  source={{ uri: image.url || 'https://via.placeholder.com/400x500' }}
                  style={styles.image}
                  contentFit="cover"
                  transition={300}
                  placeholder={image.blurhash ? { blurhash: image.blurhash } : undefined}
                />
              </Animated.View>
              <View style={styles.zoomIndicator}>
                <Ionicons name="expand-outline" size={20} color="#FFFFFF" />
              </View>
            </Pressable>
          ))}
        </ScrollView>
        {renderDots()}
      </View>

      {/* Zoom Modal */}
      <Modal
        visible={isZoomModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseZoom}
      >
        <View style={styles.modalContainer}>
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
              scrollEnabled={scale.value <= 1}
              onMomentumScrollEnd={handleScroll}
              initialScrollIndex={currentIndex}
              contentOffset={{ x: currentIndex * SCREEN_WIDTH, y: 0 }}
            >
              {images.map((image, index) => (
                <View key={index} style={styles.zoomImageContainer}>
                  <PinchGestureHandler onGestureEvent={pinchHandler}>
                    <Animated.View style={[styles.zoomImageWrapper, animatedStyle]}>
                      <Image
                        source={{ uri: image.url || 'https://via.placeholder.com/400x500' }}
                        style={styles.zoomImage}
                        contentFit="contain"
                        transition={300}
                      />
                    </Animated.View>
                  </PinchGestureHandler>
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
    backgroundColor: '#000000',
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH * 1.2,
    backgroundColor: '#F2F2F7',
  },
  zoomIndicator: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
    padding: 8,
  },
  dotsContainer: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  activeDot: {
    backgroundColor: '#FFFFFF',
    width: 24,
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

