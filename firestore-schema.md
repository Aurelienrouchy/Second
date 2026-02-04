# Firestore Data Model - Freepe

## Collections Overview

### 1. `products` Collection
Main product listings with full details and search optimization.

### 2. `users` Collection  
User profiles with authentication and preference data.

### 3. `favorites` Collection
User favorite products for personalized experience.

### 4. `messages` Collection
Chat messages between users for product inquiries.

### 5. `stats` Collection
Aggregated statistics and analytics data.

### 6. `search_index` Collection (Denormalized)
Optimized search documents for fast queries.

---

## Document Structures

### Products Collection: `/products/{productId}`

```typescript
interface ProductDocument {
  // Basic Information
  id: string;                    // Auto-generated document ID
  title: string;                 // Product title (required, 3-100 chars)
  description: string;           // Detailed description (required, 10-2000 chars)
  price: number;                 // Price in euros (required, 0.01-10000)
  originalPrice?: number;        // Original price for discounts
  
  // Media
  images: {
    url: string;                 // Firebase Storage URL
    blurhash?: string;           // Blur placeholder
    width?: number;              // Image dimensions
    height?: number;
    order: number;               // Display order (0-based)
  }[];
  
  // Categorization
  category: string;              // Main category (required)
  subcategory?: string;          // Subcategory
  brand?: string;                // Brand name
  size?: string;                 // Size (XS, S, M, L, XL, etc.)
  color?: string;                // Primary color
  material?: string;             // Material type
  pattern?: string;              // Pattern type
  condition: 'neuf' | 'très bon état' | 'bon état' | 'satisfaisant';
  
  // Seller Information
  sellerId: string;              // User ID of seller (required)
  sellerName: string;            // Cached seller name
  sellerImage?: string;          // Cached seller avatar
  sellerRating?: number;         // Cached seller rating (0-5)
  
  // Location & Delivery
  location: {
    address?: string;            // Human-readable address
    city: string;                // City name (required)
    postalCode: string;          // Postal code (required)
    country: string;             // Country code (FR, etc.)
    coordinates: {
      lat: number;               // Latitude (-90 to 90)
      lon: number;               // Longitude (-180 to 180)
    };
    geohash: string;             // Computed geohash for proximity queries
  };
  
  deliveryOptions: {
    pickup: boolean;             // Hand delivery available
    shipping: boolean;           // Postal shipping available
    shippingCost?: number;       // Shipping cost in euros
  };
  
  // Status & Metadata
  isActive: boolean;             // Product is visible (default: true)
  isSold: boolean;               // Product is sold (default: false)
  isPromoted: boolean;           // Sponsored/promoted listing (default: false)
  
  // Engagement Metrics
  views: number;                 // View count (default: 0)
  likes: number;                 // Like count (default: 0)
  likedBy: string[];             // Array of user IDs who liked
  
  // Timestamps
  createdAt: Timestamp;          // Creation time (server timestamp)
  updatedAt: Timestamp;          // Last update time (server timestamp)
  soldAt?: Timestamp;            // Sale completion time
  
  // Search Optimization
  searchKeywords: string[];      // Generated keywords for search
  titleLowercase: string;        // Lowercase title for case-insensitive search
  
  // Moderation
  isReported: boolean;           // Has been reported (default: false)
  moderationStatus: 'pending' | 'approved' | 'rejected';
}
```

### Users Collection: `/users/{userId}`

