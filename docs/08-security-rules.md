# Security Rules

## Overview

Firestore Security Rules protect data access at the database level. Freepe implements comprehensive rules for all collections with role-based access control.

**Location**: `/firestore.rules`

---

## Rule Structure

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Helper functions
    // Collection rules
  }
}
```

---

## Helper Functions

### `isAuthenticated()`
Checks if user is logged in.

```javascript
function isAuthenticated() {
  return request.auth != null;
}
```

### `isOwner(userId)`
Checks if authenticated user owns the resource.

```javascript
function isOwner(userId) {
  return isAuthenticated() && request.auth.uid == userId;
}
```

### `isAdmin()`
Checks if user has admin privileges.

```javascript
function isAdmin() {
  return isAuthenticated() &&
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAdmin == true;
}
```

---

## Collection Rules Summary

| Collection | Read | Create | Update | Delete |
|------------|------|--------|--------|--------|
| `users` | Own data | Auth | Own data | Never |
| `articles` | Public (active) | Auth | Owner | Owner |
| `chats` | Participant | Auth | Participant | Never |
| `messages` | Participant | Participant | Sender | Never |
| `favorites` | Owner | Owner | Owner | Owner |
| `transactions` | Participant | Auth | Conditional | Never |
| `shops` | Public (approved) | Auth | Owner/Admin | Admin |
| `brands` | Public | Admin | Admin | Admin |
| `notifications` | Owner | System | Owner (read) | Never |
| `stats` | Public | Never | Never | Never |
| `search_index` | Public | System | System | System |
| `seller_balances` | Owner | System | System | Never |
| `reports` | Admin | Auth | Admin | Admin |

---

## Detailed Rules

### Users Collection

```javascript
match /users/{userId} {
  // Anyone can read basic profile
  allow read: if isAuthenticated();

  // Users can only create their own profile
  allow create: if isOwner(userId);

  // Users can only update their own profile
  allow update: if isOwner(userId);

  // Never allow delete
  allow delete: if false;
}
```

---

### Articles Collection

```javascript
match /articles/{articleId} {
  // Public read for active articles
  allow read: if resource.data.isActive == true ||
               isOwner(resource.data.sellerId);

  // Authenticated users can create
  allow create: if isAuthenticated() &&
                 request.resource.data.sellerId == request.auth.uid &&
                 validateArticle(request.resource.data);

  // Owner can update
  allow update: if isOwner(resource.data.sellerId) &&
                 request.resource.data.sellerId == resource.data.sellerId;

  // Owner can delete
  allow delete: if isOwner(resource.data.sellerId);
}

function validateArticle(article) {
  return article.title.size() >= 3 &&
         article.title.size() <= 100 &&
         article.description.size() >= 10 &&
         article.price > 0 &&
         article.price <= 10000;
}
```

---

### Chats Collection

```javascript
match /chats/{chatId} {
  // Only participants can read
  allow read: if isAuthenticated() &&
               request.auth.uid in resource.data.participants;

  // Authenticated users can create (must be participant)
  allow create: if isAuthenticated() &&
                 request.auth.uid in request.resource.data.participants;

  // Only participants can update
  allow update: if isAuthenticated() &&
                 request.auth.uid in resource.data.participants;

  // Never delete chats
  allow delete: if false;
}
```

---

### Messages Collection

```javascript
match /messages/{messageId} {
  // Participants can read
  allow read: if isAuthenticated() &&
               isParticipantInChat(resource.data.chatId);

  // Sender can create
  allow create: if isAuthenticated() &&
                 request.resource.data.senderId == request.auth.uid &&
                 isParticipantInChat(request.resource.data.chatId);

  // Sender can update (for offer status)
  allow update: if isAuthenticated() &&
                 (resource.data.senderId == request.auth.uid ||
                  resource.data.receiverId == request.auth.uid);

  // Never delete
  allow delete: if false;
}

