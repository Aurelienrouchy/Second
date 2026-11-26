import { renderHookWithQuery as renderHook } from '@/tests/jest/helpers/queryRender';
import { auth } from '@/config/firebaseConfig';
jest.mock('@/services/chatNotificationReadService', () => ({subscribeToReadChatNotifications: jest.fn(() => jest.fn()), reconcileReadChatCounter: jest.fn(async () => undefined), synchronizeNotificationBadge: jest.fn(async () => undefined)}));
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => 1,
  useAuthStore: Object.assign((selector: (state: unknown) => unknown) => selector(require('@/store/authStore').useAuthStore.getState()), { getState: () => ({ authenticatedUid: 'me', user: { id: 'me' } }) }),
}));
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

import { act, waitFor } from '@testing-library/react-native';

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
let offersListener: ((messages: Message[]) => void) | undefined;
const mockListenToActiveOffers = jest.fn(
  (_chatId: string, _userId: string, onUpdate: (m: Message[]) => void) => {
    offersListener = onUpdate;
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
    listenToActiveOffers: (...a: unknown[]) =>
      (mockListenToActiveOffers as unknown as (...args: unknown[]) => unknown)(...a),
    markMessagesAsRead: (...a: unknown[]) => mockMarkRead(...a),
    sendMessage: (...a: unknown[]) => mockSendMessage(...a),
  },
}));

import { useChat } from '@/features/chat/hooks/useChat';

beforeEach(() => {
  (auth as unknown as { currentUser: { uid: string } | null }).currentUser = { uid: 'me' };
  jest.clearAllMocks();
  messagesListener = undefined;
  offersListener = undefined;
});

describe('useChat — chargement initial', () => {
  it('s’abonne aux messages et n’acquitte que des messages réellement chargés', async () => {
    const { result } = renderHook(() => useChat('chat-1', 'me'));

    await waitFor(() => expect(result.current.chat).toEqual(CHAT));
    expect(mockListenToMessages).toHaveBeenCalledWith(
      'chat-1',
      'me',
      expect.any(Function),
      expect.any(Function),
    );
    expect(mockMarkRead).not.toHaveBeenCalled();
    act(() => messagesListener?.([{id: 'incoming-real', chatId: 'chat-1', senderId: 'other', receiverId: 'me', content: 'Message reçu', type: 'text', status: 'sent', timestamp: new Date(), isRead: false}]));
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith('chat-1', 'me', expect.any(Function), ['incoming-real']));
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
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.chat).toBeNull();
    await act(async () => { await expect(result.current.sendMessage('Coucou')).rejects.toMatchObject({code: 'client/stale-operation'}); });
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });
});

describe('useChat — pas de doublon pendant l’aller-retour serveur', () => {
  it('masque la copie optimiste dès que le listener renvoie le vrai message', async () => {
    // La réconciliation ne se faisait que sur `serverId`, posé APRÈS la
    // résolution de `sendMessage`. Or le listener Firestore renvoie l'écriture
    // locale bien avant : le message s'affichait donc en double pendant tout
    // l'aller-retour — et indéfiniment hors ligne, où la promesse ne se résout
    // jamais et où le bouton d'envoi reste verrouillé.
    let resolveSend: (id: string) => void = () => {};
    mockSendMessage.mockImplementationOnce(
      () => new Promise<string>((r) => { resolveSend = r; }),
    );

    const { result } = renderHook(() => useChat('chat-1', 'me'));
    await waitFor(() => expect(messagesListener).toBeDefined());

    act(() => {
      result.current.sendMessage('Bonjour');
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    // Le serveur renvoie le message AVANT que la promesse d'envoi se résolve.
    act(() => {
      messagesListener!([
        {
          id: 'srv-1',
          chatId: 'chat-1',
          senderId: 'me',
          receiverId: 'other',
          type: 'text',
          content: 'Bonjour',
          timestamp: new Date(),
          status: 'sent',
          isRead: false,
        },
      ]);
    });

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0].id).toBe('srv-1');

    act(() => resolveSend('srv-1'));
  });

  it('ne confond pas deux messages au texte différent', async () => {
    const { result } = renderHook(() => useChat('chat-1', 'me'));
    await waitFor(() => expect(messagesListener).toBeDefined());

    let resolveSend: (id: string) => void = () => {};
    mockSendMessage.mockImplementationOnce(
      () => new Promise<string>((r) => { resolveSend = r; }),
    );
    act(() => {
      result.current.sendMessage('Deuxième');
    });

    act(() => {
      messagesListener!([
        {
          id: 'srv-1',
          chatId: 'chat-1',
          senderId: 'me',
          receiverId: 'other',
          type: 'text',
          content: 'Premier',
          timestamp: new Date(),
          status: 'sent',
          isRead: false,
        },
      ]);
    });

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    act(() => resolveSend('srv-2'));
  });
});

describe('useChat — un échec de marquage « lu » ne casse pas l’écran', () => {
  it('garde les messages affichés quand markMessagesAsRead échoue', async () => {
    // `markMessagesAsRead` vivait dans le même `try` que l'installation des
    // listeners : son échec basculait TOUTE la conversation sur l'écran
    // « Erreur — Réessayer », alors que les messages étaient chargés et que le
    // seul dommage réel était une pastille de non-lu qui ne descend pas.
    mockMarkRead.mockRejectedValueOnce(new Error('permission-denied'));

    const { result } = renderHook(() => useChat('chat-1', 'me'));
    await waitFor(() => expect(messagesListener).toBeDefined());

    act(() => {
      messagesListener!([
        {
          id: 'srv-1',
          chatId: 'chat-1',
          senderId: 'other',
          receiverId: 'me',
          type: 'text',
          content: 'Coucou',
          timestamp: new Date(),
          status: 'sent',
          isRead: false,
        },
      ]);
    });

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});


describe('useChat — l’offre sortie de la fenêtre de 50 messages reste actionnable', () => {
  const OLD_OFFER: Message = {
    id: 'offre-ancienne',
    chatId: 'chat-1',
    senderId: 'other',
    receiverId: 'me',
    type: 'offer',
    content: 'Offre de 40 $',
    timestamp: new Date('2026-06-01T10:00:00'),
    status: 'sent',
    isRead: true,
  } as Message;

  const RECENT: Message = {
    id: 'recent',
    chatId: 'chat-1',
    senderId: 'other',
    receiverId: 'me',
    type: 'text',
    content: 'à demain',
    timestamp: new Date('2026-06-10T10:00:00'),
    status: 'sent',
    isRead: true,
  } as Message;

  it('épingle l’offre active absente de la fenêtre, au bon rang chronologique', async () => {
    // Sans cet épinglage, la bulle disparaît de l'écran et avec elle
    // « Confirmer », « Signaler une absence », « Finaliser » et « Annuler la
    // rencontre » — toute action sur une transaction pourtant vivante.
    const { result } = renderHook(() => useChat('chat-1', 'me'));
    await waitFor(() => expect(messagesListener).toBeDefined());
    await waitFor(() => expect(offersListener).toBeDefined());

    act(() => messagesListener!([RECENT]));
    act(() => offersListener!([OLD_OFFER]));

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages.map((m) => m.id)).toEqual(['offre-ancienne', 'recent']);
  });

  it('ne duplique pas une offre déjà présente dans la fenêtre', async () => {
    const { result } = renderHook(() => useChat('chat-1', 'me'));
    await waitFor(() => expect(offersListener).toBeDefined());

    act(() => messagesListener!([OLD_OFFER, RECENT]));
    act(() => offersListener!([OLD_OFFER]));

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
  });
});