```typescript
interface UserDocument {
  id: string;                    // Auth UID
  email: string;                 // User email (required)
  displayName: string;           // Display name (required)
  profileImage?: string;         // Profile picture URL
  
  // Profile Information
  bio?: string;                  // User bio (max 500 chars)
  phoneNumber?: string;          // Verified phone number
  
  // Address Information
  addresses: {
    id: string;                  // Address ID
    label: string;               // "Home", "Work", etc.
    street: string;
    city: string;
    postalCode: string;
    country: string;
    coordinates?: {
      lat: number;
      lon: number;
    };
    isDefault: boolean;
  }[];
  
  // Preferences
  preferences: {
    notifications: {
      email: boolean;
      push: boolean;
      messages: boolean;
      likes: boolean;
      sales: boolean;
    };
    privacy: {
      showEmail: boolean;
      showPhone: boolean;
      showLastSeen: boolean;
    };
    language: 'fr' | 'en';
    currency: 'EUR' | 'USD';
  };
  
  // Statistics
  stats: {
    productsListed: number;      // Total products listed
    productsSold: number;        // Total products sold
    totalEarnings: number;       // Total earnings in euros
    rating: number;              // Average rating (0-5)
    reviewCount: number;         // Number of reviews received
  };
  
  // Status
  isVerified: boolean;           // Email/phone verified
  isActive: boolean;             // Account is active
  lastSeen: Timestamp;           // Last activity timestamp
  
  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### Favorites Collection: `/favorites/{userId}`

```typescript
interface FavoritesDocument {
  userId: string;                // User ID (document ID)
  products: {
    productId: string;           // Product ID
    addedAt: Timestamp;          // When favorited
    productTitle: string;        // Cached product title
    productPrice: number;        // Cached product price
    productImage?: string;       // Cached first image URL
    sellerId: string;            // Cached seller ID
  }[];
  
  // Metadata
  totalCount: number;            // Total favorites count
  updatedAt: Timestamp;
}
```

### Messages Collection: `/messages/{messageId}`

```typescript
interface MessageDocument {
  id: string;                    // Auto-generated ID
  
  // Participants
  senderId: string;              // Sender user ID
  receiverId: string;            // Receiver user ID
  
  // Content
  content: string;               // Message text (required, max 1000 chars)
  type: 'text' | 'image' | 'offer' | 'system';
  
  // Product Context
  productId?: string;            // Related product ID
  productTitle?: string;         // Cached product title
  productImage?: string;         // Cached product image
  
  // Offer Information (for type: 'offer')
  offer?: {
    amount: number;              // Offered price
    status: 'pending' | 'accepted' | 'declined' | 'expired';
    expiresAt: Timestamp;        // Offer expiration
  };
  
  // Status
  isRead: boolean;               // Read by receiver (default: false)
  isDeleted: boolean;            // Soft delete (default: false)
  
  // Timestamps
  createdAt: Timestamp;
  readAt?: Timestamp;
}
```

### Stats Collection: `/stats/{statType}`

```typescript
// Document: /stats/global
interface GlobalStatsDocument {
  totalProducts: number;         // Total active products
  totalUsers: number;            // Total registered users
  totalSales: number;            // Total completed sales
  totalRevenue: number;          // Total platform revenue
  
  // Category Statistics
  categoryStats: {
    [categoryId: string]: {
      productCount: number;
      averagePrice: number;
      totalSales: number;
    };
  };
  
  // Daily/Weekly/Monthly aggregates
  dailyStats: {
    date: string;                // YYYY-MM-DD
    newProducts: number;
    newUsers: number;
    sales: number;
    revenue: number;
  }[];
  
  updatedAt: Timestamp;
}

// Document: /stats/user/{userId}
interface UserStatsDocument {
  userId: string;
  
  // Product Statistics
  productsListed: number;
  productsActive: number;
  productsSold: number;
  productsViews: number;
  productsLikes: number;
  
  // Financial Statistics
  totalEarnings: number;
  averageSalePrice: number;
  
  // Engagement Statistics
  profileViews: number;
  messagesReceived: number;
  messagesSent: number;
  
  // Performance Metrics
  averageResponseTime: number;   // In minutes
  salesConversionRate: number;   // Percentage
  
  updatedAt: Timestamp;
}
```

### Search Index Collection: `/search_index/{productId}`

```typescript
interface SearchIndexDocument {
  productId: string;             // Original product ID
  
  // Searchable Fields
  title: string;
  titleLowercase: string;
  description: string;
  keywords: string[];            // Generated search keywords
  
  // Filterable Fields
  category: string;
  subcategory?: string;
  brand?: string;
  size?: string;
  color?: string;
  condition: string;
  price: number;
  
  // Location for Geo Queries
  location: {
    city: string;
    geohash: string;             // For proximity search
    coordinates: {
      lat: number;
      lon: number;
    };
  };
  
  // Cached Display Data
  sellerId: string;
  sellerName: string;
  sellerRating?: number;
  firstImage?: string;
  
  // Status
  isActive: boolean;
  isSold: boolean;
  isPromoted: boolean;
  
  // Metrics for Ranking
  views: number;
  likes: number;
  createdAt: Timestamp;
  