function isParticipantInChat(chatId) {
  return request.auth.uid in
    get(/databases/$(database)/documents/chats/$(chatId)).data.participants;
}
```

---

### Transactions Collection

```javascript
match /transactions/{transactionId} {
  // Buyer or seller can read
  allow read: if isAuthenticated() &&
               (resource.data.buyerId == request.auth.uid ||
                resource.data.sellerId == request.auth.uid);

  // Buyer can create
  allow create: if isAuthenticated() &&
                 request.resource.data.buyerId == request.auth.uid;

  // Limited updates based on status
  allow update: if isAuthenticated() &&
                 canUpdateTransaction(resource.data, request.resource.data);

  // Never delete
  allow delete: if false;
}

function canUpdateTransaction(before, after) {
  // Only allow status transitions and specific field updates
  return before.buyerId == after.buyerId &&
         before.sellerId == after.sellerId &&
         before.articleId == after.articleId &&
         before.amount == after.amount;
}
```

---

### Shops Collection

```javascript
match /shops/{shopId} {
  // Public read for approved shops
  allow read: if resource.data.status == 'approved' ||
               isOwner(resource.data.ownerId) ||
               isAdmin();

  // Authenticated users can create
  allow create: if isAuthenticated() &&
                 request.resource.data.ownerId == request.auth.uid &&
                 request.resource.data.status == 'pending';

  // Owner or admin can update
  allow update: if isOwner(resource.data.ownerId) || isAdmin();

  // Only admin can delete
  allow delete: if isAdmin();
}
```

---

### Favorites Collection

```javascript
match /favorites/{userId} {
  // Owner only
  allow read, write: if isOwner(userId);
}
```

---

### Seller Balances Collection

```javascript
match /seller_balances/{userId} {
  // Owner can read
  allow read: if isOwner(userId);

  // Only Cloud Functions can write (admin SDK bypasses rules)
  allow write: if false;
}
```

---

### Notifications Collection

```javascript
match /notifications/{notificationId} {
  // Owner can read
  allow read: if isAuthenticated() &&
               resource.data.userId == request.auth.uid;

  // Only allow updating isRead
  allow update: if isAuthenticated() &&
                 resource.data.userId == request.auth.uid &&
                 request.resource.data.diff(resource.data).affectedKeys()
                   .hasOnly(['isRead']);

  // System creates (via admin SDK)
  allow create, delete: if false;
}
```

---

### Stats Collection

```javascript
match /stats/{statId} {
  // Public read
  allow read: if true;

  // Only Cloud Functions can write
  allow write: if false;
}
```

---

### Search Index Collection

```javascript
match /search_index/{productId} {
  // Public read for search
  allow read: if true;

  // Only Cloud Functions can write
  allow write: if false;
}
```

---

### Reports Collection

```javascript
match /reports/{reportId} {
  // Admin can read all
  allow read: if isAdmin();

  // Authenticated users can create
  allow create: if isAuthenticated() &&
                 request.resource.data.reporterId == request.auth.uid;

  // Admin can update/delete
  allow update, delete: if isAdmin();
}
```

---

## Testing Rules

### Firebase Emulator

```bash
firebase emulators:start --only firestore
```

### Unit Tests

```typescript
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

// Test authenticated read
await assertSucceeds(
  userDoc.get()
);

// Test unauthorized write
await assertFails(
  otherUserDoc.set({ name: 'hacker' })
);
```

---

## Deployment

```bash
# Deploy rules only
firebase deploy --only firestore:rules

# Validate rules before deploy
firebase emulators:start --only firestore
```

---

## Best Practices Applied

1. **Principle of Least Privilege**: Users only access what they need
2. **Validation**: Input validation in create/update rules
3. **No Cascading Deletes**: Soft deletes preferred
4. **Admin Bypass**: Admin SDK (Cloud Functions) bypasses all rules
5. **Immutable Fields**: Prevent changes to IDs, owners, timestamps
6. **Rate Limiting**: Consider adding rate limit rules for production
