import type { Article } from '@/types';

/** Participant info extracted from Chat.participantsInfo */
export interface ChatParticipantInfo {
  userId: string;
  userName: string;
  userImage?: string;
  /** Backend trigger uses profileImage for map-format participantsInfo */
  profileImage?: string;
}

export interface ChatHeaderProps {
  otherParticipant: ChatParticipantInfo | null;
  otherAvatar: string | undefined;
  articlePrice: number | undefined;
  onMoreOptions: () => void;
}

export interface ChatArticleBarProps {
  /** Live article data (null when article has been deleted) */
  article: Article | null;
  articleTitle: string | undefined;
  /** Current (live) price of the article */
  articlePrice: number | undefined;
  /** Original price snapshot stored in the chat document (may differ from current) */
  snapshotPrice?: number | undefined;
  /** Snapshot image URL from the chat document (fallback when article is null) */
  snapshotImage?: string | undefined;
}

export interface ChatInputBarProps {
  messageText: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onPickImage: () => void;
  onMakeOffer: () => void;
  isSendingImage: boolean;
  hasArticle: boolean;
}

export interface ChatEmptyStateProps {
  otherParticipantName: string | undefined;
}

export interface ChatErrorStateProps {
  errorMessage: string;
}
