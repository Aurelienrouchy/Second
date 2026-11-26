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

const mockCallable = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ data: { ok: true, reportId: 'report-123', status: 'pending' } }),
);
jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn((..._args: unknown[]) => mockCallable),
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
  function callableName(): string {
    const { httpsCallable } = jest.requireMock('firebase/functions') as {
      httpsCallable: jest.Mock;
    };
    return httpsCallable.mock.calls[0][1] as string;
  }

  it('passe par la callable serveur et renvoie l’id du signalement', async () => {
    const id = await ModerationService.createReport(
      'me', 'Moi', 'message', 'msg-1', 'harassment', 'contenu abusif', 'owner-1',
    );

    expect(id).toBe('report-123');
    expect(callableName()).toBe('submitReport');
    // Aucune écriture cliente directe : c'est le rail serveur qui valide,
    // limite le débit et impose « un signalement par personne et par cible ».
    expect(mockAddDoc).not.toHaveBeenCalled();

    const payload = mockCallable.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toEqual({
      targetType: 'message',
      targetId: 'msg-1',
      reason: 'harassment',
      description: 'contenu abusif',
      targetOwnerId: 'owner-1',
    });
  });

  it('traduit le doublon en information, pas en erreur technique', async () => {
    mockCallable.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { code: 'functions/already-exists' }),
    );
    await expect(
      ModerationService.createReport('me', 'Moi', 'user', 'bob', 'harassment'),
    ).rejects.toThrow(/déjà signalé/);
  });
});

// ─── Non-régression : aucun `undefined` ne part vers Firestore ───────────────
//
// Le SDK Web rejette SYNCHRONEMENT toute valeur `undefined` tant que
// `ignoreUndefinedProperties` n'est pas activé — et `config/firebaseConfig.ts`
// ne l'active pas. Or `createReport` écrivait les clés `targetOwnerId` et
// `description` en dur : elles étaient donc PRÉSENTES avec la valeur
// `undefined` dès que l'appelant omettait ces paramètres optionnels.
//
// Ce n'est pas théorique : deux des trois points d'entrée n'ont aucun moyen de
// fournir `targetOwnerId` — `useChatModeration.ts` et `app/user/[id].tsx`
// appellent `open()` à trois arguments. Tout signalement d'utilisateur
// échouait donc, à tous les coups, sur une alerte « Erreur ».
describe('ModerationService.createReport — aucun undefined vers Firestore', () => {
  const collectUndefinedKeys = (payload: Record<string, unknown>): string[] =>
    Object.entries(payload)
      .filter(([, value]) => value === undefined)
      .map(([key]) => key);

  const lastPayload = (): Record<string, unknown> =>
    mockCallable.mock.calls[0][0] as Record<string, unknown>;

  it('signalement depuis le chat (ni description ni targetOwnerId) : payload sans undefined', async () => {
    await ModerationService.createReport('me', 'Moi', 'user', 'bob', 'harassment');

    const payload = lastPayload();
    expect(collectUndefinedKeys(payload)).toEqual([]);
    // La clé absente vaut mieux que la clé à undefined : la callable refuse la
    // seconde, exactement comme le SDK la refusait avant elle.
    expect('targetOwnerId' in payload).toBe(false);
    expect('description' in payload).toBe(false);
  });

  it('signalement d’utilisateur sans détails : targetOwnerId conservé, description omise', async () => {
    await ModerationService.createReport(
      'me',
      'Moi',
      'user',
      'reported-member',
      'harassment',
      undefined,
      'reported-member',
    );

    const payload = lastPayload();
    expect(collectUndefinedKeys(payload)).toEqual([]);
    expect(payload.targetOwnerId).toBe('reported-member');
    expect('description' in payload).toBe(false);
  });

  it('les deux champs optionnels renseignés sont bien transmis', async () => {
    await ModerationService.createReport(
      'me',
      'Moi',
      'user',
      'reported-member',
      'harassment',
      'messages insistants',
      'reported-member',
    );

    const payload = lastPayload();
    expect(collectUndefinedKeys(payload)).toEqual([]);
    expect(payload.description).toBe('messages insistants');
    expect(payload.targetOwnerId).toBe('reported-member');
  });

  it('refuse un signalement d’article sans aperçu avant tout appel serveur', async () => {
    await expect(ModerationService.createReport('me', 'Moi', 'article', 'art-1', 'counterfeit'))
      .rejects.toThrow('Examinez l’aperçu actuel de l’article');
    expect(mockCallable).not.toHaveBeenCalled();
  });
});

