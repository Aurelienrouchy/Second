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

Development and production use separate Firebase projects:

| Launch | Firebase project | Native app |
|--------|------------------|------------|
| Local, EAS development / preview | `seconde-dev` | `com.seconde.app.dev` / Seconde Dev |
| EAS production | `seconde-b47a6` | `com.seconde.app` / Seconde |
| Explicit emulator run | `demo-second` | Development only |

Public SDK configurations are complete tuples in `config/firebaseProjects.json`.
Local runs cannot select production. Sessions, drafts, private files and journals
are partitioned. Restart the app completely after changing project or transport.

The root `.env.example` lists optional **dedicated dev** OAuth, Maps and analytics
settings. Google dev login remains unavailable until its own OAuth clients exist.
Do not reuse production accounts, secrets or device tokens.

Server configuration is selected by project, without a shared `functions/.env`:

```env
# functions/.env.seconde-dev
SECONDE_ENV=development
SECONDE_PROJECT_ID=seconde-dev
PAYMENTS_ENABLED=false
SHIPPING_ENABLED=false
```

Production values belong only in `functions/.env.seconde-b47a6`; credentials
belong in each project's Secret Manager. Both per-project local files are ignored
by Git. Dev rejects live Stripe credentials and disables external push/analytics.

### 3. Firebase Setup

The cloud dev project uses a Standard Firestore database and Storage in
`northamerica-northeast1` (Montréal). On 2026-10-25, the founder authorized its
billing and deployment. Email/password Auth, Firestore/Storage rules, 97 indexes
and the 30 functions of `catalogue_account_and_photo_ai` are deployed. The runtime
uses its own service account and at most two instances per function.
Cross-service Storage rules use the Firebase Storage service agent with
`roles/firebaserules.firestoreServiceAgent` on the dev project; granting this
server role does not open client rules.

`npm run deploy:dev` redeploys that exact package from `functions/dev-deploy.json`
using `firebase.dev.json`, always on `seconde-dev`. The second package remains
undeployed. No Stripe/ShipEngine credentials, payment/shipping rail or scheduled
job is enabled. Without a financial provider, the independent operational control
permits only its bounded catalogue operations; it does not qualify funds or
authorize meetup/swap financial mutations. Gemini has a new dedicated dev secret;
photo search uses Vertex on the dev project. Google/Apple dev sign-in and a new
native dev binary require their own setup; use email/password in the existing
development client. Any further deployment still follows `AGENTS.md`.

Live dev verification passed on 2026-10-25: client signup/profile, consent,
adult Québec personal-seller admission, synthetic verified email, Storage draft
upload/read, Vertex photo search, article publication and published-image read.
The synthetic account, documents and files were cleaned up. Financial operations
and the still-undeployed second package were not qualified by this verification.
Always specify `--project dev` or `--project prod` in Firebase CLI commands.
`.firebaserc` defaults to dev. Never use `--force` on production functions.

---

## Running the App

### Development Server

```bash
# Start Expo
npm start

# Development client, including a physical device on the same network
npm run start:dev-client

# Optional tunnel, still forced to cloud dev
npm start -- --tunnel
```

### Platform-Specific

```bash
# iOS Simulator
npm run ios

# Android Emulator
npm run android

# Native dev identity requires a new dev build after changing app.config.js.
# EAS excludes checked-in ios/android and generates the selected variant.
```

---

## Firebase Emulators

### Start Emulators

```bash
npx -y firebase-tools@latest emulators:start --project demo-second --only auth,firestore,functions,storage

# In another terminal: use demo-second, with no cloud fallback
npm run start:emulators
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
