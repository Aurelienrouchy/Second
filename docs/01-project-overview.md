# Freepe - Project Overview

## Project Identity

| Field | Value |
|-------|-------|
| **Name** | Freepe (Seconde) |
| **Version** | 1.0.0 |
| **Bundle ID** | com.freepe |
| **Type** | Multi-part Repository (Mobile + Backend) |
| **Primary Language** | TypeScript |

## Description

Freepe is a second-hand marketplace mobile application similar to Vinted, allowing users to:
- Buy and sell second-hand items (clothing, accessories, home goods, etc.)
- Browse local thrift shops and vintage stores
- Chat with sellers and make offers
- Complete secure payments via Stripe
- Track shipments via Shippo integration

## Repository Structure

```
Seconde/
├── app/                    # Expo Router screens (file-based routing)
│   ├── (tabs)/            # Main tab navigation
│   ├── settings/          # Settings screens
│   ├── admin/             # Admin screens
│   └── [dynamic]/         # Dynamic routes (article, chat, shop, etc.)
├── components/            # Reusable React components
├── contexts/              # React Context providers
├── hooks/                 # Custom React hooks
├── services/              # Business logic & Firebase services
├── data/                  # Static data (brands, categories, colors, etc.)
├── types/                 # TypeScript type definitions
├── config/                # App configuration (Firebase, etc.)
├── utils/                 # Utility functions
├── assets/                # Images, fonts, icons
├── functions/             # Firebase Cloud Functions (backend)
│   └── src/index.ts       # All cloud functions
└── docs/                  # Project documentation
```

## Parts Classification

### Part 1: Mobile Application (Root)
- **Type**: Mobile (React Native/Expo)
- **Framework**: Expo SDK 53 with Expo Router
- **Runtime**: Hermes JavaScript engine
- **Platforms**: iOS 15.1+, Android SDK 34/35

### Part 2: Cloud Functions (/functions)
- **Type**: Serverless Backend
- **Runtime**: Node.js 20
- **Platform**: Firebase Cloud Functions
- **Integrations**: Stripe, Shippo, Firebase Admin

## Quick Start

```bash
# Install dependencies
npm install

# Start Expo development server
npm start

# Run on iOS
npm run ios

# Run on Android
npm run android

# Deploy Cloud Functions
cd functions && npm run build && firebase deploy --only functions
```

## Environment Variables

Required environment variables (`.env`):
- `FB_APP_ID` - Facebook App ID for social login
- `STRIPE_PUBLISHABLE_KEY` - Stripe public key (mobile)
- `STRIPE_SECRET_KEY` - Stripe secret key (functions)
- `SHIPPO_API_KEY` - Shippo API key for shipping

## Key Features

1. **Authentication**: Email, Google, Facebook, Apple Sign-In
2. **Product Listings**: Create, edit, search with advanced filters
3. **Real-time Chat**: Direct messaging with offer system
4. **Payments**: Stripe integration with 3D Secure
5. **Shipping**: Shippo label generation and tracking
6. **Push Notifications**: FCM for messages and offers
7. **Shop Discovery**: Geolocated thrift store finder
8. **Admin Panel**: Shop approval and moderation

## Documentation Index

1. [Project Overview](./01-project-overview.md) (this file)
2. [Technology Stack](./02-technology-stack.md)
3. [Architecture](./03-architecture.md)
4. [Data Models](./04-data-models.md)
5. [API Reference](./05-api-reference.md)
6. [Services Layer](./06-services-layer.md)
7. [Cloud Functions](./07-cloud-functions.md)
8. [Security Rules](./08-security-rules.md)
9. [Development Guide](./09-development-guide.md)
