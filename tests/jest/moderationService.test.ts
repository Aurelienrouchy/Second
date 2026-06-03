/**
 * ModerationService — blocage / déblocage / signalement.
 *
 * Comportement métier couvert (sécurité messagerie) :
 *  - blockUser maintient DEUX champs en parallèle : `blockedUsers` (objets, UI)
 *    ET `blockedUserIds` (UIDs plats, source de vérité lue par les Firestore
 *    rules `isNotBlockedBy`). Le second est indispensable : sans lui le blocage
 *    n'est appliqué qu'a posteriori par le trigger serveur.
 *  - unblockUser retire l'UID de la liste plate même si l'entrée objet est
 *    introuvable (doc partiellement migré), pour que la règle cesse de bloquer.
 *  - isUserBlocked lit d'abord la liste plate (parité exacte avec le serveur),
 *    puis retombe sur le tableau d'objets pour les docs legacy.
 *  - createReport persiste un signalement 'pending' et renvoie l'id du doc.
 *
 * Place dans tests/jest/ (Jest), .test.ts ignoré par Vitest.
 */

// On observe finement les écritures Firestore (le mock global de jest.setup
// renvoie des jest.fn() nus ; ici on contrôle les valeurs de retour).
const mockGetDoc = jest.fn();
const mockUpdateDoc = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockAddDoc = jest.fn((..._args: unknown[]) => Promise.resolve({ id: 'report-123' }));
const mockGetDocs = jest.fn((..._args: unknown[]) => Promise.resolve({ empty: true }));

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((_db: unknown, name: string) => ({ name })),
  doc: jest.fn((_db: unknown, col: string, id: string) => ({ col, id })),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  query: jest.fn((...args: unknown[]) => ({ args })),
  where: jest.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  serverTimestamp: jest.fn((..._args: unknown[]) => 'SERVER_TS'),
  arrayUnion: jest.fn((...vals: unknown[]) => ({ __arrayUnion: vals })),
  arrayRemove: jest.fn((...vals: unknown[]) => ({ __arrayRemove: vals })),
}));

import { auth } from '@/config/firebaseConfig';
import { ModerationService } from '@/services/moderationService';

const mockAuth = auth as unknown as { currentUser: { uid: string } | null };

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = { uid: 'me' };
});

describe('ModerationService.blockUser', () => {
  it('alimente blockedUsers (objet) ET blockedUserIds (UID plat lu par les rules)', async () => {
    await ModerationService.blockUser('me', 'target', 'Target Name');

    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [, payload] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>];

    // Liste plate des UIDs — c'est CE champ que la règle isNotBlockedBy lit.
    expect(payload.blockedUserIds).toEqual({ __arrayUnion: ['target'] });

    // Tableau d'objets pour l'UI.
    const objectArg = payload.blockedUsers as { __arrayUnion: Array<Record<string, unknown>> };
    expect(objectArg.__arrayUnion[0]).toMatchObject({
      userId: 'target',
      userName: 'Target Name',
    });
    expect(typeof objectArg.__arrayUnion[0].blockedAt).toBe('string');
  });
});

describe('ModerationService.unblockUser', () => {
  it('retire l’entrée objet ET l’UID plat quand l’entrée objet existe', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        blockedUsers: [{ userId: 'target', userName: 'Target', blockedAt: '2026-01-01' }],
        blockedUserIds: ['target'],
      }),
    });

    await ModerationService.unblockUser('me', 'target');

    const [, payload] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.blockedUserIds).toEqual({ __arrayRemove: ['target'] });
    expect(payload.blockedUsers).toEqual({
      __arrayRemove: [{ userId: 'target', userName: 'Target', blockedAt: '2026-01-01' }],
    });
  });

  it('retire quand même l’UID plat si l’entrée objet est introuvable (doc partiel)', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      // blockedUsers absent / vide → on doit tout de même nettoyer la liste plate.
      data: () => ({ blockedUserIds: ['target'] }),
    });

    await ModerationService.unblockUser('me', 'target');

    const [, payload] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.blockedUserIds).toEqual({ __arrayRemove: ['target'] });
    expect(payload.blockedUsers).toBeUndefined();
  });

  it('ne fait rien si le document utilisateur n’existe pas', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });
    await ModerationService.unblockUser('me', 'target');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

describe('ModerationService.isUserBlocked', () => {
  it('détecte le blocage via la liste plate (priorité, parité serveur)', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ blockedUserIds: ['target'], blockedUsers: [] }),
    });
    expect(await ModerationService.isUserBlocked('me', 'target')).toBe(true);
  });

  it('retombe sur le tableau d’objets pour un doc legacy sans liste plate', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ blockedUsers: [{ userId: 'target' }] }),
    });
    expect(await ModerationService.isUserBlocked('me', 'target')).toBe(true);
  });

  it('retourne false quand la cible n’est dans aucune des deux listes', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ blockedUserIds: ['someone-else'], blockedUsers: [] }),
    });
    expect(await ModerationService.isUserBlocked('me', 'target')).toBe(false);
  });
});

describe('ModerationService.areUsersBlocked', () => {
  it('vérifie le doc de l’utilisateur courant contre l’AUTRE participant', async () => {
    mockAuth.currentUser = { uid: 'me' };
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ blockedUserIds: ['other'] }),
    });
    // me ↔ other : l'autre est "other", on lit notre propre doc.
    expect(await ModerationService.areUsersBlocked('me', 'other')).toBe(true);
  });

  it('retourne false si aucun utilisateur Firebase courant', async () => {
    mockAuth.currentUser = null;
    expect(await ModerationService.areUsersBlocked('me', 'other')).toBe(false);
    expect(mockGetDoc).not.toHaveBeenCalled();
  });
});

describe('ModerationService.createReport', () => {
  it('persiste un signalement pending et renvoie l’id du document', async () => {
    const id = await ModerationService.createReport(
      'me',
      'Moi',
      'message',
      'msg-1',
      'harassment',
      'contenu abusif',
      'owner-1',
    );

    expect(id).toBe('report-123');
    const [, payload] = mockAddDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload).toMatchObject({
      reporterId: 'me',
      targetType: 'message',
      targetId: 'msg-1',
      reason: 'harassment',
      status: 'pending',
      createdAt: 'SERVER_TS',
    });
  });
});
