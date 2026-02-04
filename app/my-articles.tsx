import { useAuth } from '@/contexts/AuthContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { ArticlesService } from '@/services/articlesService';
import { Article } from '@/types';
import { AUTH_MESSAGES } from '@/constants/authMessages';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function MyArticlesScreen() {
  const { user } = useAuth();
  const { showAuthSheet } = useAuthRequired();
  const router = useRouter();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  const loadArticles = async (showRefreshing = false) => {
    if (!user) return;

    try {
      if (showRefreshing) setRefreshing(true);
      else setLoading(true);

      const userArticles = await ArticlesService.getUserArticles(user.id);
      setArticles(userArticles);
    } catch (error) {
      console.error('Erreur chargement articles:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadArticles();
    }, [user])
  );

  const handleRefresh = () => {
    loadArticles(true);
  };

  const closeAllSwipeables = () => {
    swipeableRefs.current.forEach((ref) => ref?.close());
  };

  const handleDeleteArticle = (article: Article) => {
    Alert.alert(
      'Supprimer l\'article',
      `Êtes-vous sûr de vouloir supprimer "${article.title}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              await ArticlesService.deleteArticle(article.id);
              setArticles((prev) => prev.filter((a) => a.id !== article.id));
              closeAllSwipeables();
            } catch (error) {
              console.error('Erreur suppression:', error);
              Alert.alert('Erreur', 'Impossible de supprimer l\'article');
            }
          },
        },
      ]
    );
  };

  const handleMarkAsSold = async (article: Article) => {
    try {
      await ArticlesService.updateArticle(article.id, { isSold: !article.isSold });
      setArticles((prev) =>
        prev.map((a) => (a.id === article.id ? { ...a, isSold: !a.isSold } : a))
      );
    } catch (error) {
      console.error('Erreur mise à jour:', error);
      Alert.alert('Erreur', 'Impossible de mettre à jour l\'article');
    }
  };

  const handleEditArticle = (article: Article) => {
    router.push(`/article/edit/${article.id}`);
  };

  const showActionSheet = (article: Article) => {
    const soldOption = article.isSold ? 'Remettre en vente' : 'Marquer comme vendu';

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Annuler', 'Modifier', soldOption, 'Supprimer'],
          destructiveButtonIndex: 3,
          cancelButtonIndex: 0,
          title: article.title,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            handleEditArticle(article);
          } else if (buttonIndex === 2) {
            handleMarkAsSold(article);
          } else if (buttonIndex === 3) {
            handleDeleteArticle(article);
          }
        }
      );
    } else {
      // Android: utiliser Alert avec des boutons
      Alert.alert(
        article.title,
        'Que souhaitez-vous faire ?',
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Modifier', onPress: () => handleEditArticle(article) },
          { text: soldOption, onPress: () => handleMarkAsSold(article) },
          { text: 'Supprimer', style: 'destructive', onPress: () => handleDeleteArticle(article) },
        ]
      );
    }
  };

  const renderRightActions = (
    progress: Animated.AnimatedInterpolation<number>,
    _dragX: Animated.AnimatedInterpolation<number>,
    article: Article
  ) => {
    const translateX = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [80, 0],
    });

    return (
      <Animated.View style={[styles.deleteAction, { transform: [{ translateX }] }]}>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => handleDeleteArticle(article)}
        >
          <Ionicons name="trash-outline" size={24} color="#fff" />
          <Text style={styles.deleteText}>Supprimer</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const renderArticleItem = ({ item }: { item: Article }) => {
    const firstImage = item.images[0];

    return (
      <Swipeable
        ref={(ref) => {
          if (ref) swipeableRefs.current.set(item.id, ref);
        }}
        renderRightActions={(progress, dragX) =>
          renderRightActions(progress, dragX, item)
        }
        rightThreshold={40}
      >
        <View style={styles.articleItemContainer}>
          <TouchableOpacity
            style={styles.articleItem}
            onPress={() => router.push(`/article/${item.id}`)}
            activeOpacity={0.7}
          >
            <Image
              source={{ uri: firstImage?.url || 'https://via.placeholder.com/120x120' }}
              style={styles.articleImage}
              contentFit="cover"
              transition={500}
              placeholder={firstImage?.blurhash ? { blurhash: firstImage.blurhash } : undefined}
            />
            <View style={styles.articleInfo}>
              <Text style={styles.articleTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.articlePrice}>{item.price}€</Text>
              <Text style={styles.articleSize}>{item.size || 'Taille non spécifiée'}</Text>
              <View style={styles.articleStats}>
                <Text style={styles.articleStat}>👀 {item.views}</Text>
                <Text style={styles.articleStat}>❤️ {item.likes}</Text>
                <Text
                  style={[
                    styles.articleStatus,
                    item.isSold ? styles.soldStatus : styles.activeStatus,
                  ]}
                >
                  {item.isSold ? 'Vendu' : 'En vente'}
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* Menu 3 points */}
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => showActionSheet(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="ellipsis-vertical" size={20} color="#666" />
          </TouchableOpacity>
        </View>
      </Swipeable>
    );
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Connexion requise</Text>
          <Text style={styles.emptyText}>
            Connectez-vous pour voir vos articles
          </Text>
          <TouchableOpacity
            style={styles.connectButton}
            onPress={() => showAuthSheet(AUTH_MESSAGES.sell)}
          >
            <Text style={styles.connectButtonText}>Se connecter</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.title}>Mes articles</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F79F24" />
          <Text style={styles.loadingText}>Chargement de vos articles...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.title}>Mes articles ({articles.length})</Text>
        <View style={styles.placeholder} />
      </View>

      {articles.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📦</Text>
          <Text style={styles.emptyTitle}>Aucun article</Text>
          <Text style={styles.emptyText}>
            Vous n'avez pas encore publié d'articles.{'\n'}
            Commencez à vendre maintenant !
          </Text>
          <TouchableOpacity
            style={styles.sellButton}
            onPress={() => router.push('/sell')}
          >
            <Text style={styles.sellButtonText}>Vendre un article</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlashList
          data={articles}
          renderItem={renderArticleItem as any}
          keyExtractor={(item) => item.id}
          estimatedItemSize={100}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  placeholder: {
    width: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  articleItemContainer: {
    position: 'relative',
    backgroundColor: '#fff',
  },
  articleItem: {
    flexDirection: 'row',
    padding: 16,
    paddingRight: 48,
    borderBottomWidth: 1,
    borderBottomColor: '#f8f8f8',
    backgroundColor: '#fff',
  },
  articleImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    marginRight: 12,
  },
  articleInfo: {
    flex: 1,
    justifyContent: 'space-between',
  },
  articleTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    marginBottom: 4,
  },
  articlePrice: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F79F24',
    marginBottom: 4,
  },
  articleSize: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  articleStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  articleStat: {
    fontSize: 12,
    color: '#666',
  },
  articleStatus: {
    fontSize: 12,
    fontWeight: '500',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  activeStatus: {
    backgroundColor: '#e8f5e8',
    color: '#2d5a2d',
  },
  soldStatus: {
    backgroundColor: '#fee',
    color: '#d63384',
  },
  menuButton: {
    position: 'absolute',
    top: 16,
    right: 12,
    padding: 8,
    zIndex: 1,
  },
  deleteAction: {
    backgroundColor: '#E53935',
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
  },
  deleteButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  deleteText: {
    color: '#fff',
    fontSize: 12,
    marginTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  sellButton: {
    backgroundColor: '#F79F24',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  sellButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  connectButton: {
    backgroundColor: '#F79F24',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
