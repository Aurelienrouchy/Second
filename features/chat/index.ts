/**
 * Chat feature — barrel exports.
 */

export { ChatArticleBar } from './components/ChatArticleBar';
export { ChatEmptyState } from './components/ChatEmptyState';
export { ChatErrorState } from './components/ChatErrorState';
export { ChatHeader } from './components/ChatHeader';
export { ChatInputBar } from './components/ChatInputBar';
export { ChatLoadingSkeleton } from './components/ChatLoadingSkeleton';
export { ConversationOrderProgress } from './components/ConversationOrderProgress';
export type {
  ChatArticleBarProps,
  ChatEmptyStateProps,
  ChatErrorStateProps,
  ChatHeaderProps,
  ChatInputBarProps,
  ChatParticipantInfo,
} from './types';

// — modules rattachés lors du regroupement par feature —
export { default as ChatBubble } from './components/ChatBubble';
export { useChatModeration } from './hooks/useChatModeration';
