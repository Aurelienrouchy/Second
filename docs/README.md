# Freepe Documentation

## Overview

Freepe is a second-hand marketplace mobile application similar to Vinted. This documentation covers the complete technical architecture, APIs, and development guides.

---

## Quick Links

| Document | Description |
|----------|-------------|
| [Project Overview](./01-project-overview.md) | Project identity, structure, quick start |
| [Technology Stack](./02-technology-stack.md) | Dependencies and versions |
| [Architecture](./03-architecture.md) | System design and data flow |
| [Data Models](./04-data-models.md) | Firestore collections and TypeScript types |
| [API Reference](./05-api-reference.md) | Cloud Functions API documentation |
| [Services Layer](./06-services-layer.md) | Business logic service classes |
| [Cloud Functions](./07-cloud-functions.md) | Backend function details |
| [Security Rules](./08-security-rules.md) | Firestore security rules |
| [Development Guide](./09-development-guide.md) | Setup and development workflow |
| [Source Tree](./10-source-tree.md) | Complete file structure |

---

## Project Summary

| Attribute | Value |
|-----------|-------|
| **Name** | Freepe (Seconde) |
| **Type** | Mobile App + Serverless Backend |
| **Framework** | Expo SDK 53 / React Native 0.79 |
| **Backend** | Firebase (Firestore, Auth, Functions, Storage) |
| **Language** | TypeScript |
| **Payments** | Stripe |
| **Shipping** | Shippo |

---

## Key Features

- User authentication (Email, Google, Apple, Facebook)
- Product listings with advanced search and filters
- Real-time chat with offer system
- Secure payments via Stripe
- Shipping label generation via Shippo
- Push notifications
- Geolocated shop discovery
- Admin moderation panel

---

## Getting Started

```bash
# Clone and install
git clone <repo-url>
cd Seconde
npm install

# Start development
npm start

# Run on iOS
npm run ios

# Run on Android
npm run android
```

See [Development Guide](./09-development-guide.md) for complete setup instructions.

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────┐
│              FREEPE MOBILE APP                      │
│         (Expo / React Native)                       │
├─────────────────────────────────────────────────────┤
│  Screens (app/)    │  Components    │  Services     │
│  • 36 screens      │  • 40+ UI      │  • 11 service │
│  • Tab navigation  │  • Reusable    │  • Firebase   │
│  • Settings stack  │  • Themed      │  • Business   │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│              FIREBASE BACKEND                        │
├─────────────────────────────────────────────────────┤
│  Auth    │ Firestore │ Storage │ Functions │ FCM   │
│  Users   │ Database  │ Images  │ Backend   │ Push  │
└─────────────────────────────────────────────────────┘
                        │
           ┌────────────┴────────────┐
           ▼                         ▼
      ┌─────────┐               ┌─────────┐
      │ Stripe  │               │ Shippo  │
      │Payments │               │Shipping │
      └─────────┘               └─────────┘
```

---

## Document Index

### 1. Project Overview
- Project identity and description
- Repository structure
- Quick start commands
- Environment variables
- Key features list

### 2. Technology Stack
- Mobile app dependencies
- Backend runtime
- Firebase services
- External integrations
- Build configuration

### 3. Architecture
- High-level system architecture
- Mobile app layer structure
- Navigation structure
- Cloud Functions architecture
- Data flow patterns
- State management

### 4. Data Models
- Firestore collection overview
- Core TypeScript interfaces
- User, Article, Chat, Transaction models
- Shop and Notification models
- Search filters and indexing

### 5. API Reference
- Callable function signatures
- HTTP endpoints
- Triggered functions
- Request/response formats
- Error codes

### 6. Services Layer
- Service architecture
- ArticlesService methods
- ChatService methods
- TransactionService methods
- Usage patterns and examples

### 7. Cloud Functions
- Function architecture diagram
- External service integrations
- Utility functions (geohash, search)
- Payment and shipping flows
- Scheduled jobs

### 8. Security Rules
- Rule structure
- Helper functions
- Per-collection rules
- Testing and deployment
- Best practices

### 9. Development Guide
- Prerequisites
- Initial setup
- Running the app
- Firebase emulators
- Common development tasks
- Building for production
- Debugging and testing

### 10. Source Tree
- Complete file structure
- File statistics
- Key entry points
- Navigation flow

---

## Contributing

When adding new features:
1. Update relevant documentation
2. Add TypeScript types to `types/index.ts`
3. Create service methods in `services/`
4. Add security rules if new collection
5. Deploy Cloud Functions if needed

---

## Last Updated

Documentation generated: January 2026
