import React from 'react';
import {
  StyleSheet,
  View,
  Pressable,
  Text,
  ViewStyle,
  GestureResponderEvent,
} from 'react-native';
import {
  colors,
  typography,
  spacing,
  radius,
  shadows,
  sizing,
} from '@/constants/theme';

export enum TabType {
  Home = 'home',
  Explorer = 'explorer',
  Vendre = 'vendre',
  Favoris = 'favoris',
  Profil = 'profil',
}

export interface BottomTabBarProps {
  activeTab: TabType;
  onTabPress: (tab: TabType, event: GestureResponderEvent) => void;
  variant: 'light' | 'dark';
  style?: ViewStyle;
}

const TAB_CONFIG = {
  [TabType.Home]: { label: 'Home', icon: 'House' },
  [TabType.Explorer]: { label: 'Explorer', icon: 'Search' },
  [TabType.Vendre]: { label: 'Vendre', icon: 'Plus' },
  [TabType.Favoris]: { label: 'Favoris', icon: 'Heart' },
  [TabType.Profil]: { label: 'Profil', icon: 'User' },
};

export const BottomTabBar: React.FC<BottomTabBarProps> = ({
  activeTab,
  onTabPress,
  variant,
  style,
}) => {
  const isDark = variant === 'dark';
  const styles = getStyles(isDark);

  const renderTabIcon = (iconName: string, isActive: boolean) => {
    const iconColor = isActive ? colors.rust : colors.muted;
    const iconSize = sizing.iconMD;

    // SVG/Icon placeholder - user will replace with actual icon library
    // e.g., <Feather name={iconName} size={iconSize} color={iconColor} />
    return (
      <View
        style={{
          width: iconSize,
          height: iconSize,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Text
          style={{
            fontSize: iconSize,
            color: iconColor,
          }}
        >
          {/* Icon: {iconName} */}
          {getIconSymbol(iconName)}
        </Text>
      </View>
    );
  };

  const renderTab = (tab: TabType, index: number) => {
    const isActive = activeTab === tab;
    const config = TAB_CONFIG[tab];
    const isCenterTab = tab === TabType.Vendre;

    if (isCenterTab) {
      return (
        <Pressable
          key={tab}
          onPress={(e) => onTabPress(tab, e)}
          style={({ pressed }) => [
            styles.centerTabContainer,
            {
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <View style={styles.vendreButton}>
            {renderTabIcon(config.icon, true)}
          </View>
        </Pressable>
      );
    }

    return (
      <Pressable
        key={tab}
        onPress={(e) => onTabPress(tab, e)}
        style={({ pressed }) => [
          styles.tabContainer,
          {
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <View style={styles.tabContent}>
          {renderTabIcon(config.icon, isActive)}
          <Text
            style={[
              styles.tabLabel,
              {
                color: isActive ? colors.rust : colors.muted,
              },
            ]}
          >
            {config.label}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, style]}>
      <View style={styles.tabsWrapper}>
        {Object.values(TabType).map((tab, index) => renderTab(tab, index))}
      </View>
    </View>
  );
};

function getStyles(isDark: boolean) {
  const bgColor = isDark ? 'rgba(26, 24, 20, 0.95)' : 'rgba(245, 240, 232, 0.95)';
  const borderColor = isDark
    ? 'rgba(255,255,255,0.08)'
    : colors.border;

  return StyleSheet.create({
    container: {
      backgroundColor: bgColor,
      borderTopWidth: 1,
      borderTopColor: borderColor,
      paddingBottom: 0,
    },
    tabsWrapper: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      paddingHorizontal: spacing['3xl'],
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
      height: 80,
      position: 'relative',
    },
    tabContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingVertical: spacing.sm,
    },
    centerTabContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingVertical: spacing.sm,
      marginTop: -14,
      zIndex: 10,
    },
    tabContent: {
      alignItems: 'center',
      gap: spacing.xs,
    },
    tabLabel: {
      fontSize: 10,
      fontWeight: '400',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    vendreButton: {
      width: 44,
      height: 44,
      borderRadius: radius.lg,
      backgroundColor: colors.charcoal,
      justifyContent: 'center',
      alignItems: 'center',
      ...shadows.button,
    },
  });
}

function getIconSymbol(iconName: string): string {
  const symbolMap: { [key: string]: string } = {
    House: '🏠',
    Search: '🔍',
    Plus: '➕',
    Heart: '❤️',
    User: '👤',
  };
  return symbolMap[iconName] || '◻';
}
