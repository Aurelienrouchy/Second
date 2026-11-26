import AsyncStorage from '@react-native-async-storage/async-storage';
let mockSessionUid = 'sender';
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => 1,
  useAuthStore: Object.assign((selector: (state: unknown) => unknown) => selector(require('@/store/authStore').useAuthStore.getState()), { getState: () => ({ authenticatedUid: mockSessionUid, user: null }) }),
}));
/**
 * ChatService — envoi de messages & cycle de vie des offres.
 *
 * Comportement métier couvert (cœur de la messagerie) :
 *  - sendMessage : gating auth (pas d'utilisateur Firebase → rejet ; UID ≠
 *    senderId → "Session invalide"), garde de blocage (refus si l'un a bloqué
 *    l'autre), puis écriture du message + maj atomique du chat
 *    (`unreadCount.<receiver>` via increment(1), lastMessage…).
 *  - sendOffer : compose le contenu FR + totalAmount (prix + livraison) et
 *    attache la metadata `offer { amount, status:'pending', totalAmount }`.
 *  - acceptOffer : une offre expirée passe en 'expired' et lève — jamais
 *    'accepted' (régression H9).
 *  - rejectOffer : passe l'offre en 'rejected'.
 *
 * tests/jest/ → Jest ; *.test.ts ignoré par Vitest (pas de collision).
 */

// --- Firestore : observable finement (le mock global de jest.setup est nu) ---
const mockGetDoc = jest.fn();
const mockGetDocs = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ empty: true, docs: [] as { id: string }[], forEach: () => {}, size: 0 }),
);
const mockAddDoc = jest.fn((..._args: unknown[]) => Promise.resolve({ id: 'msg-new' }));
const mockUpdateDoc = jest.fn((..._args: unknown[]) => Promise.resolve());

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db: unknown, name: string) => ({ name })),
  doc: jest.fn((dbOrCollection: unknown, col?: string, id?: string) => col ? { col, id } : { col: (dbOrCollection as { name: string }).name, id: 'client-request-id' }),
  getDoc: (...args: unknown[]) => mockGetDoc(...args), getDocFromServer: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args), getDocsFromServer: (...args: unknown[]) => mockGetDocs(...args),
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  onSnapshot: jest.fn((..._args: unknown[]) => jest.fn()),
  runTransaction: jest.fn(),
  serverTimestamp: jest.fn((..._args: unknown[]) => 'SERVER_TS'),
  increment: jest.fn((n: number) => ({ __increment: n })),
}));

// --- expo-image-manipulator : ESM non transpilé sous Jest → mock no-op -------
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn((uri: string) => Promise.resolve({ uri, width: 1024, height: 768 })),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => 'media-request-id' }));
const mockUploadBytes = jest.fn((..._args: unknown[]) => Promise.resolve({ metadata: {
  generation: (_args[0] as {fullPath: string}).fullPath.endsWith('_thumb.jpg') ? '100002' : '100001',
  downloadTokens: ['automatically-created-test-token'] } }));
const mockGetDownloadURL = jest.fn();
// Storage image sends are mocked: no external upload or token is created.
jest.mock('firebase/storage', () => ({
  ref: jest.fn((_storage: unknown, path: string) => ({ bucket: 'demo-second.appspot.com', fullPath: path })),
  uploadBytes: (...args: unknown[]) => mockUploadBytes(...args),
  getDownloadURL: (...args: unknown[]) => mockGetDownloadURL(...args),
}));

// --- Callable Functions : acceptMeetupOffer (chemin meetup) ------------------
const mockCallable = jest.fn<Promise<{data: Record<string, unknown>}>, unknown[]>((..._args: unknown[]) => Promise.resolve({ data: { success: true, transactionId: 'tx-1', messageId: 'server-offer', notificationCommitted: true, deviceDeliveryVerified: false, readingVerified: false } }));
jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn((..._args: unknown[]) => mockCallable),
}));

// --- Collaborateurs : on coupe les vrais services pour isoler ChatService ----
const mockAreUsersBlocked = jest.fn((..._args: unknown[]) => Promise.resolve(false));
jest.mock('@/services/moderationService', () => ({
  ModerationService: { areUsersBlocked: (...a: unknown[]) => mockAreUsersBlocked(...a) },
}));
jest.mock('@/services/transactionService', () => ({
  TransactionService: {
    getTransactionByChat: jest.fn((..._args: unknown[]) => Promise.resolve(null)),
    updateTransactionStatus: jest.fn((..._args: unknown[]) => Promise.resolve()),
  },
}));

