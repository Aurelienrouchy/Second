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
  doc: jest.fn((_db: unknown, col: string, id: string) => ({ col, id })),
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
const mockCallable = jest.fn((..._args: unknown[]) => Promise.resolve({ data: { success: true, transactionId: 'tx-1' } }));
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

describe('ChatService.sendOffer', () => {
  it('compose le contenu FR et calcule le total (prix + livraison)', async () => {
    await ChatService.sendOffer('chat-1', 'sender', 'receiver', 30, undefined, undefined, {
      carrier: 'Postes Canada',
      serviceName: 'Regular',
      estimatedDays: '3-5',
      amount: 8,
      currency: 'CAD',
    });

    const [, messageData] = mockAddDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(messageData.type).toBe('offer');
    expect(messageData.content).toContain('Offre de 30 $');
    expect(messageData.content).toContain('8 $ de livraison');
    expect(messageData.content).toContain('Postes Canada');

    const offer = messageData.offer as Record<string, unknown>;
    expect(offer).toMatchObject({ amount: 30, status: 'pending', totalAmount: 38 });
  });

  it('sans livraison : totalAmount = montant et contenu sans ligne livraison', async () => {
    await ChatService.sendOffer('chat-1', 'sender', 'receiver', 25);
    const [, messageData] = mockAddDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(messageData.content).toBe('Offre de 25 $');
    expect((messageData.offer as Record<string, unknown>).totalAmount).toBe(25);
  });
});

describe('ChatService.acceptOffer — expiration (régression H9)', () => {
  it('passe une offre expirée en "expired" et lève, sans jamais l’accepter', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockGetDoc.mockReset();
    // 1er getDoc : le message d'offre (non-meetup, expiré).
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ offer: { amount: 20, status: 'pending', expiresAt: yesterday } }),
    });

    await expect(
      ChatService.acceptOffer('chat-1', 'msg-1', 'offer-1', 'receiver'),
    ).rejects.toThrow(/expiré/);

    // L'unique updateDoc doit être le passage en 'expired' (jamais 'accepted').
    const statuses = mockUpdateDoc.mock.calls.map(
      ([, payload]) => (payload as Record<string, unknown>)['offer.status'],
    );
    expect(statuses).toContain('expired');
    expect(statuses).not.toContain('accepted');
    expect(mockCallable).not.toHaveBeenCalled();
  });
});

describe('ChatService.completeMeetup — ordre callable→message (B2)', () => {
  /** getDocs renvoie une tx meetup_confirmed pour la 1re requête (en acheteur). */
  function txFound(id = 'tx-confirmed') {
    return { empty: false, docs: [{ id }], forEach: () => {}, size: 1 };
  }

  it('appelle la callable AVANT de marquer le message, et seulement après succès', async () => {
    mockGetDocs.mockResolvedValueOnce(txFound());

    const order: string[] = [];
    mockCallable.mockImplementationOnce((..._a: unknown[]) => {
      order.push('callable');
      return Promise.resolve({ data: { success: true, transactionId: 'tx-confirmed' } });
    });
    mockUpdateDoc.mockImplementationOnce((..._a: unknown[]) => {
      order.push('updateDoc');
      return Promise.resolve();
    });

    await ChatService.completeMeetup('chat-1', 'msg-1', 'sender');

    // La callable a bien été invoquée avec l'id de transaction résolu.
    expect(mockCallable).toHaveBeenCalledWith({ transactionId: 'tx-confirmed' });
    // L'ordre impose callable d'abord, écriture du message ensuite.
    expect(order).toEqual(['callable', 'updateDoc']);

    // Le message est marqué 'completed' une fois le backend confirmé.
    const completed = mockUpdateDoc.mock.calls.find(
      ([, payload]) => (payload as Record<string, unknown>)['offer.status'] === 'completed',
    );
    expect(completed).toBeDefined();
  });

  it('ne marque PAS le message si la callable échoue (tx annulée/disputée)', async () => {
    mockGetDocs.mockResolvedValueOnce(txFound());
    mockCallable.mockImplementationOnce(() =>
      Promise.reject(new Error('Cannot complete meetup from status cancelled')),
    );

    await expect(
      ChatService.completeMeetup('chat-1', 'msg-1', 'sender'),
    ).rejects.toThrow(/Cannot complete meetup from status cancelled/);

    // Aucun updateDoc ne doit avoir posé 'offer.status' = 'completed'.
    const completed = mockUpdateDoc.mock.calls.find(
      ([, payload]) => (payload as Record<string, unknown>)['offer.status'] === 'completed',
    );
    expect(completed).toBeUndefined();
  });

  it('lève une erreur claire et ne touche pas le message si aucune tx confirmée', async () => {
    // getDocs renvoie le défaut empty:true pour acheteur ET vendeur.
    await expect(
      ChatService.completeMeetup('chat-1', 'msg-1', 'sender'),
    ).rejects.toThrow(/Aucune transaction de rencontre à finaliser/);

    expect(mockCallable).not.toHaveBeenCalled();
    const completed = mockUpdateDoc.mock.calls.find(
      ([, payload]) => (payload as Record<string, unknown>)['offer.status'] === 'completed',
    );
    expect(completed).toBeUndefined();
  });
});

describe('ChatService.rejectOffer', () => {
  it('passe l’offre en "rejected"', async () => {
    mockGetDoc.mockReset();
    // 1er getDoc : updateDoc rejected ; 2e getDoc : relecture pour le message système.
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ offer: { amount: 15 }, participants: ['sender', 'receiver'] }),
    });

    await ChatService.rejectOffer('chat-1', 'msg-1', 'offer-1', 'receiver');

    const rejected = mockUpdateDoc.mock.calls.find(
      ([, payload]) => (payload as Record<string, unknown>)['offer.status'] === 'rejected',
    );
    expect(rejected).toBeDefined();
  });
});
