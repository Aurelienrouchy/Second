/**
 * ArticleDetails — title, price, condition, description, seller card, etc.
 *
 * Receives the article + computed values (tags, categoryLabel, discount, sellerRating, shippingCost)
 * and a callback for "view profile". Renders the entire info block including SimilarProducts.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import SimilarProducts from '@/components/SimilarProducts';
import { Avatar } from '@/components/ui';
import { colors } from '@/constants/theme';
import { formatDisplayName } from '@/utils/formatName';
import { formatPrice } from '@/utils/formatPrice';

import type { Article } from '@/types';

import { articleStyles as styles } from '../styles';
import { formatArticleDate, spotEmoji } from '../utils';

export interface ArticleDetailsProps {
  article: Article;
  categoryLabel: string | undefined;
  tags: string[];
  shippingCost: number | undefined;
  sellerRating: number | undefined;
  onViewProfile: () => void;
}

function ArticleDetailsComponent({
  article,
  categoryLabel,
  tags,
  shippingCost,
  sellerRating,
  onViewProfile,
}: ArticleDetailsProps) {
  return (
    <View style={styles.infoBlock}>
      {/* Brand + Category */}
      <Animated.View entering={FadeInDown.duration(350).delay(80)}>
        <Text style={styles.brandCategory}>
          {article.brand ? `${article.brand} · ` : ''}{categoryLabel}
        </Text>
      </Animated.View>

      {/* Title — Cormorant Garamond */}
      <Animated.View entering={FadeInDown.duration(350).delay(120)}>
        <Text style={styles.title}>{article.title}</Text>
      </Animated.View>

      {/* Price row: current + original strikethrough */}
      <Animated.View entering={FadeInDown.duration(350).delay(160)} style={styles.priceRow}>
        <Text style={styles.price}>{formatPrice(article.price)}</Text>
        {(article as any).originalPrice && (
          <Text style={styles.originalPrice}>{formatPrice((article as any).originalPrice)}</Text>
        )}
      </Animated.View>

      {/* Engagement: likes · views · date */}
      <Animated.View entering={FadeInDown.duration(350).delay(200)} style={styles.engagementRow}>
        <View style={styles.engagementItem}>
          <Ionicons name="heart-outline" size={13} color={colors.muted} />
          <Text style={styles.engagementText}>{article.likes}</Text>
        </View>
        <View style={styles.engagementItem}>
          <Ionicons name="eye-outline" size={13} color={colors.muted} />
          <Text style={styles.engagementText}>{article.views} vues</Text>
        </View>
        <Text style={styles.engagementDate}>
          Publié {formatArticleDate(article.createdAt)}
        </Text>
      </Animated.View>

      {/* Tags — from size, condition, color, material, pattern */}
      <Animated.View entering={FadeInDown.duration(350).delay(240)} style={styles.tagsRow}>
        {tags.map((tag, i) => (
          <View key={i} style={styles.tag}>
            <Text style={styles.tagText}>{tag}</Text>
          </View>
        ))}
        {/* packageSize badge (sage) */}
        {article.packageSize && (
          <View style={styles.packageTag}>
            <Text style={styles.packageTagText}>Colis {article.packageSize}</Text>
          </View>
        )}
      </Animated.View>

      {/* Description */}
      {article.description ? (
        <Animated.View entering={FadeInDown.duration(350).delay(280)}>
          <Text style={styles.description}>{article.description}</Text>
        </Animated.View>
      ) : null}

      {/* Delivery options cards */}
      {(article.isShipping || article.isHandDelivery) && (
        <Animated.View entering={FadeInDown.duration(350).delay(320)} style={styles.deliveryRow}>
          {article.isShipping && (
            <View style={styles.deliveryCardShipping}>
              <Ionicons name="cube-outline" size={16} color={colors.sage} />
              <View style={styles.deliveryCardContent}>
                <Text style={styles.deliveryCardTitle}>Livraison</Text>
                <Text style={styles.deliveryCardSub}>
                  {shippingCost ? `$${shippingCost.toFixed(2)}` : 'Gratuit'}
                </Text>
              </View>
            </View>
          )}
          {article.isHandDelivery && (
            <View style={styles.deliveryCardPickup}>
              <Ionicons name="location-outline" size={16} color={colors.primary} />
              <View style={styles.deliveryCardContent}>
                <Text style={styles.deliveryCardTitle}>En personne</Text>
                <Text style={styles.deliveryCardSub}>
                  {article.neighborhood?.name || 'À convenir'}
                </Text>
              </View>
            </View>
          )}
        </Animated.View>
      )}

      {/* Preferred meetup spots */}
      {article.preferredMeetupSpots && article.preferredMeetupSpots.length > 0 && (
        <Animated.View entering={FadeInDown.duration(350).delay(360)}>
          <Text style={styles.sectionLabel}>Lieux de rencontre suggérés</Text>
          <View style={styles.spotsRow}>
            {article.preferredMeetupSpots.map((spot, i) => (
              <View key={i} style={styles.spotChip}>
                <Text style={styles.spotEmoji}>{spotEmoji(spot.category)}</Text>
                <Text style={styles.spotName}>{spot.name}</Text>
              </View>
            ))}
          </View>
        </Animated.View>
      )}

      {/* Seller card */}
      <Animated.View entering={FadeInDown.duration(350).delay(400)}>
        <Pressable style={styles.sellerCard} onPress={onViewProfile}>
          <Avatar
            source={article.sellerImage}
            name={article.sellerName}
            size="md"
          />
          <View style={styles.sellerInfo}>
            <Text style={styles.sellerName}>{formatDisplayName(article.sellerName)}</Text>
            <Text style={styles.sellerMeta}>
              {article.neighborhood?.name}
              {article.neighborhood?.borough ? ` · ${article.neighborhood.borough}` : ''}
            </Text>
          </View>
          {sellerRating && (
            <View style={styles.sellerRatingContainer}>
              <Ionicons name="star" size={13} color={colors.primary} />
              <Text style={styles.sellerRatingText}>{sellerRating}</Text>
            </View>
          )}
        </Pressable>
      </Animated.View>

      {/* Similar Products */}
      <SimilarProducts
        currentArticleId={article.id}
        category={article.category}
        maxResults={10}
      />
    </View>
  );
}

export const ArticleDetails = React.memo(ArticleDetailsComponent);
