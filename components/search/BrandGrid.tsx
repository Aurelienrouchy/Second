import { firestore } from '@/config/firebaseConfig';
import { Ionicons } from '@expo/vector-icons';
import { collection, getDocs, limit, query } from '@react-native-firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface Brand {
  value: string;
  label: string;
}

interface BrandGridProps {
  onBrandPress: (brand: string) => void;
  onViewAllPress: () => void;
}

export default function BrandGrid({ onBrandPress, onViewAllPress }: BrandGridProps) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadPopularBrands();
  }, []);

  const loadPopularBrands = async () => {
    try {
      setIsLoading(true);
      // Charger 40 marques depuis Firestore
      const q = query(collection(firestore, 'brands'), limit(40));
      const querySnapshot = await getDocs(q);

      const brandsList: Brand[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.label) {
          brandsList.push({
            value: data.value || data.searchKey || data.label.toLowerCase(),
            label: data.label,
          });
        }
      });
      
      // Trier alphabétiquement
      brandsList.sort((a, b) => a.label.localeCompare(b.label));
      
      if (brandsList.length > 0) {
        setBrands(brandsList);
      } else {
        throw new Error("No brands found");
      }
    } catch (error) {
      console.error('Error loading brands:', error);
      // Fallback sur des marques populaires
      const fallbackBrands: Brand[] = [
        { value: 'nike', label: 'Nike' },
        { value: 'adidas', label: 'Adidas' },
        { value: 'zara', label: 'Zara' },
        { value: 'h&m', label: 'H&M' },
        { value: 'mango', label: 'Mango' },
        { value: 'pull&bear', label: 'Pull&Bear' },
        { value: 'bershka', label: 'Bershka' },
        { value: 'stradivarius', label: 'Stradivarius' },
        { value: 'levis', label: 'Levi\'s' },
        { value: 'the-north-face', label: 'The North Face' },
        { value: 'vans', label: 'Vans' },
        { value: 'converse', label: 'Converse' },
        { value: 'new-balance', label: 'New Balance' },
        { value: 'puma', label: 'Puma' },
        { value: 'reebok', label: 'Reebok' },
        { value: 'tommy-hilfiger', label: 'Tommy Hilfiger' },
        { value: 'calvin-klein', label: 'Calvin Klein' },
        { value: 'lacoste', label: 'Lacoste' },
        { value: 'ralph-lauren', label: 'Ralph Lauren' },
        { value: 'gucci', label: 'Gucci' },
      ];
      setBrands(fallbackBrands);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#F79F24" />
      </View>
    );
  }

  // Organiser les marques en 4 lignes
  const brandsPerRow = Math.ceil(brands.length / 4);
  const rows = [];
  for (let i = 0; i < 4; i++) {
    rows.push(brands.slice(i * brandsPerRow, (i + 1) * brandsPerRow));
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Marques populaires</Text>
        <TouchableOpacity onPress={onViewAllPress} activeOpacity={0.7}>
          <View style={styles.viewAllButton}>
            <Text style={styles.viewAllText}>Voir tout</Text>
            <Ionicons name="chevron-forward" size={16} color="#F79F24" />
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.grid}>
          {rows.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.row}>
              {row.map((brand) => (
                <TouchableOpacity
                  key={brand.value}
                  style={styles.brandChip}
                  onPress={() => onBrandPress(brand.label)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.brandText}>{brand.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 32,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F79F24',
  },
  scrollContent: {
    paddingRight: 20,
  },
  grid: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  brandChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#F2F2F7',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  brandText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  loadingContainer: {
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

