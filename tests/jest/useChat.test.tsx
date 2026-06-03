/**
 * useChat — hook de conversation (envoi optimiste + réconciliation temps réel).
 *
 * Comportement métier couvert :
 *  - sendMessage insère immédiatement un message optimiste 'sending' (UX
 *    instantanée), puis le marque 'sent' avec son serverId à la résolution.
 *  - quand le listener temps réel renvoie le message confirmé (même serverId),
 *    la copie optimiste est retirée (dédoublonnage — pas de doublon affiché).
 *  - en cas d'échec d'écriture, la copie optimiste est marquée `failed` et
 *    l'erreur est propagée (la bulle peut proposer un retry).
 *  - sendMessage est un no-op silencieux quand il n'y a pas de destinataire
 *    identifiable (chat à un seul participant).
 *
 * On mocke entièrement ChatService pour piloter le listener et la résolution
 * d'envoi de façon déterministe. .test.tsx → périmètre Jest.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { Chat, Message } from '@/types';

// --- Mock ChatService : on capture les callbacks du listener pour les piloter -
let messagesListener: ((messages: Message[]) => void) | undefined;
const mockSendMessage = jest.fn();
const mockListenToMessages = jest.fn(
  (_chatId: string, _userId: string, onUpdate: (m: Message[]) => void) => {
    messagesListener = onUpdate;
    return jest.fn(); // unsubscribe
  },
);
const mockListenToChat = jest.fn((..._args: unknown[]) => jest.fn());
const mockMarkRead = jest.fn((..._args: unknown[]) => Promise.resolve());

// Préfixe `mock` : autorisé dans la factory jest.mock (hoisting).
const mockChat: Chat = {
  id: 'chat-1',
  participants: ['me', 'other'],
  participantsInfo: [
    { userId: 'me', userName: 'Moi' },
    { userId: 'other', userName: 'Autre' },
  ],
  unreadCount: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};
// Alias lisible côté assertions.
const CHAT = mockChat;

jest.mock('@/services/chatService', () => ({
  ChatService: {
    getChatById: jest.fn((..._args: unknown[]) => Promise.resolve(mockChat)),
    listenToMessages: (...a: unknown[]) =>
      (mockListenToMessages as unknown as (...args: unknown[]) => unknown)(...a),
    listenToChat: (...a: unknown[]) =>
      (mockListenToChat as unknown as (...args: unknown[]) => unknown)(...a),
    markMessagesAsRead: (...a: unknown[]) => mockMarkRead(...a),
    sendMessage: (...a: unknown[]) => mockSendMessage(...a),
  },
}));

import { useChat } from '@/hooks/useChat';

beforeEach(() => {
  jest.clearAllMocks();
  messagesListener = undefined;
});

describe('useChat — chargement initial', () => {
  it('s’abonne aux messages et marque le chat comme lu', async () => {
    const { result } = renderHook(() => useChat('chat-1', 'me'));

    await waitFor(() => expect(result.current.chat).toEqual(CHAT));
    expect(mockListenToMessages).toHaveBeenCalledWith(
      'chat-1',
      'me',
      expect.any(Function),
      expect.any(Function),
    );
    expect(mockMarkRead).toHaveBeenCalledWith('chat-1', 'me');
  });

  it('ne s’abonne pas sans chatId (pas de destinataire/conversation)', async () => {
    const { result } = renderHook(() => useChat(null, 'me'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockListenToMessages).not.toHaveBeenCalled();
  });
});

describe('useChat — envoi optimiste & réconciliation', () => {
  it('affiche le message en "sending" puis "sent" avec son serverId', async () => {
    let resolveSend: (id: string) => void = () => {};
    mockSendMessage.mockImplementation(
      () => new Promise<string>((res) => { resolveSend = res; }),
    );

    const { result } = renderHook(() => useChat('chat-1', 'me'));
    await waitFor(() => expect(result.current.chat).toEqual(CHAT));

    // L'envoi insère immédiatement une bulle optimiste 'sending'.
    let sendPromise: Promise<void> = Promise.resolve();
    act(() => { sendPromise = result.current.sendMessage('Coucou'); });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      content: 'Coucou',
      senderId: 'me',
      receiverId: 'other',
      status: 'sending',
    });
    expect(result.current.isSending).toBe(true);

    // Résolution de l'écriture serveur → status 'sent' + serverId attaché.
    await act(async () => { resolveSend('srv-1'); await sendPromise; });
    expect(result.current.messages[0].status).toBe('sent');
    expect(result.current.isSending).toBe(false);
  });

  it('retire la copie optimiste quand le listener renvoie le message confirmé', async () => {
    mockSendMessage.mockResolvedValue('srv-1');
    const { result } = renderHook(() => useChat('chat-1', 'me'));
    await waitFor(() => expect(result.current.chat).toEqual(CHAT));

    await act(async () => { await result.current.sendMessage('Coucou'); });
    expect(result.current.messages).toHaveLength(1);

    // Le serveur écho le message avec l'id 'srv-1' → dédoublonnage.
    const confirmed: Message = {
      id: 'srv-1',
      chatId: 'chat-1',
      senderId: 'me',
      receiverId: 'other',
      type: 'text',
      content: 'Coucou',
      timestamp: new Date(),
      status: 'sent',
      isRead: false,
    };
    act(() => { messagesListener?.([confirmed]); });

    // Pas de doublon : une seule occurrence, celle du serveur.
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe('srv-1');
    expect(result.current.isSending).toBe(false);
  });

  it('marque le message "failed" et propage l’erreur si l’écriture échoue', async () => {
    mockSendMessage.mockRejectedValue(new Error('réseau KO'));
    const { result } = renderHook(() => useChat('chat-1', 'me'));
    await waitFor(() => expect(result.current.chat).toEqual(CHAT));

    await act(async () => {
      await expect(result.current.sendMessage('Coucou')).rejects.toThrow('réseau KO');
    });

    expect(result.current.messages).toHaveLength(1);
    expect((result.current.messages[0] as Message & { failed?: boolean }).failed).toBe(true);
    // Un message en échec ne maintient pas l'état "envoi en cours".
    expect(result.current.isSending).toBe(false);
  });

  it('ne crée aucune bulle si aucun destinataire (chat mono-participant)', async () => {
    const soloChat: Chat = { ...CHAT, participants: ['me'] };
    const chatService = jest.requireMock('@/services/chatService') as {
      ChatService: { getChatById: jest.Mock };
    };
    chatService.ChatService.getChatById.mockResolvedValueOnce(soloChat);

    const { result } = renderHook(() => useChat('chat-1', 'me'));
    await waitFor(() => expect(result.current.chat).toEqual(soloChat));

    await act(async () => { await result.current.sendMessage('Coucou'); });
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });
});
