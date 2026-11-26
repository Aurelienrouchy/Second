import React from 'react';
import { StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Animated, { type CSSAnimationProperties, type CSSAnimationSettings } from 'react-native-reanimated';
import { colors, components, spacing } from '@/constants/theme';

interface TrocMosaicRowProps {
  photos: string[];
  moving: boolean;
  reverse: boolean;
}

/** The repeated copy meets the first exactly at the loop boundary. */
export function TrocMosaicRow({ photos, moving, reverse }: TrocMosaicRowProps) {
  const { width } = useWindowDimensions();
  const cycleWidth = photos.length * (components.troc.mosaicTileWidth + spacing.sm);
  const copies = Math.ceil(width / cycleWidth) + 1;
  const rowStyles = createRowStyles(cycleWidth, reverse);

  return (
    <View style={styles.viewport}>
      <Animated.View
        style={[
          styles.track,
          rowStyles.animation,
          moving ? animationStates.running : animationStates.paused,
        ]}
      >
        {Array.from({ length: copies }, (_, copy) =>
          photos.map((uri, index) => (
            <Image
              key={`${copy}-${uri}`}
              source={{ uri }}
              contentFit="cover"
              recyclingKey={`${copy}-${index}-${uri}`}
              style={styles.photo}
              accessible={false}
            />
          )),
        )}
      </Animated.View>
    </View>
  );
}

const createRowStyles = (cycleWidth: number, reverse: boolean) => {
  const animation: ViewStyle & CSSAnimationProperties<ViewStyle> = {
    animationName: {
      from: { transform: [{ translateX: reverse ? -cycleWidth : 0 }] },
      to: { transform: [{ translateX: reverse ? 0 : -cycleWidth }] },
    },
    animationDuration: cycleWidth / components.troc.mosaicSpeed * 1000,
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  };
  return StyleSheet.create({ animation });
};

const running: ViewStyle & CSSAnimationSettings = { animationPlayState: 'running' };
const paused: ViewStyle & CSSAnimationSettings = { animationPlayState: 'paused' };
const animationStates = StyleSheet.create({ running, paused });

const styles = StyleSheet.create({
  viewport: { height: components.troc.mosaicTileHeight, overflow: 'hidden' },
  track: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'flex-start' },
  photo: {
    width: components.troc.mosaicTileWidth,
    height: components.troc.mosaicTileHeight,
    backgroundColor: colors.surfaceWarm,
  },
});
