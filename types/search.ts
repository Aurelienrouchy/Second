/**
 * Types et interfaces pour le système de recherche
 * Production-ready search system types
 */

export type ProductCondition = 'new' | 'good' | 'used';
export type ProductStatus = 'available' | 'reserved' | 'sold';
export type DeliveryOption = 'pickup' | 'shipping' | 'both';
export type SortOption = 'relevance' | 'distance' | 'price_asc' | 'price_desc' | 'recent';

/**
 * Product interface - Core data model
 */
export interface Product {
  id: string;
  title: string;
  description?: string;
  price: number;
  condition: ProductCondition;
  images: string[];
  category: string;
  categoryPath?: string[]; // Hierarchical category
  tags: string[];
  location: ProductLocation;
  sellerId: string;
  sellerName?: string;
  sellerRating?: number;
  createdAt: string;
  updatedAt?: string;
  status: ProductStatus;
  deliveryOptions?: DeliveryOption;
  views?: number;
  likes?: number;
  isFavorite?: boolean;
}

/**
 * Product location with distance calculation
 */
export interface ProductLocation {
  lat: number;
  lng: number;
  city: string;
  zipCode?: string;
  distanceKm?: number; // Calculated based on user location
  address?: string; // Approximate address for privacy
}

/**
 * Search filters - All available filter options
 */
export interface SearchFilters {
  query?: string;
  
  // Geolocation
  lat?: number;
  lng?: number;
  radiusKm?: number;
  
  // Category & Classification
  category?: string;
  categoryPath?: string[];
  
  // Price
  minPrice?: number;
  maxPrice?: number;
  
  // Condition
  condition?: ProductCondition;
  
  // Delivery
  deliveryOptions?: DeliveryOption[];
  
  // Seller
  minSellerRating?: number;
  
  // Date
  publishedSince?: string; // ISO date
  
  // Status
  onlyAvailable?: boolean;
  
  // Sorting
  sort?: SortOption;
}

/**
 * Search request parameters
 */
export interface SearchParams extends SearchFilters {
  cursor?: string; // For pagination
  limit?: number;
}

/**
 * Search response with pagination
 */
export interface SearchResponse {
  items: Product[];
  nextCursor: string | null;
  totalCount?: number;
  hasMore: boolean;
}

/**
 * Autocomplete suggestion
 */
export interface SearchSuggestion {
  id: string;
  text: string;
  type: 'query' | 'category' | 'tag' | 'location';
  metadata?: {
    categoryId?: string;
    count?: number;
    icon?: string;
  };
}

/**
 * Saved search
 */
export interface SavedSearch {
  id: string;
  userId: string;
  name: string;
  criteria: SearchFilters;
  createdAt: string;
  notificationsEnabled: boolean;
  lastNotifiedAt?: string;
}

/**
 * Map cluster for performance
 */
export interface ProductCluster {
  id: string;
  coordinate: {
    latitude: number;
    longitude: number;
  };
  products: Product[];
  count: number;
}

/**
 * User location state
 */
export interface UserLocation {
  lat: number;
  lng: number;
  city?: string;
  accuracy?: number;
  timestamp: number;
}

/**
 * Search analytics event
 */
export interface SearchAnalyticsEvent {
  type: 'search_performed' | 'filter_applied' | 'result_clicked' | 
        'message_from_search' | 'offer_from_search' | 'save_search' |
        'map_view_toggled' | 'sort_changed';
  query?: string;
  filters?: Partial<SearchFilters>;
  productId?: string;
  resultPosition?: number;
  timestamp: number;
}

/**
 * Search state for UI
 */
export interface SearchState {
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  products: Product[];
  filters: SearchFilters;
  hasMore: boolean;
  viewMode: 'list' | 'map';
  selectedProduct?: Product;
}

/**
 * Geolocation permission state
 */
export type LocationPermissionStatus = 'granted' | 'denied' | 'undetermined';

export interface LocationPermission {
  status: LocationPermissionStatus;
  canAskAgain: boolean;
}

