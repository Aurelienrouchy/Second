# Data Models

## Firestore Collections

### Collection Overview

| Collection | Purpose | Primary Key |
|------------|---------|-------------|
| `users` | User profiles | Firebase Auth UID |
| `articles` | Product listings | Auto-generated |
| `chats` | Chat conversations | Auto-generated |
| `messages` | Chat messages | Auto-generated |
| `favorites` | User favorites | Firebase Auth UID |
| `shops` | Physical store profiles | Auto-generated |
| `transactions` | Purchase records | Auto-generated |
| `seller_balances` | Seller earnings | Firebase Auth UID |
| `notifications` | User notifications | Auto-generated |
| `search_index` | Search optimization | Article ID |
| `stats` | Platform statistics | Stat type ID |
| `brands` | Brand catalog | Auto-generated |
| `reports` | Content reports | Auto-generated |

---

## Core Models

### User

```typescript
interface User {
  id: string;                    // Firebase Auth UID
  email: string;                 // Email address
  displayName?: string;          // Display name
  bio?: string;                  // User bio
  profileImage?: string;         // Profile photo URL
  createdAt: Date;               // Account creation date
  rating?: number;               // Average rating (1-5)
  phoneNumber?: string;          // Phone number
  address?: {
    street: string;
    city: string;
    postalCode: string;
    country: string;
  };
  accountType?: 'user' | 'shop'; // Account type
  isAdmin?: boolean;             // Admin flag
  preferences?: UserPreferences;
  onboardingCompleted?: boolean;
}

interface UserPreferences {
  sizes: string[];               // Preferred sizes
  favoriteBrands: string[];      // Favorite brands
  location?: {
    latitude: number;
    longitude: number;
    city: string;
  };
  shippingCarriers?: string[];   // Preferred carriers
  notifications?: {
    email: boolean;
    push: boolean;
    newMessages: boolean;
    newOrders: boolean;
    priceDrops: boolean;
  };
  privacy?: {
    showProfilePhoto: boolean;
    allowSearchEngines: boolean;
  };
}
```

### Article

```typescript
interface Article {
  id: string;                    // Document ID
  title: string;                 // Article title (3-100 chars)
  description: string;           // Description (10-2000 chars)
  price: number;                 // Price in EUR (0.01-10000)
  images: ArticleImage[];        // 1-10 images

  // Category
  category: string;              // @deprecated - Use categoryIds
  categoryIds: string[];         // Hierarchical IDs: ['home', 'home_decoration']

  // Attributes
  size?: string;                 // Size (S, M, L, etc.)
  brand?: string;                // Brand name
  color?: string;                // Color
  material?: string;             // Material
  pattern?: string;              // Pattern
  condition: 'neuf' | 'très bon état' | 'bon état' | 'satisfaisant';

  // Seller info
  sellerId: string;              // Seller's UID
  sellerName: string;            // Seller's display name
  sellerImage?: string;          // Seller's profile image

  // Metadata
  createdAt: Date;               // Creation timestamp
  isActive: boolean;             // Is listing active
  isSold: boolean;               // Is item sold
  likes: number;                 // Like count
  views: number;                 // View count

  // Shipping
  location?: string;             // City or postal code
  weight?: number;               // Weight in kg
  dimensions?: ArticleDimensions;
  isHandDelivery?: boolean;      // Hand delivery available
  isShipping?: boolean;          // Shipping available
  packageSize?: 'small' | 'medium' | 'large';
}

interface ArticleImage {
  url: string;                   // Firebase Storage URL
  blurhash?: string;             // Blurhash placeholder
}

interface ArticleDimensions {
  length: number;                // cm
  width: number;                 // cm
  height: number;                // cm
}
```

### Chat & Messages

```typescript
interface Chat {
  id: string;                    // Document ID
  participants: string[];        // [userId1, userId2]
  participantsInfo: ChatParticipant[];
  articleId?: string;            // Related article ID
  articleTitle?: string;         // Article title snapshot
  articleImage?: string;         // Article image snapshot
  articlePrice?: number;         // Article price snapshot
  lastMessage?: string;          // Last message preview
  lastMessageType?: MessageType;
  lastMessageTimestamp?: Date;
  unreadCount: { [userId: string]: number };
  createdAt: Date;
  updatedAt: Date;
}

interface ChatParticipant {
  userId: string;
  userName: string;
  userImage?: string;
}

interface Message {
  id: string;                    // Document ID
  chatId: string;                // Parent chat ID
  senderId: string;              // Sender UID
  receiverId: string;            // Receiver UID
  type: 'text' | 'image' | 'offer' | 'system';
  content: string;               // Message content
  timestamp: Date;
  status: 'sending' | 'sent' | 'delivered' | 'read';
  isRead: boolean;
  offer?: MessageOffer;          // For type='offer'
  image?: MessageImage;          // For type='image'
}

interface MessageOffer {
  amount: number;                // Offer price
  status: 'pending' | 'accepted' | 'rejected';
  message?: string;              // Offer message
  shippingAddress?: ShippingAddress;
  shippingEstimate?: ShippingEstimate;
  totalAmount?: number;          // amount + shipping
}
```

