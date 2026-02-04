# Development Guide

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20.x | Runtime |
| npm | 10.x | Package manager |
| Expo CLI | Latest | Development server |
| Firebase CLI | Latest | Backend deployment |
| Xcode | 15+ | iOS builds |
| Android Studio | Latest | Android builds |

---

## Initial Setup

### 1. Clone and Install

```bash
# Clone repository
git clone <repo-url>
cd Seconde

# Install app dependencies
npm install

# Install functions dependencies
cd functions && npm install && cd ..
```

### 2. Environment Configuration

Create `.env` in project root:

```env
# Facebook Login
FB_APP_ID=your_facebook_app_id

# Stripe (publishable key for mobile)
STRIPE_PUBLISHABLE_KEY=pk_test_...

# Optional: API URLs
API_URL=https://your-project.cloudfunctions.net
```

Create `functions/.env`:

```env
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Shippo
SHIPPO_API_KEY=shippo_test_...
```

### 3. Firebase Setup

```bash
# Login to Firebase
firebase login

# Select project
firebase use your-project-id

# Deploy security rules
firebase deploy --only firestore:rules,storage:rules
```

---

## Running the App

### Development Server

```bash
# Start Expo
npm start

# Or with tunnel (for physical devices)
npx expo start --tunnel
```

### Platform-Specific

```bash
# iOS Simulator
npm run ios

# Android Emulator
npm run android

# Web (limited support)
npm run web
```

---

## Firebase Emulators

### Start Emulators

```bash
# All emulators
firebase emulators:start

# Specific emulators
firebase emulators:start --only auth,firestore,functions,storage
```

### Emulator Ports

| Service | Port | UI |
|---------|------|-----|
| Auth | 9099 | - |
| Firestore | 8080 | - |
| Functions | 5001 | - |
| Storage | 9199 | - |
| Emulator UI | 4000 | http://localhost:4000 |

### Connect App to Emulators

In `config/firebaseConfig.ts`:

```typescript
if (__DEV__) {
  auth().useEmulator('http://localhost:9099');
  firestore().useEmulator('localhost', 8080);
  functions().useEmulator('localhost', 5001);
  storage().useEmulator('localhost', 9199);
}
```

---

## Project Structure

```
Seconde/
├── app/                    # Screens (Expo Router)
│   ├── (tabs)/            # Tab navigation
│   ├── settings/          # Settings stack
│   ├── admin/             # Admin screens
│   ├── article/[id].tsx   # Article detail
│   ├── chat/[id].tsx      # Chat screen
│   └── shop/[id].tsx      # Shop profile
│
├── components/            # Reusable components
│   ├── ProductCard.tsx
│   ├── ChatBubble.tsx
│   └── ...
│
├── contexts/              # React Context providers
│   ├── AuthContext.tsx
│   ├── ChatContext.tsx
│   └── ...
│
├── hooks/                 # Custom hooks
│   ├── useArticleSearch.ts
│   ├── useChat.ts
│   └── ...
│
├── services/              # Business logic
│   ├── articlesService.ts
│   ├── chatService.ts
│   └── ...
│
├── data/                  # Static data
│   ├── categories-v2.ts
│   ├── brands-list.json
│   └── ...
│
├── types/                 # TypeScript definitions
│   └── index.ts
│
├── config/                # Configuration
│   └── firebaseConfig.ts
│
├── functions/             # Cloud Functions
│   ├── src/index.ts
│   └── package.json
│
└── docs/                  # Documentation
```

---

## Common Development Tasks

### Adding a New Screen

1. Create file in `app/` directory:

```typescript
// app/new-screen.tsx
import { View, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

export default function NewScreen() {
  const params = useLocalSearchParams();

  return (
    <View>
      <Text>New Screen</Text>
    </View>
  );
}
```

2. Navigate to it:

```typescript
import { router } from 'expo-router';

router.push('/new-screen');
```

---

### Adding a New Service

1. Create service file:

```typescript
// services/newService.ts
import { collection, addDoc } from '@react-native-firebase/firestore';
import { firestore } from '../config/firebaseConfig';

export class NewService {
  static async create(data: any): Promise<string> {
    const ref = collection(firestore, 'collection_name');
    const doc = await addDoc(ref, data);
    return doc.id;
  }
}
```

2. Add types:

```typescript
// types/index.ts
export interface NewType {
  id: string;
  // ...fields
}
```

3. Add security rules in `firestore.rules`.

---

### Adding a Cloud Function

1. Add function in `functions/src/index.ts`:

```typescript
export const newFunction = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  // Logic here

  return { success: true };
});
```

2. Deploy:

```bash
cd functions
npm run build
firebase deploy --only functions:newFunction
```

3. Call from app:

```typescript
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';

const functions = getFunctions();
const newFunction = httpsCallable(functions, 'newFunction');
const result = await newFunction({ param: 'value' });
```

---

## Building for Production

### iOS

```bash
# Install Pods
cd ios && pod install && cd ..

# Build with EAS
eas build --platform ios

# Or local build
npx expo run:ios --configuration Release
```

### Android

```bash
# Build with EAS
eas build --platform android

# Or local build
cd android && ./gradlew assembleRelease
```

---

## Debugging

### React Native Debugger

```bash
# Install
brew install react-native-debugger

# Start before app
open "rndebugger://set-debugger-loc?host=localhost&port=8081"
```

### Firebase Logs

```bash
# View function logs
firebase functions:log

# Stream logs
firebase functions:log --follow
```

### Network Debugging

Use Flipper or React Native Debugger network tab.

---

## Testing

### Unit Tests

```bash
npm test
```

### E2E Tests (Detox)

```bash
# Build test app
detox build --configuration ios.sim.debug

# Run tests
detox test --configuration ios.sim.debug
```

---

## Deployment Checklist

### Before Release

- [ ] Update version in `app.config.js`
- [ ] Test on physical devices
- [ ] Verify all API keys are production
- [ ] Run security rules tests
- [ ] Check Firebase quotas
- [ ] Review crash analytics

### Deploy Backend

```bash
# Deploy all
firebase deploy

# Or specific services
firebase deploy --only functions
firebase deploy --only firestore:rules
firebase deploy --only storage:rules
```

### App Store Submission

1. Build production app with EAS
2. Submit to App Store Connect / Google Play Console
3. Complete app review requirements
4. Monitor crash reports post-release

---

## Troubleshooting

### Common Issues

**Metro bundler issues:**
```bash
# Clear cache
npx expo start --clear

# Reset watchman
watchman watch-del-all
```

**iOS Pod issues:**
```bash
cd ios
pod deintegrate
pod install
cd ..
```

**Android build issues:**
```bash
cd android
./gradlew clean
cd ..
```

**Firebase connection issues:**
- Verify `google-services.json` (Android)
- Verify `GoogleService-Info.plist` (iOS)
- Check Firebase project configuration