import { auth } from '@/config/firebaseConfig';
import { ChatService } from '@/services/chatService';

const mockAuth = auth as unknown as { currentUser: { uid: string } | null };

/** getDoc renvoie d'abord le chat (participants), puis le message d'offre. */
function chatDoc(participants: string[]) {
  return { exists: () => true, data: () => ({ participants, articleId: 'article-1' }) };
}

beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear();
  mockGetDoc.mockReset(); mockGetDocs.mockReset().mockResolvedValue({empty: true, docs: [], size: 0}); mockCallable.mockReset(); mockAreUsersBlocked.mockReset();
  mockAddDoc.mockReset().mockResolvedValue({ id: 'msg-new' });
  mockUpdateDoc.mockReset().mockResolvedValue(undefined);
  mockSessionUid = 'sender';
  mockAuth.currentUser = { uid: 'sender' };
  mockAreUsersBlocked.mockResolvedValue(false);
  mockCallable.mockResolvedValue({ data: { success: true, transactionId: 'tx-1', messageId: 'server-offer', notificationCommitted: true, deviceDeliveryVerified: false, readingVerified: false } });
  // Par défaut, toute lecture chat renvoie un chat à deux participants.
  mockGetDoc.mockImplementation(async (reference: {col?: string}) => {
    if (reference.col === 'messages') return {exists: () => true, data: () => ({chatId: 'chat-1', type: 'offer', senderId: 'sender', receiverId: 'receiver', offer: {status: 'accepted', amount: 80, meetup: {location: {name: 'Café X'}}, transactionId: 'tx-confirmed'}})};
    if (reference.col === 'transactions') return {exists: () => true, data: () => ({chatId: 'chat-1', articleId: 'article-1', buyerId: 'sender', sellerId: 'receiver', status: 'meetup_confirmed', amount: 80, deliveryType: 'meetup', offerMessageId: 'msg-1', meetupSpot: {name: 'Café X'}})};
    return chatDoc(['sender', 'receiver']);
  });
});

describe('ChatService.sendMessage — gating auth', () => {
  it('rejette quand aucun utilisateur Firebase n’est authentifié', async () => {
    mockAuth.currentUser = null;
    await expect(
      ChatService.sendMessage('chat-1', 'sender', 'receiver', 'Bonjour'),
    ).rejects.toThrow(/session|dossier/i);
    expect(mockAddDoc).not.toHaveBeenCalled();
  });

  it('rejette quand l’UID Firebase ne correspond pas au senderId', async () => {
    mockAuth.currentUser = { uid: 'someone-else' };
    await expect(
      ChatService.sendMessage('chat-1', 'sender', 'receiver', 'Bonjour'),
    ).rejects.toThrow(/session|dossier/i);
    expect(mockAddDoc).not.toHaveBeenCalled();
  });
});