// ─── Non-régression : le déblocage doit être total ──────────────────────────
//
// `blockUser` pose `blockedAt: new Date().toISOString()` dans l'objet passé à
// `arrayUnion`. Deux blocages successifs de la MÊME personne produisent donc
// deux objets DIFFÉRENTS (horodatages distincts) : `arrayUnion` ne les
// déduplique pas et les empile. Aucun des deux points d'entrée ne vérifie
// l'état préalable (`useChatModeration.ts:35`, `app/user/[id].tsx:371`), le
// double blocage est donc atteignable depuis l'app.
//
// `unblockUser` ne retirait alors QUE la première entrée trouvée par `.find()`.
// Résultat : `blockedUserIds` (lu par les règles) ne contient plus l'UID — le
// message est ACCEPTÉ — mais `blockedUsers` en garde une, et le trigger
// serveur `sendMessageNotification`, qui lit les DEUX formes, SUPPRIME le
// message. La personne croit avoir débloqué ; tous les messages reçus sont
// détruits en silence, définitivement.
describe('ModerationService.unblockUser — déblocage total', () => {
  it('retire TOUTES les entrées de blockedUsers après un double blocage', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        blockedUsers: [
          { userId: 'bob', userName: 'Bob', blockedAt: '2026-01-01T00:00:00.000Z' },
          { userId: 'carole', userName: 'Carole', blockedAt: '2026-01-02T00:00:00.000Z' },
          { userId: 'bob', userName: 'Bob', blockedAt: '2026-03-04T00:00:00.000Z' },
        ],
        blockedUserIds: ['bob', 'carole'],
      }),
    });

    await ModerationService.unblockUser('me', 'bob');

    const [, payload] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.blockedUserIds).toEqual({ __arrayRemove: ['bob'] });

    const removed = payload.blockedUsers as { __arrayRemove: Array<{ userId: string }> };
    // Les DEUX entrées « bob » doivent partir, pas seulement la première.
    expect(removed.__arrayRemove).toHaveLength(2);
    expect(removed.__arrayRemove.every((u) => u.userId === 'bob')).toBe(true);
    // Carole n'est pas concernée.
    expect(removed.__arrayRemove.some((u) => u.userId === 'carole')).toBe(false);
  });

  it('document partiellement migré (aucune entrée objet) : l’UID plat est tout de même retiré', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ blockedUserIds: ['bob'] }),
    });

    await ModerationService.unblockUser('me', 'bob');

    const [, payload] = mockUpdateDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.blockedUserIds).toEqual({ __arrayRemove: ['bob'] });
    expect('blockedUsers' in payload).toBe(false);
  });
});

describe('ModerationService.getBlockedUsers — pas de doublon affiché', () => {
  it('un double blocage n’affiche la personne qu’une fois, à sa date initiale', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        blockedUsers: [
          { userId: 'bob', userName: 'Bob', blockedAt: '2026-03-04T00:00:00.000Z' },
          { userId: 'carole', userName: 'Carole', blockedAt: '2026-01-02T00:00:00.000Z' },
          { userId: 'bob', userName: 'Bob', blockedAt: '2026-01-01T00:00:00.000Z' },
        ],
      }),
    });

    const list = await ModerationService.getBlockedUsers('me');

    expect(list.map((u) => u.blockedUserId)).toEqual(['bob', 'carole']);
    expect(list[0].blockedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
