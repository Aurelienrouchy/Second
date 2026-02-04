import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FavoritesService } from '@/services/favoritesService';
import { useAuth } from './AuthContext';

interface FavoritesContextType {
  favorites: string[];
  addToFavorites: (articleId: string) => Promise<void>;
  removeFromFavorites: (articleId: string) => Promise<void>;
  isFavorite: (articleId: string) => boolean;
  toggleFavorite: (articleId: string) => Promise<void>;
  isLoading: boolean;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

export const useFavorites = () => {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error('useFavorites must be used within a FavoritesProvider');
  }
  return context;
};

interface FavoritesProviderProps {
  children: ReactNode;
}

export const FavoritesProvider: React.FC<FavoritesProviderProps> = ({ children }) => {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      loadFavorites();
    } else {
      // Si pas connecté, charger depuis AsyncStorage
      loadLocalFavorites();
    }
  }, [user]);

  const loadFavorites = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const userFavorites = await FavoritesService.getUserFavorites(user.id);
      setFavorites(userFavorites);
    } catch (error) {
      console.log('Error loading favorites from Firebase:', error);
      // Fallback vers AsyncStorage
      await loadLocalFavorites();
    } finally {
      setIsLoading(false);
    }
  };

  const loadLocalFavorites = async () => {
    try {
      const storedFavorites = await AsyncStorage.getItem('user_favorites');
      if (storedFavorites) {
        setFavorites(JSON.parse(storedFavorites));
      }
    } catch (error) {
      console.log('Error loading local favorites:', error);
    }
  };

  const saveLocalFavorites = async (newFavorites: string[]) => {
    try {
      await AsyncStorage.setItem('user_favorites', JSON.stringify(newFavorites));
    } catch (error) {
      console.log('Error saving local favorites:', error);
    }
  };

  const addToFavorites = async (articleId: string) => {
    const newFavorites = [...favorites, articleId];
    setFavorites(newFavorites);
    
    if (user) {
      try {
        await FavoritesService.addToFavorites(user.id, articleId);
      } catch (error) {
        console.log('Error adding to Firebase favorites:', error);
        // Revert si erreur
        setFavorites(favorites);
      }
    } else {
      await saveLocalFavorites(newFavorites);
    }
  };

  const removeFromFavorites = async (articleId: string) => {
    const newFavorites = favorites.filter(id => id !== articleId);
    setFavorites(newFavorites);
    
    if (user) {
      try {
        await FavoritesService.removeFromFavorites(user.id, articleId);
      } catch (error) {
        console.log('Error removing from Firebase favorites:', error);
        // Revert si erreur
        setFavorites(favorites);
      }
    } else {
      await saveLocalFavorites(newFavorites);
    }
  };

  // Memoize favorites set for O(1) lookup
  const favoritesSet = useMemo(() => new Set(favorites), [favorites]);

  // Memoize isFavorite to prevent unnecessary re-renders in consumers
  const isFavorite = useCallback((articleId: string) => {
    return favoritesSet.has(articleId);
  }, [favoritesSet]);

  const toggleFavorite = async (articleId: string) => {
    if (isFavorite(articleId)) {
      await removeFromFavorites(articleId);
    } else {
      await addToFavorites(articleId);
    }
  };

  return (
    <FavoritesContext.Provider value={{
      favorites,
      addToFavorites,
      removeFromFavorites,
      isFavorite,
      toggleFavorite,
      isLoading
    }}>
      {children}
    </FavoritesContext.Provider>
  );
};