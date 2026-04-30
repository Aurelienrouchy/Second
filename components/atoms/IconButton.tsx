import React from 'react';
import { StyleSheet, Pressable, ViewStyle, GestureResponderEvent } from 'react-native';
import { colors } from '@/constants/theme';

type IconButtonVariant = 'back' | 'backLight' | 'save' | 'saveFilled' | 'share' | 'circle';

export interface IconButtonProps {
  variant: IconButtonVariant;
  onPress: (event: GestureResponderEvent) => void;
  size?: number;
  icon?: React.ReactNode;
  style?: ViewStyle;
}

export const IconButton: React.FC<IconButtonProps> = ({
  variant,
  onPress,
  size,
  icon,
  style,
}) => {
  const styles = getStyles(variant, size);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        style,
        {
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      {icon || styles.defaultIcon}
    </Pressable>
  );
};

function getStyles(variant: IconButtonVariant, customSize?: number) {
  let size: number;
  let backgroundColor: string;
  let borderColor: string;
  let borderWidth: number = 1;
  let defaultIcon: React.ReactNode = null;

  switch (variant) {
    case 'back':
      size = 36;
      backgroundColor = 'transparent';
      borderColor = colors.borderStrong;
      defaultIcon = <BackArrowIcon color={colors.charcoal} />;
      break;

    case 'backLight':
      size = 36;
      backgroundColor = 'transparent';
      borderColor = 'rgba(255, 255, 255, 0.2)';
      defaultIcon = <BackArrowIcon color={colors.white} />;
      break;

    case 'save':
      size = customSize || 28;
      backgroundColor = 'rgba(255, 255, 255, 0.1)';
      borderColor = 'transparent';
      borderWidth = 0;
      defaultIcon = <HeartIcon color={colors.sage} filled={false} />;
      break;

    case 'saveFilled':
      size = customSize || 30;
      backgroundColor = colors.rust;
      borderColor = 'transparent';
      borderWidth = 0;
      defaultIcon = <HeartIcon color={colors.white} filled={true} />;
      break;

    case 'share':
      size = 36;
      backgroundColor = 'rgba(255, 255, 255, 0.1)';
      borderColor = 'transparent';
      borderWidth = 0;
      defaultIcon = <ShareIcon color={colors.sage} />;
      break;

    case 'circle':
      size = customSize || 44;
      backgroundColor = colors.charcoal;
      borderColor = 'transparent';
      borderWidth = 0;
      break;

    default:
      size = 36;
      backgroundColor = 'transparent';
      borderColor = colors.borderStrong;
  }

  return StyleSheet.create({
    container: {
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor,
      borderWidth,
      borderColor,
      justifyContent: 'center',
      alignItems: 'center',
    },
    defaultIcon,
  });
}

// Icon Components
const BackArrowIcon: React.FC<{ color: string }> = ({ color }) => (
  // SVG representation as a placeholder
  // In a real implementation, use react-native-svg or a vector icon library
  <>{/* Render back arrow icon here */}</>
);

const HeartIcon: React.FC<{ color: string; filled: boolean }> = ({ color, filled }) => (
  <>{/* Render heart icon here */}</>
);

const ShareIcon: React.FC<{ color: string }> = ({ color }) => (
  <>{/* Render share icon here */}</>
);
