import React from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useRouter} from 'expo-router';
import {colors, components, spacing} from '@/constants/theme';
import {PAYMENTS_ENABLED, SHIPPING_ENABLED} from '@/config/featureFlags';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {shippingOrderProgress} from '@/utils/shippingOrderProgress';
import type {Transaction} from '@/types';

export function ConversationOrderProgress({order, uid, chatId}: {order: Transaction; uid: string; chatId: string}) {
  const router = useRouter();
  const context = useLabelLifecycleContext(JSON.stringify(['chat-order-step', chatId, order.id, order.status, order.refund,
    order.bankDispute, order.disputed, order.refundBlocked, order.deliveryCorrection, order.shipEngineLabelId]), uid);
  const progress = order.chatId === chatId ? shippingOrderProgress(order, uid) : null;
  if (!progress) return null;
  const payment = progress.destination === 'payment' && PAYMENTS_ENABLED && SHIPPING_ENABLED;
  const action = payment ? progress.action : progress.destination === 'payment' ? 'Voir la commande' : progress.action;
  return <Pressable accessibilityRole="button" accessibilityLabel={action} style={styles.action} onPress={() => {
      try {if (!context.start()) return;} catch {return;}
      if (payment) router.push({pathname: '/payment/[transactionId]', params: {transactionId: order.id}});
      else if (progress.destination === 'tracking') router.push({pathname: '/orders/tracking/[id]', params: {id: order.id}} as never);
      else router.push({pathname: '/orders/[id]', params: {id: order.id}});
    }}>
      <Text style={styles.label}>{action}</Text>
      <Ionicons name="arrow-forward" size={spacing.md} color={colors.foreground}/>
    </Pressable>;
}
const styles = StyleSheet.create({
  action: {...components.button.container, ...components.button.primary, alignSelf: 'center',
    marginTop: spacing.xs, marginBottom: spacing.md},
  label: {...components.button.label, ...components.button.primaryLabel},
});
