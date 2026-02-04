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

interface ChatBubbleProps {
  message: Message;
  isOwnMessage: boolean;
  showTimestamp?: boolean;
}

const ChatBubble: React.FC<ChatBubbleProps> = ({
  message,
  isOwnMessage,
  showTimestamp = false,
}) => {
  const [isImageModalVisible, setIsImageModalVisible] = useState(false);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderStatusIcon = () => {
    if (!isOwnMessage) return null;

    switch (message.status) {
      case 'sending':
        return <Ionicons name="time-outline" size={12} color="#8E8E93" />;
      case 'sent':
        return <Ionicons name="checkmark" size={12} color="#8E8E93" />;
      case 'delivered':
        return <Ionicons name="checkmark-done" size={12} color="#8E8E93" />;
      case 'read':
        return <Ionicons name="checkmark-done" size={12} color="#007AFF" />;
      default:
        return null;
    }
  };

  // System message (centered, grey)
  if (message.type === 'system') {
    return (
      <View style={styles.systemMessageContainer}>
        <Text style={styles.systemMessageText}>{message.content}</Text>
      </View>
    );
  }

  // Image message
  if (message.type === 'image' && message.image) {
    return (
      <View style={[
        styles.bubbleContainer,
        isOwnMessage ? styles.ownBubbleContainer : styles.otherBubbleContainer,
      ]}>
        <Pressable onPress={() => setIsImageModalVisible(true)}>
          <Image
            source={{ uri: message.image.thumbnail || message.image.url }}
            style={styles.imageMessage}
            contentFit="cover"
          />
        </Pressable>
        
        <View style={[
          styles.timestampRow,
          isOwnMessage && styles.ownTimestampRow,
        ]}>
          <Text style={styles.timestampText}>{formatTime(message.timestamp)}</Text>
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
                  <Ionicons name="close" size={28} color="#FFFFFF" />
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

  // Text message (offer messages are handled separately by OfferBubble)
  return (
    <View style={[
      styles.bubbleContainer,
      isOwnMessage ? styles.ownBubbleContainer : styles.otherBubbleContainer,
    ]}>
      <View style={[
        styles.bubble,
        isOwnMessage ? styles.ownBubble : styles.otherBubble,
      ]}>
        <Text style={[
          styles.messageText,
          isOwnMessage ? styles.ownMessageText : styles.otherMessageText,
        ]}>
          {message.content}
        </Text>
        
        <View style={[
          styles.timestampRow,
          isOwnMessage && styles.ownTimestampRow,
        ]}>
          <Text style={styles.timestampText}>{formatTime(message.timestamp)}</Text>
          {renderStatusIcon()}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bubbleContainer: {
    marginVertical: 2,
    paddingHorizontal: 16,
    maxWidth: '80%',
  },
  ownBubbleContainer: {
    alignSelf: 'flex-end',
  },
  otherBubbleContainer: {
    alignSelf: 'flex-start',
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 6,
    minWidth: 60,
  },
  ownBubble: {
    backgroundColor: '#007AFF',
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: '#F2F2F7',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 21,
  },
  ownMessageText: {
    color: '#FFFFFF',
  },
  otherMessageText: {
    color: '#1C1C1E',
  },
  timestampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 2,
    gap: 4,
  },
  ownTimestampRow: {
    justifyContent: 'flex-end',
  },
  timestampText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  systemMessageContainer: {
    alignSelf: 'center',
    marginVertical: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    borderRadius: 12,
    maxWidth: '80%',
  },
  systemMessageText: {
    fontSize: 13,
    color: '#8E8E93',
    textAlign: 'center',
  },
  imageMessage: {
    width: 200,
    height: 200,
    borderRadius: 12,
    backgroundColor: '#F2F2F7',
  },
  imageModalContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  imageModalBackground: {
    flex: 1,
  },
  imageModalHeader: {
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  closeButton: {
    padding: 8,
  },
  fullImage: {
    flex: 1,
    width: '100%',
  },
});

export default ChatBubble;

