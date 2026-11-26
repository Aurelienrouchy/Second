import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PrivateStorageImage } from '@/components/PrivateStorageImage';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useFirebaseUserId } from '@/hooks/useFirebaseUserId';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { Message } from '@/types';
import { APP_LOCALE } from '@/constants/locale';
import { colors, fonts, radius, spacing } from '@/constants/theme';

/**
 * Un message optimiste dont l'écriture a échoué porte `failed: true` (posé par
 * `useChat`). Ce champ est LOCAL — il n'existe jamais sur un document Firestore
 * — d'où ce type d'affichage plutôt qu'un ajout au type `Message`.
 */
type DisplayMessage = Message & { failed?: boolean };

interface ChatBubbleProps {
  message: DisplayMessage;
  isOwnMessage: boolean;
  showTimestamp?: boolean;
  senderImage?: string;
  onReport?: () => void;
}

const ChatBubble = React.memo(function ChatBubble({
  message,
  isOwnMessage,
  showTimestamp = false,
  senderImage,
  onReport,
}: ChatBubbleProps) {
  const viewerId = useAuthenticatedUid(), sdkUid = useFirebaseUserId();
  const imageSourceKey = JSON.stringify([message.chatId, message.id, message.type, message.image?.url ?? null, message.image?.thumbnail ?? null, message.contentModeration ?? null]);
  const imageLifecycle = useLabelLifecycleContext(`chat-message-image:${imageSourceKey}`, viewerId);
  const [imageModal, setImageModal] = useState<{frame: symbol; focusRevision: string; sourceKey: string} | null>(null);
  const imageContextCurrent = imageLifecycle.focused && !!viewerId && viewerId === sdkUid;
  const isImageModalVisible = imageContextCurrent && imageModal?.frame === imageLifecycle.frame && imageModal.focusRevision === imageLifecycle.focusRevision && imageModal.sourceKey === imageSourceKey;

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString(APP_LOCALE, {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // While the message is still in flight ('sending'), its timestamp is not yet
  // server-confirmed — show no time rather than a misleading device-clock value.
  const hasResolvedTime = message.status !== 'sending';

  const renderStatusIcon = (): React.ReactNode => {
    if (!isOwnMessage) return null;

    // ÉCHEC D'ENVOI. Le drapeau `failed` était posé par `useChat` mais rien ne
    // le lisait : la bulle gardait l'horloge « en cours d'envoi » pour toujours,
    // sur un message qui n'est jamais parti et que rien ne renverra. L'horloge
    // est le pire des signaux ici — elle promet que ça va arriver.
    if (message.failed) {
      return <Ionicons name="alert-circle" size={10} color={colors.danger} />;
    }

    const iconColor = message.status === 'read' ? colors.primary : colors.muted;

    switch (message.status) {
      case 'sending':
        return <Ionicons name="time-outline" size={10} color={iconColor} />;
      case 'sent':
        return <Ionicons name="checkmark" size={10} color={iconColor} />;
      // 'read' is written by markMessagesAsRead once the recipient opens the
      // thread (iconColor switches to primary above). No 'delivered' path is
      // ever written for chat messages, so that case is intentionally omitted.
      case 'read':
        return <Ionicons name="checkmark-done" size={10} color={iconColor} />;
      default:
        return null;
    }
  };

  // System message (centered, muted text on subtle background)
  if (message.type === 'system') {
    return (
      <View style={styles.systemMessageContainer}>
        <Text style={styles.systemMessageText}>{message.content}</Text>
      </View>
    );
  }

  // Suppress every old body/URL before either renderer, including an open modal.
  // Structured offers/system events retain their independent business contract.
  if ((message.type === 'text' || message.type === 'image') && Object.prototype.hasOwnProperty.call(message,'contentModeration') &&
    (message.contentModeration?.protocol !== 'content_visibility_v1' || message.contentModeration.state !== 'visible')) {
    return <Pressable style={styles.systemMessageContainer} onLongPress={onReport}
      accessibilityActions={onReport ? [{name: 'longpress', label: 'Signaler ce message'}] : undefined}
      onAccessibilityAction={event => {if (event.nativeEvent.actionName === 'longpress') onReport?.();}}>
      <Text style={styles.systemMessageText}>Ce message n’est plus disponible.</Text>
    </Pressable>;
  }

  // Image message (180x180 with radius.sm border-radius)
  if (message.type === 'image' && message.image) {
    return (
      <View
        style={[
          styles.bubbleContainer,
          isOwnMessage ? styles.ownBubbleContainer : styles.otherBubbleContainer,
        ]}
      >
        {!isOwnMessage && senderImage && (
          <Image
            source={{ uri: senderImage }}
            style={styles.senderAvatar}
            contentFit="cover"
          />
        )}
        <View><Pressable disabled={!imageContextCurrent} onLongPress={onReport}
          accessibilityActions={onReport ? [{name: 'longpress', label: 'Signaler ce message'}] : undefined}
          onAccessibilityAction={event => {if (event.nativeEvent.actionName === 'longpress') onReport?.();}}
          onPress={() => {try {imageLifecycle.capture();
          setImageModal({frame: imageLifecycle.frame, focusRevision: imageLifecycle.focusRevision, sourceKey: imageSourceKey});
        } catch { /* A stale message cannot open its former pixels. */ }}}>
          <PrivateStorageImage
            uri={message.image.thumbnail || message.image.url}
            chatContext={{viewerId, chatId: message.chatId, messageId: message.id, fileKind: message.image.thumbnail ? 'thumbnail' : 'image', sourceKey: imageSourceKey, lifecycle: imageLifecycle}}
            style={styles.imageMessage}
            contentFit="cover"
          />
        </Pressable>
        </View>

        <View
          style={[
            styles.timestampRow,
            isOwnMessage && styles.ownTimestampRow,
          ]}
        >
          {hasResolvedTime && (
            <Text style={[styles.timestampText, isOwnMessage && styles.ownTimestampText]}>
              {formatTime(message.timestamp)}
            </Text>
          )}
          {renderStatusIcon()}
        </View>

        {/* Full Image Modal */}
        <Modal
          visible={isImageModalVisible}
          transparent
          onRequestClose={() => setImageModal(null)}
        >
          <View style={styles.imageModalContainer}>
            <Pressable
              style={styles.imageModalBackground}
              onPress={() => setImageModal(null)}
            >
              <View style={styles.imageModalHeader}>
                <Pressable
                  onPress={() => setImageModal(null)}
                  style={styles.closeButton}
                >
                  <Ionicons name="close" size={28} color={colors.white} />
                </Pressable>
              </View>
              <PrivateStorageImage
                uri={isImageModalVisible ? message.image.url : undefined}
                chatContext={{viewerId, chatId: message.chatId, messageId: message.id, fileKind: 'image', sourceKey: imageSourceKey, lifecycle: imageLifecycle}}
                style={styles.fullImage}
                contentFit="contain"
              />
            </Pressable>
          </View>
        </Modal>
      </View>
    );
  }

  // Text message
  return (
    <View
      style={[
        styles.bubbleContainer,
        isOwnMessage ? styles.ownBubbleContainer : styles.otherBubbleContainer,
      ]}
    >
      {!isOwnMessage && senderImage && (
        <Image
          source={{ uri: senderImage }}
          style={styles.senderAvatar}
          contentFit="cover"
        />
      )}
      <Pressable
        onLongPress={onReport}
        accessibilityActions={onReport ? [{name: 'longpress', label: 'Signaler ce message'}] : undefined}
        onAccessibilityAction={event => {if (event.nativeEvent.actionName === 'longpress') onReport?.();}}
        style={[
          styles.bubble,
          isOwnMessage ? styles.ownBubble : styles.otherBubble,
        ]}
      >
        <Text
          style={[
            styles.messageText,
            isOwnMessage ? styles.ownMessageText : styles.otherMessageText,
          ]}
        >
          {message.content}
        </Text>

        <View
          style={[
            styles.timestampRow,
            isOwnMessage && styles.ownTimestampRow,
          ]}
        >
          {hasResolvedTime && (
            <Text style={[styles.timestampText, isOwnMessage && styles.ownTimestampText]}>
              {formatTime(message.timestamp)}
            </Text>
          )}
          {renderStatusIcon()}
        </View>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  bubbleContainer: {
    marginVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    maxWidth: '80%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  ownBubbleContainer: {
    alignSelf: 'flex-end',
  },
  otherBubbleContainer: {
    alignSelf: 'flex-start',
  },
  senderAvatar: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceWarm,
    flexShrink: 0,
  },
  bubble: {
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 60,
  },
  ownBubble: {
    backgroundColor: colors.charcoal,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderBottomRightRadius: radius.xs,
    borderBottomLeftRadius: radius.md,
  },
  otherBubble: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderBottomRightRadius: radius.md,
    borderBottomLeftRadius: radius.xs,
  },
  messageText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
  },
  ownMessageText: {
    color: colors.cream,
  },
  otherMessageText: {
    color: colors.charcoal,
  },
  timestampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
    gap: 4,
  },
  ownTimestampRow: {
    justifyContent: 'flex-end',
  },
  timestampText: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.muted,
  },
  ownTimestampText: {
    color: colors.whiteTranslucent,
  },
  systemMessageContainer: {
    alignSelf: 'center',
    marginVertical: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.sm,
    maxWidth: '80%',
  },
  systemMessageText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  imageMessage: {
    width: 180,
    height: 180,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceWarm,
  },
  imageModalContainer: {
    flex: 1,
    backgroundColor: colors.black,
  },
  imageModalBackground: {
    flex: 1,
  },
  imageModalHeader: {
    paddingTop: 60,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  closeButton: {
    padding: spacing.sm,
  },
  fullImage: {
    flex: 1,
    width: '100%',
  },
});

export default ChatBubble;

