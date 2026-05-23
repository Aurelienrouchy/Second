/**
 * Chat feature — barrel exports.
 */

export { ChatArticleBar } from './components/ChatArticleBar';
export { ChatEmptyState } from './components/ChatEmptyState';
export { ChatErrorState } from './components/ChatErrorState';
export { ChatHeader } from './components/ChatHeader';
export { ChatInputBar } from './components/ChatInputBar';
export { ChatLoadingSkeleton } from './components/ChatLoadingSkeleton';
export { useChatModeration } from './hooks/useChatModeration';
export type {
  ChatArticleBarProps,
  ChatEmptyStateProps,
  ChatErrorStateProps,
  ChatHeaderProps,
  ChatInputBarProps,
  ChatParticipantInfo,
} from './types';
