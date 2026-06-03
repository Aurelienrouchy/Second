import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  StyleSheet,
  View,
} from 'react-native';

import { colors } from '@/constants/theme';

const SwapSeparator: React.FC = () => {
  return (
    <View style={styles.container}>
      {/* Left line */}
      <View style={styles.line} />

      {/* Center icon - charcoal circle with swap icon */}
      <View style={styles.iconContainer}>
        <Ionicons
          name="swap-horizontal"
          size={18}
          color={colors.surface}
        />
      </View>

      {/* Right line */}
      <View style={styles.line} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 10,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.charcoal,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default SwapSeparator;
