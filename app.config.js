const fs = require('node:fs');
const firebaseProjects = require('./config/firebaseProjects.json');
const developmentOAuth = require('./config/firebase/development/oauth.json');

const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV || 'development';
if (!['development', 'production'].includes(appEnvironment)) {
  throw new Error('EXPO_PUBLIC_APP_ENV doit valoir development ou production.');
}
// Expo evaluates config in development mode during the native prebuild step.
const isStoreBuild = process.env.EAS_BUILD === 'true' && process.env.EAS_BUILD_PROFILE === 'production';
if (process.env.NODE_ENV === 'development' && appEnvironment === 'production' && !isStoreBuild) {
  throw new Error('Le lancement local utilise exclusivement Seconde Dev.');
}
const isProduction = appEnvironment === 'production';
const appScheme = isProduction ? 'seconde' : 'seconde-dev';
const bundleIdentifier = isProduction ? 'com.seconde.app' : 'com.seconde.app.dev';
const devIosGoogleFile = './config/firebase/development/GoogleService-Info.plist';
const devAndroidGoogleFile = './config/firebase/development/google-services.json';
const iosGoogleClientId = isProduction
  ? '628214013296-fspuqlslcg8tln3aonhce95c435oauts.apps.googleusercontent.com'
  : process.env.EXPO_PUBLIC_DEV_GOOGLE_IOS_CLIENT_ID || developmentOAuth.googleIosClientId;
if (!isProduction && iosGoogleClientId && !iosGoogleClientId.startsWith(`${firebaseProjects.development.messagingSenderId}-`)) {
  throw new Error('Le client Google iOS Dev doit appartenir au projet Firebase Seconde Dev.');
}
const googleUrlScheme = iosGoogleClientId
  ? `com.googleusercontent.apps.${iosGoogleClientId.replace('.apps.googleusercontent.com', '')}`
  : undefined;

export default {
  "expo": {
    "name": isProduction ? "Seconde" : "Seconde Dev",
    "slug": "seconde",
    "jsEngine": "hermes",
    "version": isProduction ? "1.0.2" : "1.0.1",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": appScheme,
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
      ["expo-dev-client", { "addGeneratedScheme": isProduction }],
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
      ...(googleUrlScheme ? [[
        "@react-native-google-signin/google-signin",
        { iosUrlScheme: googleUrlScheme }
      ]] : []),
      [
        "@stripe/stripe-react-native",
        {
          "enableGooglePay": true
        }
      ],
      "expo-image",
      "expo-localization",
      ["expo-secure-store", { "configureAndroidBackup": true, "faceIDPermission": false }],
      [
        "react-native-maps",
        {
          "androidGoogleMapsApiKey": isProduction ? process.env.EXPO_PUBLIC_ANDROID_GOOGLE_MAPS_API_KEY : process.env.EXPO_PUBLIC_DEV_ANDROID_GOOGLE_MAPS_API_KEY,
          "iosGoogleMapsApiKey": isProduction ? process.env.EXPO_PUBLIC_IOS_GOOGLE_MAPS_API_KEY : process.env.EXPO_PUBLIC_DEV_IOS_GOOGLE_MAPS_API_KEY
        }
      ],
      "expo-sharing",
      [
        "expo-build-properties",
        {
          "ios": {
            "deploymentTarget": "16.4",
            "extraPods": [
              { "name": "GoogleUtilities", "modular_headers": true },
              { "name": "RecaptchaInterop", "modular_headers": true }
            ]
          },
          "android": {
            "compileSdkVersion": 36,
            "targetSdkVersion": 36,
            "buildToolsVersion": "36.0.0",
            "kotlinVersion": "2.1.20",
            "enableMinifyInReleaseBuilds": true,
            "enableShrinkResourcesInReleaseBuilds": true,
            // Backport Stripe's R8 rule for the optional Issuing feature.
            "extraProguardRules": "-dontwarn com.stripe.android.pushProvisioning.**"
          }
        }
      ]
    ],
    "ios": {
      ...(!isProduction ? { appleTeamId: "B6D5JY9LKV" } : {}),
      "buildNumber": "1",
      "googleServicesFile": isProduction ? "./GoogleService-Info.plist" : fs.existsSync(devIosGoogleFile) ? devIosGoogleFile : undefined,
      "supportsTablet": false,
      "usesAppleSignIn": true,
      "associatedDomains": isProduction ? [
        "applinks:seconde.ca",
        "applinks:www.seconde.ca"
      ] : [],
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
              appScheme,
              ...(isProduction ? ["exp+seconde"] : []),
              ...(googleUrlScheme ? [googleUrlScheme] : [])
            ]
          }
        ]
      },
      "bundleIdentifier": bundleIdentifier
    },
    "android": {
      "googleServicesFile": isProduction ? "./google-services.json" : fs.existsSync(devAndroidGoogleFile) ? devAndroidGoogleFile : undefined,
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
      "intentFilters": isProduction ? [
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
      ] : [],
      "package": bundleIdentifier
    },
    // The marketplace is mobile-only. Hosting serves public/index.html as a
    // static native-app deep-link landing, without a React root. index.web.ts
    // preserves that scope if a local web export is requested; it never mounts
    // the marketplace. react-native-web remains a transitive dependency.
    "extra": {
      "appEnvironment": appEnvironment,
      "firebaseProjectId": firebaseProjects[appEnvironment].projectId,
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
