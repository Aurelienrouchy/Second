import { router } from 'expo-router';
import { forwardRef, useImperativeHandle } from 'react';

// Filter interfaces (kept for compatibility)
export interface ProductFilters {
  category?: string;
  priceMin?: number;
  priceMax?: number;
  maxDistance?: number; // in km
  deliveryOptions: {
    pickup: boolean;
    shipping: boolean;
  };
  conditions: string[];
  brands: string[];
  sizes: string[];
  colors: string[];
  sortBy?: 'recent' | 'price_asc' | 'price_desc' | 'distance' | 'popular';
}

export interface FiltersBottomSheetProps {
  initialFilters?: Partial<ProductFilters>;
  onApply: (filters: ProductFilters) => void;
  onReset?: () => void;
  categories?: Array<{ id: string; label: string; icon?: string }>;
  maxPrice?: number;
  maxDistance?: number;
}

export interface FiltersBottomSheetRef {
  present: () => void;
  dismiss: () => void;
  snapToIndex: (index: number) => void;
}

const FiltersBottomSheet = forwardRef<FiltersBottomSheetRef, FiltersBottomSheetProps>(({
  initialFilters = {},
  onApply,
  onReset,
  categories = [],
  maxPrice = 1000,
  maxDistance = 100,
}, ref) => {

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    present: () => {
      // Navigate to filters modal with parameters
      router.push({
        pathname: '/filters',
        params: {
          filters: JSON.stringify(initialFilters),
          maxPrice: maxPrice.toString(),
          maxDistance: maxDistance.toString(),
        }
      });
    },
    dismiss: () => {
      // Navigate back if we're on filters screen
      if (router.canGoBack()) {
        router.back();
      }
    },
    snapToIndex: (index: number) => {
      // Not applicable for modal navigation
    },
  }));

  // This component doesn't render anything - it just handles navigation
  return null;
});

export default FiltersBottomSheet;

