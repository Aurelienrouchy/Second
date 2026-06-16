export default {
  "expo": {
    "name": "Seconde",
    "slug": "seconde",
    "jsEngine": "hermes",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "seconde",
    "userInterfaceStyle": "automatic",
    "assetBundlePatterns": [
      "**/*"
    ],
    "plugins": [
      [
        "expo-font",
        {
          "fonts": [
            "./assets/fonts/CormorantGaramond-Regular.ttf",
            "./assets/fonts/CormorantGaramond-Medium.ttf",
            "./assets/fonts/CormorantGaramond-SemiBold.ttf",
            "./assets/fonts/CormorantGaramond-Bold.ttf",
            "./assets/fonts/Satoshi-Regular.otf",
            "./assets/fonts/Satoshi-Medium.otf",
            "./assets/fonts/Satoshi-Bold.otf"
          ]
        }
      ],
      "expo-router",
      "expo-dev-client",
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/icon.png",
          "resizeMode": "contain",
          "backgroundColor": "#F5F0E8"
        }
      ],
      "expo-apple-authentication",
      [
        "expo-notifications"
      ],
      [
        "expo-image-picker",
        {
          "photosPermission": "Seconde accède à vos photos pour ajouter des images à vos articles à vendre.",
          "cameraPermission": "Seconde utilise l'appareil photo pour prendre des photos de vos articles à vendre."
        }
      ],
      [
        "expo-camera",
        {
          "cameraPermission": "Seconde utilise l'appareil photo pour prendre des photos de vos articles à vendre.",
          "microphonePermission": "Seconde utilise le microphone pour enregistrer le son de vos vidéos d'articles.",
          "recordAudioAndroid": false
        }
      ],
      [
        "@react-native-google-signin/google-signin"
      ],
      [
        "@stripe/stripe-react-native",
        {
          "merchantIdentifier": "merchant.com.seconde.app",
          "enableGooglePay": true
        }
      ],
      "expo-image",
      [
        "react-native-maps",
        {
          "androidGoogleMapsApiKey": process.env.EXPO_PUBLIC_ANDROID_GOOGLE_MAPS_API_KEY,
          "iosGoogleMapsApiKey": process.env.EXPO_PUBLIC_IOS_GOOGLE_MAPS_API_KEY
        }
      ],
      "expo-sharing",
      [
        "expo-build-properties",
        {
          "ios": {
            "deploymentTarget": "16.4"
          },
          "android": {
            "compileSdkVersion": 36,
            "targetSdkVersion": 34,
            "buildToolsVersion": "36.0.0",
            "kotlinVersion": "2.1.20"
          }
        }
      ]
    ],
    "ios": {
      "buildNumber": "1",
      "googleServicesFile": "./GoogleService-Info.plist",
      "supportsTablet": true,
      "usesAppleSignIn": true,
      "associatedDomains": [
        "applinks:seconde.ca",
        "applinks:www.seconde.ca"
      ],
      "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false,
        "CFBundleAllowMixedLocalizations": true,
        "UIBackgroundModes": ["fetch", "remote-notification"],
        // FR purpose strings (Loi 25 / App Store review) — config-driven so
        // they survive `expo prebuild` instead of being hand-edited in Info.plist.
        "NSLocationWhenInUseUsageDescription": "Seconde utilise votre position pour afficher les articles et les points de rencontre à proximité.",
        "NSPhotoLibraryUsageDescription": "Seconde accède à vos photos pour ajouter des images à vos articles à vendre.",
        "NSCameraUsageDescription": "Seconde utilise l'appareil photo pour prendre des photos de vos articles à vendre.",
        // URL schemes for deep linking (app + Expo Dev Client + Google)
        "CFBundleURLTypes": [
          {
            "CFBundleURLSchemes": [
              "seconde",
              "exp+seconde",
              // Google Sign-In reversed client ID from GoogleService-Info.plist (project: seconde-b47a6)
              "com.googleusercontent.apps.628214013296-fspuqlslcg8tln3aonhce95c435oauts"
            ]
          }
        ]
      },
      "bundleIdentifier": "com.seconde.app"
    },
    "android": {
      "googleServicesFile": "./google-services.json",
      // Locks android:windowSoftInputMode="adjustResize" through `expo prebuild`.
      // The chat KeyboardAvoidingView uses offset 0 on Android and depends on it.
      "softwareKeyboardLayoutMode": "resize",
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/adaptive-icon.png",
        "backgroundColor": "#F5F0E8"
      },
      "permissions": [
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.VIBRATE"
      ],
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [
            {
              "scheme": "https",
              "host": "seconde.ca",
              "pathPrefix": "/article"
            },
            {
              "scheme": "https",
              "host": "seconde.ca",
              "pathPrefix": "/chat"
            },
            {
              "scheme": "https",
              "host": "seconde.ca",
              "pathPrefix": "/user"
            },
            {
              "scheme": "https",
              "host": "seconde.ca",
              "pathPrefix": "/shop"
            },
            {
              "scheme": "https",
              "host": "seconde.ca",
              "pathPrefix": "/swap-party"
            },
            {
              "scheme": "https",
              "host": "seconde.ca",
              "pathPrefix": "/swap"
            },
            {
              "scheme": "https",
              "host": "seconde.ca",
              "pathPrefix": "/notifications"
            },
            {
              "scheme": "https",
              "host": "seconde.ca",
              "pathPrefix": "/search"
            },
            {
              "scheme": "https",
              "host": "seconde.ca",
              "pathPrefix": "/favorites"
            },
            {
              "scheme": "https",
              "host": "seconde.ca",
              "pathPrefix": "/messages"
            },
            {
              "scheme": "https",
              "host": "seconde.ca",
              "pathPrefix": "/profile"
            },
            {
              "scheme": "https",
              "host": "seconde.ca",
              "pathPrefix": "/sell"
            },
            {
              "scheme": "https",
              "host": "seconde.ca",
              "pathPrefix": "/settings"
            },
            {
              "scheme": "https",
              "host": "seconde.ca",
              "pathPrefix": "/my-orders"
            },
            {
              "scheme": "https",
              "host": "www.seconde.ca",
              "pathPrefix": "/article"
            },
            {
              "scheme": "https",
              "host": "www.seconde.ca",
              "pathPrefix": "/chat"
            },
            {
              "scheme": "https",
              "host": "www.seconde.ca",
              "pathPrefix": "/user"
            },
            {
              "scheme": "https",
              "host": "www.seconde.ca",
              "pathPrefix": "/shop"
            },
            {
              "scheme": "https",
              "host": "www.seconde.ca",
              "pathPrefix": "/swap-party"
            },
            {
              "scheme": "https",
              "host": "www.seconde.ca",
              "pathPrefix": "/swap"
            },
            {
              "scheme": "https",
              "host": "www.seconde.ca",
              "pathPrefix": "/notifications"
            },
            {
              "scheme": "https",
              "host": "www.seconde.ca",
              "pathPrefix": "/search"
            },
            {
              "scheme": "https",
              "host": "www.seconde.ca",
              "pathPrefix": "/favorites"
            },
            {
              "scheme": "https",
              "host": "www.seconde.ca",
              "pathPrefix": "/messages"
            },
            {
              "scheme": "https",
              "host": "www.seconde.ca",
              "pathPrefix": "/profile"
            },
            {
              "scheme": "https",
              "host": "www.seconde.ca",
              "pathPrefix": "/sell"
            },
            {
              "scheme": "https",
              "host": "www.seconde.ca",
              "pathPrefix": "/settings"
            },
            {
              "scheme": "https",
              "host": "www.seconde.ca",
              "pathPrefix": "/my-orders"
            }
          ],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ],
      "package": "com.seconde.app"
    },
    // Decision mobile-only: no web target (no `expo export -p web`, no EAS web profile).
    // The legacy `web.favicon` block is removed. `react-native-web` stays in deps as a
    // potential transitive requirement (e.g. some RN libs reference it at resolve time).
    "extra": {
      "eas": {
        "projectId": "5f72091d-3473-467c-a4fd-96fe18cda4d2"
      }
    },
    "experiments": {
      "typedRoutes": true,
      // React Compiler activé via babel-preset-expo (SDK 56). Le preset applique
      // automatiquement babel-plugin-react-compiler — pas d'édition manuelle de
      // babel.config.js, donc react-native-worklets/plugin reste intact.
      // Auto-mémoïse les composants (lot de cartes de liste, rails home, etc.).
      "reactCompiler": true
    }
  }
};