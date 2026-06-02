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
    "splash": {
      "image": "./assets/images/icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#F5F0E8"
    },
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
"expo-apple-authentication",
      [
        "expo-notifications"
      ],
      [
        "expo-image-picker",
        {
          "photosPermission": "The app accesses your photos to let you share them."
        }
      ],
      [
        "expo-camera",
        {
          "cameraPermission": "Seconde utilise l'appareil photo pour prendre des photos de vos articles à vendre.",
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
        "applinks:seconde.app",
        "applinks:www.seconde.app"
      ],
      "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false,
        "CFBundleAllowMixedLocalizations": true,
        "UIBackgroundModes": ["fetch", "remote-notification"],
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
              "host": "seconde.app",
              "pathPrefix": "/article"
            },
            {
              "scheme": "https",
              "host": "seconde.app",
              "pathPrefix": "/chat"
            },
            {
              "scheme": "https",
              "host": "seconde.app",
              "pathPrefix": "/user"
            },
            {
              "scheme": "https",
              "host": "seconde.app",
              "pathPrefix": "/shop"
            },
            {
              "scheme": "https",
              "host": "seconde.app",
              "pathPrefix": "/swap-party"
            },
            {
              "scheme": "https",
              "host": "seconde.app",
              "pathPrefix": "/swap"
            },
            {
              "scheme": "https",
              "host": "seconde.app",
              "pathPrefix": "/notifications"
            },
            {
              "scheme": "https",
              "host": "seconde.app",
              "pathPrefix": "/search"
            }
          ],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ],
      "package": "com.seconde.app"
    },
    "web": {
      "favicon": "./assets/images/favicon.png"
    },
    "extra": {
      "eas": {
        "projectId": "5f72091d-3473-467c-a4fd-96fe18cda4d2"
      }
    },
    "experiments": {
      "typedRoutes": true
    }
  }
};