import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SwapItemInfo } from '@/types';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { formatPriceWithCurrency } from '@/utils/formatPrice';

export interface SwapItemCardProps {
  item: SwapItemInfo;
  variant?: 'their' | 'mine' | 'receiver' | 'initiator' | 'default' | 'selected';
  showValue?: boolean;
  onRemove?: () => void;
}

const SwapItemCard = React.memo(function SwapItemCard({
  item,
  variant = 'their',
  showValue = true,
  onRemove,
}: SwapItemCardProps) {
  const isMine = variant === 'mine' || variant === 'initiator' || variant === 'selected';
  return (
    <View style={[styles.container, isMine && styles.mineContainer]}>
      <View style={styles.imageWrapper}>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.image} contentFit="cover" accessibilityLabel={item.title} />
        ) : (
          <Ionicons name="image-outline" size={24} color={colors.muted} />
        )}
      </View>
      <View style={styles.content}>
        {item.brand && <Text style={styles.brand}>{item.brand}</Text>}
        <Text style={styles.title}>{item.title}</Text>
        {item.size?.value && <Text style={styles.metadata}>Taille {item.size.value}</Text>}
        {showValue && <Text style={styles.value}>Valeur indiquée · {formatPriceWithCurrency(item.price).replace(/ /g, '\u00A0')}</Text>}
      </View>
      {onRemove && (
        <Pressable
          style={styles.removeButton}
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`Retirer ${item.title}`}
        >
          <Ionicons name="close" size={20} color={colors.foreground} />
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.xl, backgroundColor: colors.surfaceWarm, borderWidth: 1, borderColor: colors.border },
  mineContainer: { borderColor: colors.borderStrong },
  imageWrapper: { width: 72, height: 92, borderRadius: radius.lg, overflow: 'hidden', flexShrink: 0, backgroundColor: colors.borderLight, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  content: { flex: 1, minWidth: 0, gap: spacing.xs },
  brand: { fontFamily: fonts.sansMedium, fontSize: 12, lineHeight: 17, color: colors.foregroundSecondary },
  title: { fontFamily: fonts.displayMedium, fontSize: 22, lineHeight: 25, color: colors.foreground },
  metadata: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17, color: colors.foregroundSecondary },
  value: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: colors.foregroundSecondary },
  removeButton: { width: sizing.minTouchTarget, minHeight: sizing.minTouchTarget, alignSelf: 'flex-start', borderRadius: radius.full, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
});

export default SwapItemCard;
