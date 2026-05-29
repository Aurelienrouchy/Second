# Required Firestore Indexes for useProducts Hook

## Composite Indexes

Add these indexes to your `firestore.indexes.json` file or create them in the Firebase Console:

```json
{
  "indexes": [
    {
      "collectionGroup": "avis",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "vendeurId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "avis",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "reviewerId", "order": "ASCENDING" },
        { "fieldPath": "transactionId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "sellerId", "order": "ASCENDING" },
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "sellerId", "order": "ASCENDING" },
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "sellerId", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "categoryIds", "arrayConfig": "CONTAINS" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "categoryIds", "arrayConfig": "CONTAINS" },
        { "fieldPath": "condition", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "categoryIds", "arrayConfig": "CONTAINS" },
        { "fieldPath": "price", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "categoryIds", "arrayConfig": "CONTAINS" },
        { "fieldPath": "condition", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "categoryIds", "arrayConfig": "CONTAINS" },
        { "fieldPath": "price", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "condition", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "lastPriceDropAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION", 
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "category", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "condition", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "category", "order": "ASCENDING" },
        { "fieldPath": "condition", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "category", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "condition", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "sellerId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "fundsReleaseAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "sellerId", "order": "ASCENDING" },
        { "fieldPath": "disputed", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "swaps",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "swaps",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "partyId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "swapPartyItems",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "partyId", "order": "ASCENDING" },
        { "fieldPath": "articleId", "order": "ASCENDING" },
        { "fieldPath": "sellerId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "messages",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "offer.status", "order": "ASCENDING" },
        { "fieldPath": "offer.expiresAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "messages",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "chatId", "order": "ASCENDING" },
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "offer.status", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

## Single Field Indexes (Auto-created)

These are automatically created by Firestore:
- `isActive` (ascending/descending)
- `isSold` (ascending/descending) 
- `category` (ascending/descending)
- `condition` (ascending/descending)
- `price` (ascending/descending)
- `createdAt` (ascending/descending)
- `sellerId` (ascending/descending)

## Firebase CLI Commands

Deploy indexes using Firebase CLI:

```bash
# Deploy indexes
firebase deploy --only firestore:indexes

# Check index status
firebase firestore:indexes

# Delete unused indexes
firebase firestore:indexes:delete
```

## Performance Considerations

1. **Geolocation Queries**: The current implementation fetches more documents and sorts client-side. For better performance at scale, consider:
   - Using GeoFirestore library for geo-queries
   - Pre-calculating distance ranges in document fields
   - Using Algolia or Elasticsearch for complex geo-search

2. **Real-time Listeners**: Limited to top 10 items to minimize bandwidth and costs.

3. **Client-side Filtering**: Brand, size, and color filters are applied client-side since they require partial string matching.

## Required Article Document Structure

Ensure your articles collection documents have this structure:

```typescript
{
  id: string,
  title: string,
  price: number,
  category: string,
  condition: 'neuf' | 'très bon état' | 'bon état' | 'satisfaisant',
  isActive: boolean,
  isSold: boolean,
  createdAt: Timestamp,
  sellerId: string,
  sellerName: string,
  sellerImage?: string,
  images: ArticleImage[],
  location?: {
    lat: number,
    lon: number,
    address?: string
  },
  // Optional fields for filtering
  brand?: string,
  size?: string,
  color?: string,
  material?: string,
  pattern?: string,
  deliveryOption?: 'pickup' | 'shipping' | 'both'
}
```

## Security Rules

Add these Firestore security rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /articles/{articleId} {
      // Allow read for active, non-sold articles
      allow read: if resource.data.isActive == true && resource.data.isSold == false;
      
      // Allow write only for authenticated users and their own articles
      allow create: if request.auth != null && request.auth.uid == resource.data.sellerId;
      allow update: if request.auth != null && request.auth.uid == resource.data.sellerId;
      allow delete: if request.auth != null && request.auth.uid == resource.data.sellerId;
    }
  }
}
```



