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
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
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

// --- Storage (sendImage) : non exercé ici mais importé par le service --------
jest.mock('firebase/storage', () => ({
  ref: jest.fn((..._args: unknown[]) => ({})),
  uploadBytes: jest.fn((..._args: unknown[]) => Promise.resolve({ ref: {} })),
  getDownloadURL: jest.fn((..._args: unknown[]) => Promise.resolve('https://storage/img.jpg')),
}));

// --- Callable Functions : acceptMeetupOffer (chemin meetup) ------------------
const mockCallable = jest.fn((..._args: unknown[]) => Promise.resolve({ data: { success: true, transactionId: 'tx-1', messageId: 'server-offer' } }));
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
  return { exists: () => true, data: () => ({ participants }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = { uid: 'sender' };
  mockAreUsersBlocked.mockResolvedValue(false);
  mockCallable.mockResolvedValue({ data: { success: true, transactionId: 'tx-1', messageId: 'server-offer' } });
  // Par défaut, toute lecture chat renvoie un chat à deux participants.
  mockGetDoc.mockResolvedValue(chatDoc(['sender', 'receiver']));
});

describe('ChatService.sendMessage — gating auth', () => {
  it('rejette quand aucun utilisateur Firebase n’est authentifié', async () => {
    mockAuth.currentUser = null;
    await expect(
      ChatService.sendMessage('chat-1', 'sender', 'receiver', 'Bonjour'),
    ).rejects.toThrow(/Non authentifié/);
    expect(mockAddDoc).not.toHaveBeenCalled();
  });

  it('rejette quand l’UID Firebase ne correspond pas au senderId', async () => {
    mockAuth.currentUser = { uid: 'someone-else' };
    await expect(
      ChatService.sendMessage('chat-1', 'sender', 'receiver', 'Bonjour'),
    ).rejects.toThrow(/Session invalide/);
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
    mockCallable.mockRejectedValueOnce(new Error('Cette offre a expiré'));
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
    expect(mockCallable).toHaveBeenCalledWith({ transactionId: 'tx-confirmed', messageId: 'msg-1' });
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
