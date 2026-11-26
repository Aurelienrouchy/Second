import {StyleSheet, View} from 'react-native';
import {Text} from '@/components/ui';
import type {Swap} from '@/types';
import {colors, spacing, typography} from '@/constants/theme';
import {SwapProofImage} from './SwapProofImage';
export function SwapProofPhotos({swap, uid}: {swap: Swap; uid: string}) {
  if (uid !== swap.initiatorId && uid !== swap.receiverId) return null;
  return <View style={styles.content}>{(['initiator', 'receiver'] as const).map(side => {
    const participantUid = side === 'initiator' ? swap.initiatorId : swap.receiverId;
    const proof = side === 'initiator' ? swap.initiatorPhotos : swap.receiverPhotos;
    if (!proof || proof.userId !== participantUid || !Array.isArray(proof.photos)) return null;
    return <View key={side} style={styles.content}><Text style={styles.title}>{participantUid === uid ? 'Vos photos' : 'Photos du membre'}</Text>
      {proof.photos.slice(0, 4).map((reference, index) => <SwapProofImage key={`${reference}:${index}`} swapId={swap.id} participantUid={participantUid} reference={reference} label={`Photo ${index + 1} des articles avant l’envoi`}/>)}</View>;
  })}</View>;
}
const styles = StyleSheet.create({content: {gap: spacing.md}, title: {...typography.h3, color: colors.foreground}});
