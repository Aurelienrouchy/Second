/**
 * Custom Fonts Hook
 * Design System: Luxe Français + Street
 *
 * Fonts:
 * - Cormorant Garamond (Serif - Titles)
 * - Satoshi (Sans - Body/UI)
 *
 * Note: Download fonts from Google Fonts (Cormorant Garamond) and Fontshare (Satoshi)
 * Place them in assets/fonts/ folder
 */

import * as Font from 'expo-font';
import { useEffect, useState } from 'react';

// =============================================================================
// FONT LOADING HOOK
// =============================================================================

export const useFonts = () => {
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [fontError, setFontError] = useState<Error | null>(null);

  useEffect(() => {
    const loadFonts = async () => {
      try {
        await Font.loadAsync({
          // Cormorant Garamond (Serif)
          'Cormorant-Garamond': require('@/assets/fonts/CormorantGaramond-Regular.ttf'),
          'Cormorant-Garamond-Medium': require('@/assets/fonts/CormorantGaramond-Medium.ttf'),
          'Cormorant-Garamond-SemiBold': require('@/assets/fonts/CormorantGaramond-SemiBold.ttf'),
          'Cormorant-Garamond-Bold': require('@/assets/fonts/CormorantGaramond-Bold.ttf'),

          // Satoshi (Sans-serif)
          'Satoshi-Regular': require('@/assets/fonts/Satoshi-Regular.otf'),
          'Satoshi-Medium': require('@/assets/fonts/Satoshi-Medium.otf'),
          'Satoshi-Bold': require('@/assets/fonts/Satoshi-Bold.otf'),
        });
        setFontsLoaded(true);
      } catch (error) {
        console.error('Error loading fonts:', error);
        setFontError(error as Error);
        // Fallback to system fonts
        setFontsLoaded(true);
      }
    };

    loadFonts();
  }, []);

  return { fontsLoaded, fontError };
};

// =============================================================================
// FONT FAMILY HELPERS
// =============================================================================

/**
 * Get font family with fallback
 * Use this if fonts might not be loaded yet
 */
export const getFontFamily = (
  fontName: string,
  fallback: string = 'System'
): string => {
  // In production, you'd check if the font is actually loaded
  // For now, we return the font name and rely on the system fallback
  return fontName;
};

// =============================================================================
// FONT DOWNLOAD INSTRUCTIONS
// =============================================================================

/**
 * Font Setup Instructions:
 *
 * 1. Create folder: assets/fonts/
 *
 * 2. Download Cormorant Garamond from Google Fonts:
 *    https://fonts.google.com/specimen/Cormorant+Garamond
 *    - CormorantGaramond-Regular.ttf
 *    - CormorantGaramond-Medium.ttf
 *    - CormorantGaramond-SemiBold.ttf
 *    - CormorantGaramond-Bold.ttf
 *
 * 3. Download Satoshi from Fontshare:
 *    https://www.fontshare.com/fonts/satoshi
 *    - Satoshi-Regular.otf
 *    - Satoshi-Medium.otf
 *    - Satoshi-Bold.otf
 *
 * 4. Place all font files in assets/fonts/
 *
 * 5. Use useFonts() hook in _layout.tsx to load fonts before rendering
 */

export default useFonts;
