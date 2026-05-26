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

import { Message } from '@/types';
import { APP_LOCALE } from '@/constants/locale';
import { colors, fonts, radius, spacing } from '@/constants/theme';

interface ChatBubbleProps {
  message: Message;
  isOwnMessage: boolean;
  showTimestamp?: boolean;
  senderImage?: string;
}

const ChatBubble = React.memo(function ChatBubble({
  message,
  isOwnMessage,
  showTimestamp = false,
  senderImage,
}: ChatBubbleProps) {
  const [isImageModalVisible, setIsImageModalVisible] = useState(false);

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString(APP_LOCALE, {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderStatusIcon = (): React.ReactNode => {
    if (!isOwnMessage) return null;

    const iconColor = message.status === 'read' ? colors.primary : colors.muted;

    switch (message.status) {
      case 'sending':
        return <Ionicons name="time-outline" size={10} color={iconColor} />;
      case 'sent':
        return <Ionicons name="checkmark" size={10} color={iconColor} />;
      case 'delivered':
        return <Ionicons name="checkmark-done" size={10} color={iconColor} />;
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
        <Pressable onPress={() => setIsImageModalVisible(true)}>
          <Image
            source={{ uri: message.image.thumbnail || message.image.url }}
            style={styles.imageMessage}
            contentFit="cover"
          />
        </Pressable>

        <View
          style={[
            styles.timestampRow,
            isOwnMessage && styles.ownTimestampRow,
          ]}
        >
          <Text style={[styles.timestampText, isOwnMessage && styles.ownTimestampText]}>
            {formatTime(message.timestamp)}
          </Text>
          {renderStatusIcon()}
        </View>

        {/* Full Image Modal */}
        <Modal
          visible={isImageModalVisible}
          transparent
          onRequestClose={() => setIsImageModalVisible(false)}
        >
          <View style={styles.imageModalContainer}>
            <Pressable
              style={styles.imageModalBackground}
              onPress={() => setIsImageModalVisible(false)}
            >
              <View style={styles.imageModalHeader}>
                <Pressable
                  onPress={() => setIsImageModalVisible(false)}
                  style={styles.closeButton}
                >
                  <Ionicons name="close" size={28} color={colors.white} />
                </Pressable>
              </View>
              <Image
                source={{ uri: message.image.url }}
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
      <View
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
          <Text style={[styles.timestampText, isOwnMessage && styles.ownTimestampText]}>
            {formatTime(message.timestamp)}
          </Text>
          {renderStatusIcon()}
        </View>
      </View>
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

