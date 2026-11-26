import {useQuery} from '@tanstack/react-query';
import {getBytes, ref} from 'firebase/storage';
import {StyleSheet, View} from 'react-native';
import {Image} from 'expo-image';
import {Button, Text} from '@/components/ui';
import {storage} from '@/config/firebaseConfig';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {readScopedQuery} from '@/utils/readScopedQuery';
import {PRIVATE_MEDIA_MAX_BYTES, privateImageDataUri, privateMediaPath} from '@/utils/privateMedia';
import {colors, components, spacing, typography} from '@/constants/theme';
/** Photo bytes stay behind Firebase Auth and this exact exchange/screen scope. */
export function SwapProofImage({swapId, participantUid, reference, label}: {swapId: string; participantUid: string; reference: string; label: string}) {
  const uid = useAuthenticatedUid();
  const context = useLabelLifecycleContext(JSON.stringify(['swap-proof-photo', swapId, participantUid, reference]), uid);
  const path = privateMediaPath(reference, storage.app.options.storageBucket);
  const valid = !!path && (path.startsWith(`swaps/${swapId}/photos/${participantUid}/`) || path.startsWith(`swaps/${swapId}/photos/`) && path.split('/').length === 4);
  const photo = useQuery({queryKey: ['swap-proof-photo', uid, getAuthSessionGeneration(), context.focusRevision, swapId, participantUid, reference], enabled: !!uid && valid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readScopedQuery(signal, () => {const op = context.capture(); return () => context.assertCurrent(op);}, async assertCurrent => {
      const bytes = await getBytes(ref(storage, path!), PRIVATE_MEDIA_MAX_BYTES); assertCurrent();
      if (!bytes.byteLength || bytes.byteLength >= PRIVATE_MEDIA_MAX_BYTES) throw new Error('Photo indisponible');
      return privateImageDataUri(bytes, path!);
    }),
  });
  const source = context.focused && photo.isSuccess && !photo.isFetching && !photo.isError ? photo.data : null;
  return <View style={styles.container}>{source ? <Image source={{uri: source}} style={styles.image} contentFit="contain" cachePolicy="none" accessibilityLabel={label}/>
    : <Text style={styles.caption}>{photo.isFetching ? 'Chargement de la photo…' : 'Cette photo n’est pas disponible.'}</Text>}
    {photo.isError ? <Button variant="ghost" onPress={() => {void photo.refetch();}}>Réessayer</Button> : null}</View>;
}
const styles = StyleSheet.create({container: {gap: spacing.sm}, image: {width: '100%', aspectRatio: components.troc.comparisonMultiPhotoRatio, backgroundColor: colors.surfaceWarm}, caption: {...typography.caption, color: colors.foregroundSecondary}});
