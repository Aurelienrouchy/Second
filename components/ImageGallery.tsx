import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, type NativeScrollEvent, type NativeSyntheticEvent, ScrollView as RNScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView, Pressable, ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { track } from '@/lib/analytics';
import type { ArticleImage } from '@/types';
import { normalizeArticleImages } from '@/utils/articleImages';

import { ZoomableGalleryImage } from './ZoomableGalleryImage';

interface Props {
  images: ArticleImage[];
  onImageIndexChange?: (index: number) => void;
  articleId?: string;
}

const ImageGallery: React.FC<Props> = ({ images, onImageIndexChange, articleId }) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const photos = useMemo(() => normalizeArticleImages(images), [images]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [resetCount, setResetCount] = useState(0);
  const indexRef = useRef(0);
  const scrollRef = useRef<RNScrollView>(null);
  const galleryKey = `${articleId ?? ''}:${photos.map((image) => image.url).join('|')}`;
  const previousGalleryKey = useRef(galleryKey);

  const selectImage = useCallback((index: number, syncScroll = true) => {
    if (!photos.length) return;
    const next = Math.max(0, Math.min(index, photos.length - 1));
    if (next !== indexRef.current) {
      indexRef.current = next;
      setCurrentIndex(next);
      setZoomed(false);
      onImageIndexChange?.(next);
    }
    if (syncScroll) scrollRef.current?.scrollTo({ x: next * width, animated: false });
  }, [photos.length, width, onImageIndexChange]);

  useEffect(() => {
    if (previousGalleryKey.current !== galleryKey) {
      previousGalleryKey.current = galleryKey;
      indexRef.current = 0;
      setCurrentIndex(0);
      setIsOpen(false);
      setZoomed(false);
      onImageIndexChange?.(0);
    }
    scrollRef.current?.scrollTo({ x: indexRef.current * width, animated: false });
  }, [galleryKey, width, onImageIndexChange]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    selectImage(Math.round(event.nativeEvent.contentOffset.x / width), false);
  }, [selectImage, width]);

  const openPhoto = useCallback((index: number) => {
    selectImage(index);
    setZoomed(false);
    setIsOpen(true);
    if (articleId) track('article_image_zoomed', { article_id: articleId, image_index: index, image_count: photos.length });
  }, [selectImage, articleId, photos.length]);

  const navigate = useCallback((direction: number) => selectImage(indexRef.current + direction), [selectImage]);
  const close = useCallback(() => {
    scrollRef.current?.scrollTo({ x: indexRef.current * width, animated: false });
    setIsOpen(false);
    setZoomed(false);
  }, [width]);
  const photoHeight = Math.max(1, height - insets.top - insets.bottom - 132);
  const photo = photos[currentIndex];

  return (
    <>
      <View style={styles.container}>
        <ScrollView ref={scrollRef} testID="article-gallery" horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScroll} scrollEventThrottle={16}>
          {photos.map((image, index) => (
            <Pressable key={`${index}:${image.url}`} onPress={() => openPhoto(index)} accessibilityRole="button"
              accessibilityLabel={`Agrandir la photo ${index + 1}`} testID={`article-photo-${index}`}>
              <Image source={{ uri: image.url }} style={[styles.image, { width, height: width * 1.2 }]} contentFit="cover"
                placeholder={image.blurhash ? { blurhash: image.blurhash } : undefined} />
            </Pressable>
          ))}
        </ScrollView>
        {!photos.length && <View style={[styles.empty, { width, height: width * 1.2 }]}><Ionicons name="image-outline" size={40} color={colors.muted} /><Text style={styles.emptyText}>Photo indisponible</Text></View>}
        {photos.length > 1 && (
          <View style={styles.dots}>
            {photos.map((_, index) => (
              <Pressable key={index} style={styles.dotButton} onPress={() => selectImage(index)} accessibilityRole="button"
                accessibilityLabel={`Voir la photo ${index + 1}`} accessibilityState={{ selected: index === currentIndex }}>
                <View style={[styles.dot, index === currentIndex && styles.activeDot]} />
              </Pressable>
            ))}
          </View>
        )}
      </View>
      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={close}>
        <GestureHandlerRootView style={styles.modal}>
          <StatusBar style="light" />
          <View style={[styles.modalHeader, { paddingTop: insets.top + 12 }]}>
            <Text style={styles.counter} accessibilityLiveRegion="polite">{currentIndex + 1} / {photos.length}</Text>
            <Pressable onPress={close} style={styles.control} accessibilityRole="button" accessibilityLabel="Fermer les photos" testID="gallery-close">
              <Ionicons name="close" size={28} color={colors.white} />
            </Pressable>
          </View>
          {isOpen && photo && (
            <ZoomableGalleryImage key={`${galleryKey}:${currentIndex}:${resetCount}:${width}:${photoHeight}`} image={photo} width={width} height={photoHeight}
              onNavigate={navigate} onZoomChange={setZoomed} />
          )}
          <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.navigation}>
              <Pressable style={[styles.control, currentIndex === 0 && styles.disabled]} onPress={() => navigate(-1)} disabled={currentIndex === 0}
                accessibilityRole="button" accessibilityLabel="Photo précédente" testID="gallery-previous">
                <Ionicons name="chevron-back" size={24} color={colors.white} />
              </Pressable>
              <Pressable onPress={() => { setResetCount((count) => count + 1); setZoomed(false); }} disabled={!zoomed}
                accessibilityRole="button" accessibilityLabel="Réinitialiser le zoom" style={styles.reset}>
                <Text style={styles.hint}>{zoomed ? 'Réinitialiser le zoom' : 'Pincez ou touchez deux fois pour zoomer'}</Text>
              </Pressable>
              <Pressable style={[styles.control, currentIndex === photos.length - 1 && styles.disabled]} onPress={() => navigate(1)} disabled={currentIndex === photos.length - 1}
                accessibilityRole="button" accessibilityLabel="Photo suivante" testID="gallery-next">
                <Ionicons name="chevron-forward" size={24} color={colors.white} />
              </Pressable>
            </View>
          </View>
        </GestureHandlerRootView>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: { position: 'relative', backgroundColor: colors.surfaceWarm },
  image: { backgroundColor: colors.surfaceWarm },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { color: colors.muted },
  dots: { position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center' },
  dotButton: { minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  activeDot: { width: 20, backgroundColor: colors.white },
  modal: { flex: 1, backgroundColor: '#000000' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  counter: { color: colors.white, fontSize: 16, fontWeight: '600' },
  control: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  footer: { flex: 1, justifyContent: 'center', paddingHorizontal: 8 },
  navigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reset: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  hint: { color: colors.white, fontSize: 12, textAlign: 'center' },
  disabled: { opacity: 0.3 },
});

export default ImageGallery;
