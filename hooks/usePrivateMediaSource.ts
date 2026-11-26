import { useEffect, useState } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { getBytes, ref } from 'firebase/storage';
import type { ImageSource } from 'expo-image';

import { auth, storage } from '@/config/firebaseConfig';
import { PRIVATE_MEDIA_MAX_BYTES, privateImageDataUri, privateMediaPath } from '@/utils/privateMedia';
import { ChatMessageImageService, type ChatMessageImageReference } from '@/services/chatMessageImageService';
import type { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';

/** Chat images require the real message context and its current screen lifetime. */
export interface PrivateChatMediaContext extends ChatMessageImageReference {
  viewerId: string | null;
  sourceKey: string;
  lifecycle: ReturnType<typeof useLabelLifecycleContext>;
}

interface PrivateSource {
  owner: string;
  input: string;
  source: ImageSource;
  kind: 'sdk' | 'chat';
  chatKey?: string;
  frame?: symbol;
  focusRevision?: string;
}

/** Chat uses its native reader; other private media keeps authenticated SDK transport. */
export function usePrivateMediaSource(uri: string | undefined, chat?: PrivateChatMediaContext): ImageSource | undefined {
  const [loaded, setLoaded] = useState<PrivateSource | null>(null);
  const bucket = storage.app?.options.storageBucket;
  const path = privateMediaPath(uri, bucket);
  const chatMode = !!chat || path?.startsWith('chat_images/') === true;
  const chatKey = chat ? JSON.stringify([chat.viewerId, chat.chatId, chat.messageId, chat.fileKind, chat.sourceKey, uri]) : null;
  const frame = chat?.lifecycle.frame, focusRevision = chat?.lifecycle.focusRevision, focused = chat?.lifecycle.focused;

  useEffect(() => {
    let generation = 0;
    let active = true;
    const unsubscribe = onIdTokenChanged(auth, (user) => {
      const request = ++generation;
      setLoaded(null);
      if (!user || !path || !uri) return;
      if (chatMode) {
        // No direct SDK fallback, including a missing context or unavailable server.
        if (!chat || !chatKey || chat.viewerId !== user.uid || !chat.lifecycle.focused) return;
        let operation: ReturnType<typeof chat.lifecycle.capture>;
        try {operation = chat.lifecycle.capture();} catch {return;}
        const current = () => {
          if (!active || request !== generation || auth.currentUser?.uid !== user.uid) throw new Error('Le contexte de cette image a changé.');
          chat.lifecycle.assertCurrent(operation);
        };
        void ChatMessageImageService.read(user.uid, {chatId: chat.chatId, messageId: chat.messageId, fileKind: chat.fileKind}, uri, current)
          .then(value => {current(); setLoaded({owner: user.uid, input: uri, kind: 'chat', chatKey, frame: chat.lifecycle.frame,
            focusRevision: chat.lifecycle.focusRevision, source: {uri: value.dataUrl}});})
          .catch(() => { /* A denied/revoked chat reference never becomes a public or SDK URL. */ });
        return;
      }
      // getBytes uses current SDK Auth + AppCheck and emulator configuration.
      // The SDK cap bounds returned image bytes (oversize objects may be truncated).
      void getBytes(ref(storage, path), PRIVATE_MEDIA_MAX_BYTES)
        .then((bytes) => {
          if (!active || request !== generation || auth.currentUser?.uid !== user.uid) return;
          setLoaded({ owner: user.uid, input: uri, kind: 'sdk', source: { uri: privateImageDataUri(bytes, path) } });
        })
        .catch(() => {
          // Denied/deleted/revoked media stays empty; no public URL fallback.
        });
    });
    return () => { active = false; generation++; unsubscribe(); };
  // The captured lifecycle methods belong to these concrete frame/focus keys;
  // a new wrapper object alone must not restart and republish in-memory bytes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, uri, chatMode, chatKey, frame, focusRevision, focused]);

  if (!loaded || loaded.owner !== auth.currentUser?.uid || loaded.input !== uri) return undefined;
  if (chatMode) return chat && focused && loaded.kind === 'chat' && loaded.chatKey === chatKey && loaded.frame === frame && loaded.focusRevision === focusRevision && chat.viewerId === auth.currentUser?.uid
    ? loaded.source : undefined;
  return loaded.kind === 'sdk' ? loaded.source : undefined;
}
