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
      "backgroundColor": "#151718"
    },
    "assetBundlePatterns": [
      "**/*"
    ],
    "plugins": [
      "expo-router",
      "expo-dev-client",
      "@react-native-firebase/app",
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
        "@react-native-google-signin/google-signin"
      ],
      [
        "expo-build-properties",
        {
          "ios": {
            "useFrameworks": "static",
            "deploymentTarget": "15.1"
          },
          "android": {
            "compileSdkVersion": 35,
            "targetSdkVersion": 34,
            "buildToolsVersion": "35.0.0",
            "kotlinVersion": "1.9.0"
          }
        }
      ]
    ],
    "ios": {
      "buildNumber": "1",
      "googleServicesFile": "./GoogleService-Info.plist",
      "supportsTablet": true,
      "usesAppleSignIn": true,
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
        "backgroundColor": "#ffffff"
      },
      "permissions": [
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.RECORD_AUDIO",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.VIBRATE"
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