  // Search Optimization
  popularityScore: number;       // Computed ranking score
  lastIndexed: Timestamp;        // When last updated
}
```

---

## Example Documents

### Example Product Document

```json
{
  "id": "prod_123456789",
  "title": "Robe d'été Zara fleurie taille M",
  "description": "Magnifique robe d'été de la marque Zara, portée seulement 2 fois. Parfaite pour les beaux jours avec son motif fleuri coloré.",
  "price": 25.00,
  "originalPrice": 45.00,
  "images": [
    {
      "url": "https://storage.googleapis.com/vinted-clone/products/prod_123456789/image_0.jpg",
      "blurhash": "LKO2?V%2Tw=w]~RBVZRi};RPxuwH",
      "width": 800,
      "height": 1200,
      "order": 0
    }
  ],
  "category": "femmes",
  "subcategory": "robes",
  "brand": "Zara",
  "size": "M",
  "color": "multicolore",
  "material": "coton",
  "pattern": "fleuri",
  "condition": "très bon état",
  "sellerId": "user_987654321",
  "sellerName": "Marie L.",
  "sellerImage": "https://storage.googleapis.com/vinted-clone/avatars/user_987654321.jpg",
  "sellerRating": 4.8,
  "location": {
    "address": "15 rue de la Paix",
    "city": "Paris",
    "postalCode": "75001",
    "country": "FR",
    "coordinates": {
      "lat": 48.8566,
      "lon": 2.3522
    },
    "geohash": "u09tvw0"
  },
  "deliveryOptions": {
    "pickup": true,
    "shipping": true,
    "shippingCost": 4.50
  },
  "isActive": true,
  "isSold": false,
  "isPromoted": false,
  "views": 127,
  "likes": 23,
  "likedBy": ["user_111", "user_222", "user_333"],
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z",
  "searchKeywords": ["robe", "été", "zara", "fleuri", "m", "coton", "multicolore"],
  "titleLowercase": "robe d'été zara fleurie taille m",
  "isReported": false,
  "moderationStatus": "approved"
}
```

### Example User Document

```json
{
  "id": "user_987654321",
  "email": "marie.l@example.com",
  "displayName": "Marie L.",
  "profileImage": "https://storage.googleapis.com/vinted-clone/avatars/user_987654321.jpg",
  "bio": "Passionnée de mode durable 🌱 Vente uniquement d'articles en excellent état !",
  "phoneNumber": "+33123456789",
  "addresses": [
    {
      "id": "addr_1",
      "label": "Domicile",
      "street": "15 rue de la Paix",
      "city": "Paris",
      "postalCode": "75001",
      "country": "FR",
      "coordinates": {
        "lat": 48.8566,
        "lon": 2.3522
      },
      "isDefault": true
    }
  ],
  "preferences": {
    "notifications": {
      "email": true,
      "push": true,
      "messages": true,
      "likes": true,
      "sales": true
    },
    "privacy": {
      "showEmail": false,
      "showPhone": true,
      "showLastSeen": true
    },
    "language": "fr",
    "currency": "EUR"
  },
  "stats": {
    "productsListed": 45,
    "productsSold": 38,
    "totalEarnings": 892.50,
    "rating": 4.8,
    "reviewCount": 42
  },
  "isVerified": true,
  "isActive": true,
  "lastSeen": "2024-01-20T15:45:00Z",
  "createdAt": "2023-06-10T09:15:00Z",
  "updatedAt": "2024-01-20T15:45:00Z"
}
```

### Example Favorites Document

```json
{
  "userId": "user_123456789",
  "products": [
    {
      "productId": "prod_987654321",
      "addedAt": "2024-01-18T14:20:00Z",
      "productTitle": "Sac à main Hermès vintage",
      "productPrice": 450.00,
      "productImage": "https://storage.googleapis.com/vinted-clone/products/prod_987654321/image_0.jpg",
      "sellerId": "user_555666777"
    },
    {
      "productId": "prod_111222333",
      "addedAt": "2024-01-19T09:15:00Z",
      "productTitle": "Baskets Nike Air Max 90",
      "productPrice": 85.00,
      "productImage": "https://storage.googleapis.com/vinted-clone/products/prod_111222333/image_0.jpg",
      "sellerId": "user_888999000"
    }
  ],
  "totalCount": 2,
  "updatedAt": "2024-01-19T09:15:00Z"
}
```



