import type BottomSheet from '@gorhom/bottom-sheet';
import { useEffect } from 'react';
import { BackHandler } from 'react-native';

/**
 * Hook to handle Android back button for BottomSheet
 * Closes the bottom sheet when back button is pressed
 */
export const useBottomSheetBackHandler = (
  bottomSheetRef: React.RefObject<BottomSheet>,
  isVisible: boolean
) => {
  useEffect(() => {
    const handleBackPress = () => {
      if (isVisible && bottomSheetRef.current) {
        bottomSheetRef.current.close();
        return true; // Prevent default back action
      }
      return false; // Allow default back action
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBackPress);

    return () => subscription.remove();
  }, [bottomSheetRef, isVisible]);
};



