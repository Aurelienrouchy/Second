import type { Article } from '@/types';

/** Participant info extracted from Chat.participantsInfo */
export interface ChatParticipantInfo {
  userId: string;
  userName: string;
  userImage?: string;
}

export interface ChatHeaderProps {
  otherParticipant: ChatParticipantInfo | null;
  otherAvatar: string | undefined;
  articlePrice: number | undefined;
  onMoreOptions: () => void;
}

export interface ChatArticleBarProps {
  article: Article;
  articleTitle: string | undefined;
  articlePrice: number | undefined;
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
