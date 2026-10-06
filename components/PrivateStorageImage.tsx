import React from 'react';
import { Image, type ImageProps } from 'expo-image';
import { useFirebaseUserId } from '@/hooks/useFirebaseUserId';
import { usePrivateMediaSource } from '@/hooks/usePrivateMediaSource';

type PrivateStorageImageProps = Omit<ImageProps, 'source' | 'cachePolicy' | 'placeholder'> & {
  uri: string | undefined;
  /** Creation previews may be local files; remote URLs never bypass auth. */
  allowLocalSource?: boolean;
  /** Captured owner of local bytes, never derived anew after an account switch. */
  localSourceOwnerUid?: string;
};

/** Authenticated private image. Bytes live in memory and are cleared on logout. */
export const PrivateStorageImage = React.memo(function PrivateStorageImage({
  uri, allowLocalSource = false, localSourceOwnerUid, ...props
}: PrivateStorageImageProps) {
  const privateSource = usePrivateMediaSource(uri);
  const currentUid = useFirebaseUserId();
  const localSource = allowLocalSource && localSourceOwnerUid && localSourceOwnerUid === currentUid && uri && /^(file:\/\/|content:\/\/|ph:\/\/|assets-library:\/\/|blob:|data:image\/)/.test(uri)
    ? { uri } : undefined;
  const source = localSource ?? privateSource;
  // Remount an empty native view when authorization disappears, so a previous
  // bitmap cannot remain visible while the next read is denied or pending.
  return <Image key={source ? 'ready' : 'cleared'} {...props} source={source} cachePolicy="none" />;
});
