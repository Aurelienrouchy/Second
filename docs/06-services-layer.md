# Services Layer

## Overview

The services layer encapsulates all business logic and Firebase interactions. Each service is a static class with methods for CRUD operations and domain-specific functionality.

---

## Service Architecture

```
services/
├── articlesService.ts     # Product/article management
├── authService.ts         # Authentication flows
├── chatService.ts         # Messaging system
├── favoritesService.ts    # User favorites
├── notificationService.ts # Push notifications
├── sellerBalanceService.ts# Seller earnings
├── shopService.ts         # Shop profiles
├── transactionService.ts  # Purchase records
├── userService.ts         # User profiles
├── statsService.ts        # Statistics
└── searchService.ts       # Search functionality
```

---

## ArticlesService

Manages product listings with full CRUD, search, and image handling.

### Methods

#### `createArticle(articleData, images)`
Creates a new article with image upload.

```typescript
static async createArticle(
  articleData: Partial<Article>,
  images: string[]
): Promise<string>
```

**Flow:**
1. Upload images to Firebase Storage with compression
2. Generate blurhash placeholders
3. Create article document in Firestore
4. Return article ID

---

#### `searchArticles(query, filters, lastDoc, limit)`
Advanced search with multiple filter options.

```typescript
static async searchArticles(
  query?: string,
  filters?: SearchFilters,
  lastDoc?: any,
  limit?: number
): Promise<{ articles: Article[]; lastDoc: any }>
```

**Filter Options:**
- `category` / `categoryIds` - Category filtering
- `colors` - Array of color values
- `sizes` - Array of size values
- `materials` - Array of materials
- `condition` - Item condition
- `minPrice` / `maxPrice` - Price range
- `brands` - Array of brand names
- `patterns` - Array of patterns
- `sortBy` - `'recent'` | `'price_asc'` | `'price_desc'` | `'popular'`

---

#### `likeArticle(articleId, userId)` / `unlikeArticle(articleId, userId)`
Manages article likes and user favorites.

```typescript
static async likeArticle(articleId: string, userId: string): Promise<void>
static async unlikeArticle(articleId: string, userId: string): Promise<void>
```

---

#### `uploadImagesReactNative(images, articleId)`
Handles image compression and upload.

```typescript
private static async uploadImagesReactNative(
  images: string[],
  articleId: string
): Promise<ArticleImage[]>
```

**Processing:**
- Resizes to max 1200px width
- Compresses to 80% quality
- Generates blurhash for lazy loading
- Uploads to `articles/{articleId}/` path

---

## ChatService

Real-time messaging with offers and image support.

### Methods

#### `createOrGetChat(user1Id, user2Id, articleId?)`
Creates a new chat or returns existing one.

```typescript
static async createOrGetChat(
  user1Id: string,
  user2Id: string,
  articleId?: string
): Promise<Chat>
```

**Features:**
- Deduplicates by sorted participant IDs
- Caches article info (title, image, price)
- Initializes unread counts

---

#### `sendMessage(chatId, senderId, receiverId, content)`
Sends a text message.

```typescript
static async sendMessage(
  chatId: string,
  senderId: string,
  receiverId: string,
  content: string
): Promise<string>
```

---

#### `sendImage(chatId, senderId, receiverId, imageUri)`
Sends an image message with thumbnail.

```typescript
static async sendImage(
  chatId: string,
  senderId: string,
  receiverId: string,
  imageUri: string
): Promise<string>
```

**Processing:**
- Compresses main image to 1024px, 70% quality
- Creates 200px thumbnail at 50% quality
- Uploads both to `chat_images/{chatId}/`

---

#### `sendOffer(chatId, senderId, receiverId, amount, ...)`
Sends a purchase offer with optional shipping.

```typescript
static async sendOffer(
  chatId: string,
  senderId: string,
  receiverId: string,
  amount: number,
  message?: string,
  shippingAddress?: ShippingAddress,
  shippingEstimate?: ShippingEstimate
): Promise<string>
```

---

#### `acceptOffer(chatId, messageId, offerId, userId)` / `rejectOffer(...)`
Handle offer responses.

```typescript
static async acceptOffer(chatId, messageId, offerId, userId): Promise<void>
static async rejectOffer(chatId, messageId, offerId, userId): Promise<void>
```

---

#### `listenToMessages(chatId, onUpdate, onError?)`
Real-time message subscription.

```typescript
static listenToMessages(
  chatId: string,
  onUpdate: (messages: Message[]) => void,
  onError?: (error: Error) => void
): () => void  // Returns unsubscribe function
```

---

#### `listenToUserChats(userId, onUpdate, onError?)`
Real-time chat list subscription.

