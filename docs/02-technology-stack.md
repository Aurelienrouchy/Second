# Technology Stack

## Mobile Application

### Core Framework
| Technology | Version | Purpose |
|------------|---------|---------|
| Expo | 53.0.22 | React Native framework & tooling |
| React Native | 0.79.5 | Cross-platform mobile framework |
| React | 19.0.0 | UI component library |
| TypeScript | 5.8.3 | Type-safe JavaScript |
| Hermes | Built-in | JavaScript engine (optimized) |

### Navigation & Routing
| Package | Version | Purpose |
|---------|---------|---------|
| expo-router | 5.1.5 | File-based routing |
| @react-navigation/native | 7.1.6 | Navigation framework |
| @react-navigation/stack | 7.4.7 | Stack navigation |
| @react-navigation/bottom-tabs | 7.3.10 | Tab navigation |

### Firebase Integration
| Package | Version | Purpose |
|---------|---------|---------|
| @react-native-firebase/app | 23.2.0 | Firebase core |
| @react-native-firebase/auth | 23.2.0 | Authentication |
| @react-native-firebase/firestore | 23.2.0 | Database |
| @react-native-firebase/storage | 23.2.0 | File storage |
| @react-native-firebase/functions | 23.5.0 | Cloud Functions client |
| @react-native-firebase/messaging | 23.2.0 | Push notifications |

### Authentication
| Package | Version | Purpose |
|---------|---------|---------|
| @react-native-google-signin/google-signin | 15.0.0 | Google Sign-In |
| @invertase/react-native-apple-authentication | 2.5.0 | Apple Sign-In |
| react-native-fbsdk-next | 13.4.1 | Facebook Login |

### Payments
| Package | Version | Purpose |
|---------|---------|---------|
| @stripe/stripe-react-native | 0.57.0 | Stripe payments SDK |

### UI Components
| Package | Version | Purpose |
|---------|---------|---------|
| @gorhom/bottom-sheet | 5.2.3 | Bottom sheet modals |
| @shopify/flash-list | 2.0.3 | Performant lists |
| react-native-reanimated | 3.17.4 | Animations |
| react-native-gesture-handler | 2.24.0 | Gesture handling |
| expo-blur | 14.1.5 | Blur effects |
| expo-image | 2.4.0 | Optimized images |
| @expo/vector-icons | 14.1.0 | Icon library |

### Maps & Location
| Package | Version | Purpose |
|---------|---------|---------|
| expo-location | 18.1.6 | GPS location |
| expo-maps | 0.11.0 | Map components |
| react-native-maps | 1.20.1 | Map views |
| react-native-google-places-autocomplete | 2.6.1 | Address search |
| geofire-common | 6.0.0 | Geohash queries |

### Media
| Package | Version | Purpose |
|---------|---------|---------|
| expo-camera | 16.1.11 | Camera access |
| expo-image-picker | 16.1.4 | Photo selection |
| expo-image-manipulator | 13.1.7 | Image processing |

### Data Fetching
| Package | Version | Purpose |
|---------|---------|---------|
| @tanstack/react-query | 5.90.5 | Data fetching & caching |

### Utilities
| Package | Version | Purpose |
|---------|---------|---------|
| @react-native-async-storage/async-storage | 2.2.0 | Local storage |
| use-debounce | 10.0.6 | Debouncing hooks |
| expo-haptics | 14.1.4 | Haptic feedback |
| expo-notifications | 0.31.4 | Local notifications |

## Backend (Cloud Functions)

### Runtime
| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 20 | Runtime environment |
| TypeScript | 5.x | Type-safe JavaScript |
| firebase-functions | Latest | Cloud Functions SDK |
| firebase-admin | Latest | Admin SDK |

### External Services
| Service | Package | Purpose |
|---------|---------|---------|
| Stripe | stripe | Payment processing |
| Shippo | shippo | Shipping labels & tracking |

### AI Services
| Service | Model | Purpose |
|---------|-------|---------|
| Google Gemini | `gemini-3-flash-preview` | Product image analysis (title, description, category, brand, size, condition) |

> **IMPORTANT**: Always use `gemini-3-flash-preview` for the AI product analysis. This is the Gemini 3 Flash model in preview. Do NOT use `gemini-2.0-flash` or older models.

## Firebase Services

| Service | Purpose |
|---------|---------|
| Authentication | User auth (email, Google, Apple, Facebook) |
| Cloud Firestore | NoSQL database |
| Cloud Storage | Image/file storage |
| Cloud Functions | Serverless backend |
| Cloud Messaging | Push notifications |
| Hosting | Web hosting (optional) |

## Development Tools

| Tool | Purpose |
|------|---------|
| ESLint | Code linting |
| Expo CLI | Development server |
| EAS Build | Cloud builds |
| Firebase CLI | Deployment |
| Firebase Emulators | Local development |

## Emulator Ports

| Service | Port |
|---------|------|
| Auth | 9099 |
| Functions | 5001 |
| Firestore | 8080 |
| Hosting | 5000 |
| Storage | 9199 |
| Emulator UI | 4000 |

## Build Configuration

### iOS
- Deployment Target: 15.1
- Framework Mode: Static
- Bundle ID: com.freepe

### Android
- Compile SDK: 35
- Target SDK: 34
- Build Tools: 35.0.0
- Kotlin: 1.9.0
- Package: com.freepe
