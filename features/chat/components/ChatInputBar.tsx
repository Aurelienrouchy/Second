import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, fonts, radius, spacing } from '@/constants/theme';
import type { ChatInputBarProps } from '../types';

// `isSending` is a local-only extension (text-message send in flight). Declared
// here to avoid touching the shared feature types barrel for an optional prop.
type ChatInputBarComponentProps = ChatInputBarProps & { isSending?: boolean };

export const ChatInputBar = React.memo(function ChatInputBar({
  messageText,
  onChangeText,
  onSend,
  onPickImage,
  onMakeOffer,
  isSendingImage,
  hasArticle,
  isSending = false,
}: ChatInputBarComponentProps) {
  // Block double-sends while a text message is still mid-flight.
  const canSend = messageText.trim().length > 0 && !isSending;

  return (
    <View style={styles.inputContainer}>
      <Pressable
        style={styles.attachButton}
        onPress={onPickImage}
        disabled={isSendingImage}
      >
        {isSendingImage ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons name="attach" size={18} color={colors.muted} />
        )}
      </Pressable>

      <TextInput
        testID="chat-input"
        style={styles.messageInput}
        placeholder="Message..."
        value={messageText}
        onChangeText={onChangeText}
        multiline
        maxLength={1000}
        autoCorrect={false}
        placeholderTextColor={colors.muted}
      />

      {hasArticle && (
        <Pressable testID="chat-offer-button" style={styles.offerButton} onPress={onMakeOffer}>
          <Text style={styles.offerIcon}>$</Text>
        </Pressable>
      )}

      <Pressable
        testID="chat-send-button"
        style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
        onPress={onSend}
        disabled={!canSend}
      >
        {isSending ? (
          <ActivityIndicator size="small" color={colors.cream} />
        ) : (
          <Ionicons
            name="arrow-forward"
            size={18}
            color={canSend ? colors.cream : colors.muted}
          />
        )}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceWarm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  attachButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  messageInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.foreground,
  },
  offerButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
  },
  offerIcon: {
    fontSize: 18,
    color: colors.primary,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.charcoal,
  },
  sendButtonDisabled: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