```typescript
static listenToUserChats(
  userId: string,
  onUpdate: (chats: Chat[]) => void,
  onError?: (error: Error) => void
): () => void
```

---

## TransactionService

Manages purchase transactions from creation to delivery.

### Methods

#### `createTransaction(...)`
Creates a new transaction after offer acceptance.

```typescript
static async createTransaction(
  articleId: string,
  buyerId: string,
  sellerId: string,
  amount: number,
  shippingCost: number,
  shippingAddress: ShippingAddress
): Promise<string>
```

---

#### `getTransaction(transactionId)`
Retrieves transaction by ID.

```typescript
static async getTransaction(
  transactionId: string
): Promise<Transaction | null>
```

---

#### `updateTransactionStatus(transactionId, status, additionalData?)`
Updates transaction status with automatic timestamps.

```typescript
static async updateTransactionStatus(
  transactionId: string,
  status: 'pending_payment' | 'paid' | 'shipped' | 'delivered' | 'cancelled',
  additionalData?: Partial<Transaction>
): Promise<void>
```

---

#### `getUserTransactions(userId)`
Gets all transactions for a user (as buyer or seller).

```typescript
static async getUserTransactions(
  userId: string
): Promise<Transaction[]>
```

---

## ShopService

Manages physical store profiles with geolocation.

### Key Methods

```typescript
// CRUD
static async createShop(shopData: Partial<Shop>): Promise<string>
static async getShopById(shopId: string): Promise<Shop | null>
static async updateShop(shopId: string, updates: Partial<Shop>): Promise<void>

// Discovery
static async getShopsNearby(
  latitude: number,
  longitude: number,
  radiusKm: number
): Promise<Shop[]>

static async searchShops(
  query: string,
  type?: ShopType,
  city?: string
): Promise<Shop[]>

// Moderation
static async getShopsPendingApproval(): Promise<Shop[]>
static async approveShop(shopId: string, adminId: string): Promise<void>
static async rejectShop(shopId: string, adminId: string, reason: string): Promise<void>
```

---

## UserService

User profile management.

### Key Methods

```typescript
static async getUserById(userId: string): Promise<User | null>
static async updateUserProfile(userId: string, updates: Partial<User>): Promise<void>
static async updateUserPreferences(userId: string, preferences: UserPreferences): Promise<void>
static async setUserAddress(userId: string, address: Address): Promise<void>
```

---

## FavoritesService

User favorites/wishlist management.

### Key Methods

```typescript
static async getFavorites(userId: string): Promise<string[]>
static async addFavorite(userId: string, articleId: string): Promise<void>
static async removeFavorite(userId: string, articleId: string): Promise<void>
static async isFavorite(userId: string, articleId: string): Promise<boolean>
static listenToFavorites(userId: string, callback: (articleIds: string[]) => void): () => void
```

---

## NotificationService

Push notification handling.

### Key Methods

```typescript
static async registerForPushNotifications(userId: string): Promise<string | null>
static async saveFCMToken(userId: string, token: string): Promise<void>
static async removeFCMToken(userId: string, token: string): Promise<void>
static async sendLocalNotification(title: string, body: string, data?: any): Promise<void>
```

---

## SellerBalanceService

Seller earnings and withdrawal management.

### Key Methods

```typescript
static async getSellerBalance(userId: string): Promise<SellerBalance | null>
static async getBalanceTransactions(userId: string): Promise<BalanceTransaction[]>
static listenToBalance(userId: string, callback: (balance: SellerBalance) => void): () => void
```

---

## Usage Patterns

### Basic CRUD

```typescript
import { ArticlesService } from '../services/articlesService';

// Create
const articleId = await ArticlesService.createArticle(data, images);

// Read
const article = await ArticlesService.getArticleById(articleId);

// Update
await ArticlesService.updateArticle(articleId, { price: 25 });

// Delete
await ArticlesService.deleteArticle(articleId);
```

### Real-time Subscriptions

```typescript
import { ChatService } from '../services/chatService';

// Subscribe
const unsubscribe = ChatService.listenToMessages(
  chatId,
  (messages) => setMessages(messages),
  (error) => console.error(error)
);

// Cleanup on unmount
useEffect(() => {
  return () => unsubscribe();
}, []);
```

### Search with Filters

```typescript
import { ArticlesService } from '../services/articlesService';

const { articles, lastDoc } = await ArticlesService.searchArticles(
  'vintage jacket',
  {
    categoryIds: ['clothing_jackets'],
    colors: ['black', 'brown'],
    minPrice: 20,
    maxPrice: 100,
    sortBy: 'price_asc',
  },
  undefined, // lastDoc for pagination
  20         // limit
);
```