describe('ChatService.sendMessage — garde de blocage', () => {
  it('refuse l’envoi si l’un des deux utilisateurs a bloqué l’autre', async () => {
    mockAreUsersBlocked.mockResolvedValueOnce(true);
    await expect(
      ChatService.sendMessage('chat-1', 'sender', 'receiver', 'Salut'),
    ).rejects.toThrow(/Impossible d'envoyer un message/);
    expect(mockAddDoc).not.toHaveBeenCalled();
  });
});

describe('ChatService.sendMessage — écriture nominale', () => {
  it('crée le message puis incrémente le non-lu du destinataire de façon atomique', async () => {
    const id = await ChatService.sendMessage('chat-1', 'sender', 'receiver', 'Bonjour');
    expect(id).toBe('msg-new');

    // 1) message persisté avec participants triés + type texte.
    const [, messageData] = mockAddDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(messageData).toMatchObject({
      chatId: 'chat-1',
      senderId: 'sender',
      receiverId: 'receiver',
      type: 'text',
      content: 'Bonjour',
      status: 'sent',
      isRead: false,
    });
    expect(messageData.participants).toEqual(['receiver', 'sender'].sort());

    // 2) maj du chat : last message + increment(1) sur unreadCount.<receiver>.
    const [, updateData] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(updateData.lastMessage).toBe('Bonjour');
    expect(updateData.lastMessageType).toBe('text');
    expect(updateData['unreadCount.receiver']).toEqual({ __increment: 1 });
  });
});

describe('ChatService.sendOffer — phase locale gratuite', () => {
  it('bloque les nouvelles offres livraison avant toute écriture', async () => {
    await expect(ChatService.sendOffer('chat-1', 'sender', 'receiver', 30, undefined, undefined, {
      carrier: 'Postes Canada', serviceName: 'Regular', estimatedDays: '3-5', amount: 8, currency: 'CAD',
    })).rejects.toThrow(/pas disponibles/);
    expect(mockAddDoc).not.toHaveBeenCalled(); expect(mockCallable).not.toHaveBeenCalled();
  });
  it('le point d’entrée shipping sans devis reste bloqué', async () => {
    await expect(ChatService.sendOffer('chat-1', 'sender', 'receiver', 25)).rejects.toThrow(/pas disponibles/);
    expect(mockAddDoc).not.toHaveBeenCalled();
  });
});

describe('ChatService.acceptOffer — autorité serveur', () => {
  it('propage le refus serveur d’une proposition expirée sans mutation client', async () => {
    mockCallable.mockRejectedValueOnce(Object.assign(new Error('Cette offre a expiré'), {code: 'functions/failed-precondition'}));
    mockSessionUid = 'receiver';
    mockAuth.currentUser = { uid: 'receiver' };
    await expect(ChatService.acceptOffer('chat-1', 'msg-1', 'offer-1', 'receiver')).rejects.toThrow(/expiré/);
    expect(mockCallable).toHaveBeenCalledWith({ chatId: 'chat-1', messageId: 'msg-1' });
    expect(mockUpdateDoc).not.toHaveBeenCalled(); expect(mockAddDoc).not.toHaveBeenCalled();
  });
});

describe('ChatService.completeMeetup — accord exactement lié', () => {
  const acceptedMessage = (linked = true) => ({ exists: () => true, data: () => ({ chatId: 'chat-1', offer: {
    status: 'accepted', amount: 80, meetup: { location: { name: 'Café X' } }, ...(linked ? { transactionId: 'tx-confirmed' } : {}),
  } }) });
  it('demande la completion du message et de sa transaction dans la même callable', async () => {
    mockGetDoc.mockResolvedValueOnce(acceptedMessage());
    await ChatService.completeMeetup('chat-1', 'msg-1', 'sender');
    expect(mockCallable).toHaveBeenCalledWith({ transactionId: 'tx-confirmed', messageId: 'msg-1', expectedUid: 'sender' });
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled(); expect(mockAddDoc).not.toHaveBeenCalled();
  });
  it('ne marque PAS le message si la callable échoue (accord annulé/disputé)', async () => {
    mockGetDoc.mockResolvedValueOnce(acceptedMessage());
    mockCallable.mockRejectedValueOnce(new Error('Cannot complete meetup from status cancelled'));
    await expect(ChatService.completeMeetup('chat-1', 'msg-1', 'sender')).rejects.toThrow(/Cannot complete meetup from status cancelled/);
    expect(mockUpdateDoc).not.toHaveBeenCalled(); expect(mockAddDoc).not.toHaveBeenCalled();
  });
  it('ne choisit aucune transaction arbitraire pour un ancien message sans accord lié', async () => {
    mockGetDoc.mockResolvedValueOnce(acceptedMessage(false));
    await expect(ChatService.completeMeetup('chat-1', 'msg-1', 'sender')).rejects.toThrow(/Aucune transaction de rencontre à finaliser/);
    expect(mockCallable).not.toHaveBeenCalled(); expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

describe('ChatService.rejectOffer — autorité serveur', () => {
  it('demande un refus du message exact sans annuler une transaction locale', async () => {
    mockSessionUid = 'receiver';
    mockAuth.currentUser = { uid: 'receiver' };
    await ChatService.rejectOffer('chat-1', 'msg-1', 'offer-1', 'receiver');
    expect(mockCallable).toHaveBeenCalledWith({ chatId: 'chat-1', messageId: 'msg-1' });
    expect(mockUpdateDoc).not.toHaveBeenCalled(); expect(mockAddDoc).not.toHaveBeenCalled();
  });
});


describe('ChatService.sendMeetupOffer — proposition serveur', () => {
  it('transmet lieu et montant avec un identifiant de requête sans écrire de message client', async () => {
    const location = { name: 'Lieu test', category: 'cafe' as const, neighborhood: { id: 'n1', name: 'Quartier test', borough: 'Test' } };
    const id = await ChatService.sendMeetupOffer('chat-1', 'sender', 'receiver', 80, location);
    expect(id).toBe('server-offer');
    expect(mockCallable).toHaveBeenCalledWith({ chatId: 'chat-1', requestId: 'client-request-id', amount: 80, location });
    expect(mockAddDoc).not.toHaveBeenCalled(); expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});


describe('ChatService.sendImage — private references', () => {
  it('ignores auto-generated upload tokens and writes only tokenless media references', async () => {
    const localFetch = jest.spyOn(global, 'fetch').mockResolvedValue({ blob: async () => ({}) } as unknown as Response);
    try {
      await ChatService.sendImage('chat-1', 'sender', 'receiver', 'file:///photo.jpg');
      expect(mockUploadBytes).toHaveBeenCalledTimes(2);
      for (const upload of mockUploadBytes.mock.calls) {
        expect(upload[2]).toEqual({ contentType: 'image/jpeg', cacheControl: 'private, no-store, max-age=0' });
      }
      const message = mockAddDoc.mock.calls[0][1] as { image: { url: string; thumbnail: string; generation: string; thumbnailGeneration: string } };
      expect(message.image.url).toContain('/o/chat_images%2Fchat-1%2Fsender%2Fmedia-request-id.jpg?alt=media');
      expect(message.image.thumbnail).toContain('/o/chat_images%2Fchat-1%2Fsender%2Fmedia-request-id_thumb.jpg?alt=media');
      expect(message.image.generation).toBe('100001'); expect(message.image.thumbnailGeneration).toBe('100002');
      expect(JSON.stringify(message)).not.toContain('automatically-created-test-token');
      expect(message.image.url).not.toContain('token=');
      expect(message.image.thumbnail).not.toContain('token=');
      expect(mockGetDownloadURL).not.toHaveBeenCalled();
    } finally { localFetch.mockRestore(); }
  });
  it('rejects a stale/signed-out sender before uploading any bytes', async () => {
    mockAuth.currentUser = null;
    await expect(ChatService.sendImage('chat-1', 'sender', 'receiver', 'file:///photo.jpg')).rejects.toThrow();
    expect(mockUploadBytes).not.toHaveBeenCalled();
    expect(mockAddDoc).not.toHaveBeenCalled();
  });
});

describe('ChatService.sendMessage — l’aperçu n’est pas l’envoi', () => {
  it('ne signale pas un échec quand seule la mise à jour du fil échoue', async () => {
    // Le message EST créé avant la mise à jour du fil. Lever ici marquait la
    // bulle « échec » alors que le message est parti et visible chez le
    // destinataire — l'utilisateur le renvoyait, créant un vrai doublon.
    mockGetDoc.mockResolvedValue(chatDoc(['sender', 'receiver']));
    mockUpdateDoc.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(
      ChatService.sendMessage('chat-1', 'sender', 'receiver', 'Bonjour'),
    ).resolves.toBe('msg-new');

    expect(mockAddDoc).toHaveBeenCalledTimes(1);
  });

  it('un échec de création du message reste bien une erreur', async () => {
    mockGetDoc.mockResolvedValue(chatDoc(['sender', 'receiver']));
    mockAddDoc.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(
      ChatService.sendMessage('chat-1', 'sender', 'receiver', 'Bonjour'),
    ).rejects.toThrow();
  });
});

describe('ChatService.sendMessage — l’aperçu est tronqué', () => {
  it('n’écrit pas plus de 200 caractères dans lastMessage', async () => {
    mockGetDoc.mockResolvedValue(chatDoc(['sender', 'receiver']));
    const long = 'x'.repeat(3000);

    await ChatService.sendMessage('chat-1', 'sender', 'receiver', long);

    // Le MESSAGE garde son contenu entier…
    const [, msg] = mockAddDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(msg.content).toBe(long);

    // …mais l'APERÇU, lu sur une seule ligne dans la liste, est borné.
    const [, chatUpdate] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect((chatUpdate.lastMessage as string).length).toBe(200);
  });

  it('laisse intact un contenu court', async () => {
    mockGetDoc.mockResolvedValue(chatDoc(['sender', 'receiver']));
    await ChatService.sendMessage('chat-1', 'sender', 'receiver', 'Bonjour');

    const [, chatUpdate] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(chatUpdate.lastMessage).toBe('Bonjour');
  });
});
