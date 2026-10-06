import { useEffect, useState } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { getBytes, ref } from 'firebase/storage';
import type { ImageSource } from 'expo-image';

import { auth, storage } from '@/config/firebaseConfig';
import { PRIVATE_MEDIA_MAX_BYTES, privateImageDataUri, privateMediaPath } from '@/utils/privateMedia';

interface PrivateSource {
  owner: string;
  input: string;
  source: ImageSource;
}

/** Read through the SDK's authenticated transport; never through bearer URLs. */
export function usePrivateMediaSource(uri: string | undefined): ImageSource | undefined {
  const [loaded, setLoaded] = useState<PrivateSource | null>(null);
  const bucket = storage.app?.options.storageBucket;
  const path = privateMediaPath(uri, bucket);

  useEffect(() => {
    let generation = 0;
    let active = true;
    const unsubscribe = onIdTokenChanged(auth, (user) => {
      const request = ++generation;
      setLoaded(null);
      if (!user || !path || !uri) return;
      // getBytes uses current SDK Auth + AppCheck and emulator configuration.
      // The SDK cap bounds returned image bytes (oversize objects may be truncated).
      void getBytes(ref(storage, path), PRIVATE_MEDIA_MAX_BYTES)
        .then((bytes) => {
          if (!active || request !== generation || auth.currentUser?.uid !== user.uid) return;
          setLoaded({ owner: user.uid, input: uri, source: { uri: privateImageDataUri(bytes, path) } });
        })
        .catch(() => {
          // Denied/deleted/revoked media stays empty; no public URL fallback.
        });
    });
    return () => { active = false; generation++; unsubscribe(); };
  }, [path, uri]);

  return loaded && loaded.owner === auth.currentUser?.uid && loaded.input === uri
    ? loaded.source : undefined;
}
