import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui';
import { colors, components, spacing, typography } from '@/constants/theme';
import { useSwapProposalImage } from '../../hooks/useSwapProposalImage';
import { usePrivateArticleImage } from '@/hooks/usePrivateArticleImage';

interface Props { articleId: string; originalReference: string; swapId?: string; acceptedAgreement: boolean; withdrawalRecorded: boolean; publicSellerId?: string }
/** Uses the same permission/byte source as the existing native swap cards. */
export function SwapAgreementImage({articleId, originalReference, swapId, acceptedAgreement, withdrawalRecorded, publicSellerId}: Props) {
  const proof = usePrivateArticleImage(swapId && acceptedAgreement ? {articleId, swapId} : null, originalReference, withdrawalRecorded);
  const proposalImage = useSwapProposalImage(articleId, originalReference, publicSellerId, !!swapId && !acceptedAgreement && !withdrawalRecorded);
  const source = swapId ? acceptedAgreement ? proof.image : proposalImage : withdrawalRecorded ? null : originalReference;
  return <View style={styles.container}>
    {source ? <Image source={{uri: source}} style={styles.image} contentFit="contain" cachePolicy={swapId || source.startsWith('data:') ? 'none' : 'memory-disk'} />
      : <Text style={styles.caption}>{swapId && !acceptedAgreement ? 'Photo indisponible pour cette proposition.' : proof.checking ? 'Chargement de la photo…' : 'Photo indisponible.'}</Text>}
  </View>;
}
const styles = StyleSheet.create({container: {gap: spacing.xs}, image: {width: '100%', aspectRatio: components.troc.comparisonMultiPhotoRatio, backgroundColor: colors.surfaceWarm},
  caption: {...typography.caption, color: colors.foregroundSecondary} });