### Transaction

```typescript
interface Transaction {
  id: string;                    // Document ID
  articleId: string;             // Purchased article
  buyerId: string;               // Buyer UID
  sellerId: string;              // Seller UID
  amount: number;                // Item price
  shippingCost: number;          // Shipping cost
  totalAmount: number;           // Total paid
  status: 'pending_payment' | 'paid' | 'shipped' | 'delivered' | 'cancelled';

  // Stripe
  paymentIntentId?: string;      // Stripe Payment Intent

  // Shippo
  shippoTransactionId?: string;  // Shippo transaction
  shippingLabelUrl?: string;     // Label PDF URL
  trackingNumber?: string;       // Tracking number
  trackingStatus?: string;       // Current status
  trackingUrl?: string;          // Tracking page URL

  // Address
  shippingAddress?: ShippingAddress;

  // Timestamps
  createdAt: Date;
  paidAt?: Date;
  shippedAt?: Date;
  deliveredAt?: Date;
}

interface ShippingAddress {
  name: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phoneNumber?: string;
}

interface ShippingEstimate {
  carrier: string;               // e.g., "colissimo"
  serviceName: string;           // Service description
  estimatedDays: string;         // e.g., "2-3 days"
  amount: number;                // Cost in EUR
  currency: string;              // "EUR"
  shippoRateId: string;          // Shippo rate ID
}
```

### Shop

```typescript
interface Shop {
  id: string;                    // Document ID
  ownerId: string;               // Owner UID
  name: string;                  // Shop name
  description: string;           // Description
  type: ShopType;                // Shop category

  // Location
  address: ShopAddress;
  location: ShopLocation;        // Coordinates for geoqueries

  // Contact
  phoneNumber: string;
  email: string;
  website?: string;
  socialMedia?: ShopSocialMedia;

  // Hours
  openingHours: OpeningHours;

  // Media
  logo?: string;                 // Logo URL
  images: string[];              // Shop photos

  // Status
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  verificationDetails?: ShopVerificationDetails;

  // Legal (for verified shops)
  legalInfo?: ShopLegalInfo;

  // Stats
  rating?: number;
  reviewCount: number;
  articlesCount: number;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

type ShopType =
  | 'friperie'           // Thrift store
  | 'depot-vente'        // Consignment
  | 'vintage'            // Vintage shop
  | 'luxe-seconde-main'  // Luxury second-hand
  | 'streetwear'
  | 'concept-store'
  | ... // 20 total types

interface ShopLocation {
  latitude: number;
  longitude: number;
  geohash?: string;              // For Firestore geoqueries
}
```

### Seller Balance

```typescript
interface SellerBalance {
  userId: string;                // Seller UID (doc ID)
  availableBalance: number;      // Withdrawable amount
  pendingBalance: number;        // In transit (not yet withdrawable)
  totalEarnings: number;         // All-time earnings
  transactions: {
    id: string;
    type: 'sale' | 'withdrawal';
    amount: number;
    description: string;
    createdAt: Date;
    status: 'completed' | 'pending' | 'failed';
  }[];
  updatedAt: Date;
}
```

### Notification

```typescript
interface Notification {
  id: string;
  userId: string;                // Recipient UID
  type: NotificationType;
  title: string;
  message: string;
  data?: any;                    // Additional data
  isRead: boolean;
  createdAt: Date;
}

type NotificationType =
  | 'shop_created'
  | 'shop_approved'
  | 'shop_rejected'
  | 'new_message'
  | 'article_liked'
  | 'article_sold'
  | 'offer_received';
```

---

## Search & Filtering

### SearchFilters

```typescript
interface SearchFilters {
  category?: string;             // Legacy single category
  categoryIds?: string[];        // Hierarchical category IDs
  colors: string[];
  sizes: string[];
  materials: string[];
  condition?: string;
  minPrice?: number;
  maxPrice?: number;
  brands?: string[];
  patterns?: string[];
  sortBy?: 'recent' | 'price_asc' | 'price_desc' | 'popular';
}
```

### Indexed Fields (Firestore)

```
articles:
  - isActive (ASC) + isSold (ASC) + createdAt (DESC)
  - isActive (ASC) + isSold (ASC) + category (ASC) + createdAt (DESC)
  - isActive (ASC) + isSold (ASC) + condition (ASC) + createdAt (DESC)
  - isActive (ASC) + isSold (ASC) + price (ASC/DESC) + createdAt (DESC)
  - sellerId (ASC) + createdAt (DESC)
  - categoryIds (ARRAY_CONTAINS)
```

---

## Static Data Files

Located in `/data/`:

| File | Purpose |
|------|---------|
| `brands-list.json` | 4000+ brand names |
| `brands.ts` | Brand utilities |
| `categories-v2.ts` | Hierarchical categories |
| `colors.ts` | Color options |
| `materials.ts` | Material options |
| `patterns.ts` | Pattern options |
| `sizes.ts` | Size charts by category |
| `shipping.ts` | Shipping carrier configs |
