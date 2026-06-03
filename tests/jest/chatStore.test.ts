/**
 * chatStore — liste de conversations + compteur de non-lus dérivé.
 *
 * Comportement métier couvert :
 *  - `setChats` recompute `unreadCountByUser` en un seul passage (somme O(n)
 *    figée au write, pour que les lecteurs — badge tab bar, onglet messages —
 *    ne recalculent rien au render).
 *  - le sélecteur curried `selectUnreadChatCount(uid)` lit la valeur pré-calculée
 *    pour CET utilisateur (et 0 quand l'uid est null / absent).
 *  - `reset()` ramène à l'état initial (déconnexion / changement de compte).
 *
 * Vit dans tests/jest/ : Jest le ramasse (testMatch tests/jest/**), Vitest
 * l'ignore (exclude tests/jest/**) — pas de collision.
 */

import {
  selectChats,
  selectChatsLoading,
  selectUnreadChatCount,
  useChatStore,
} from '@/store/chatStore';
import type { Chat } from '@/types';

const ME = 'uid-me';
const OTHER = 'uid-other';

function makeChat(id: string, unreadCount: Record<string, number>): Chat {
  return {
    id,
    participants: [ME, OTHER],
    participantsInfo: [
      { userId: ME, userName: 'Moi' },
      { userId: OTHER, userName: 'Autre' },
    ],
    unreadCount,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  useChatStore.getState().reset();
});

describe('chatStore — setChats / unreadCountByUser', () => {
  it('agrège les non-lus par utilisateur en sommant tous les chats', () => {
    const chats = [
      makeChat('c1', { [ME]: 2, [OTHER]: 0 }),
      makeChat('c2', { [ME]: 3, [OTHER]: 5 }),
    ];
    useChatStore.getState().setChats(chats);

    const state = useChatStore.getState();
    expect(state.chats).toBe(chats);
    // 2 + 3 pour moi, 0 + 5 pour l'autre.
    expect(state.unreadCountByUser[ME]).toBe(5);
    expect(state.unreadCountByUser[OTHER]).toBe(5);
  });

  it('ignore les chats sans map unreadCount sans planter', () => {
    const broken = makeChat('c1', {});
    // Simule un doc Firestore partiel (champ unreadCount absent).
    delete (broken as { unreadCount?: unknown }).unreadCount;
    useChatStore.getState().setChats([broken, makeChat('c2', { [ME]: 4 })]);

    expect(useChatStore.getState().unreadCountByUser[ME]).toBe(4);
  });

  it('remet le compteur à vide quand la liste devient vide', () => {
    useChatStore.getState().setChats([makeChat('c1', { [ME]: 7 })]);
    expect(useChatStore.getState().unreadCountByUser[ME]).toBe(7);

    useChatStore.getState().setChats([]);
    expect(useChatStore.getState().unreadCountByUser).toEqual({});
  });
});

describe('chatStore — selectUnreadChatCount (curried)', () => {
  it('retourne le total non-lu pré-calculé pour un utilisateur donné', () => {
    useChatStore.getState().setChats([
      makeChat('c1', { [ME]: 2 }),
      makeChat('c2', { [ME]: 1 }),
    ]);
    const total = selectUnreadChatCount(ME)(useChatStore.getState());
    expect(total).toBe(3);
  });

  it('retourne 0 quand l’utilisateur n’a aucun non-lu', () => {
    useChatStore.getState().setChats([makeChat('c1', { [OTHER]: 9 })]);
    expect(selectUnreadChatCount(ME)(useChatStore.getState())).toBe(0);
  });

  it('retourne 0 pour un uid null (utilisateur déconnecté)', () => {
    useChatStore.getState().setChats([makeChat('c1', { [ME]: 4 })]);
    expect(selectUnreadChatCount(null)(useChatStore.getState())).toBe(0);
  });
});

describe('chatStore — sélecteurs de base & reset', () => {
  it('expose chats et l’état de chargement via sélecteurs', () => {
    const chats = [makeChat('c1', { [ME]: 1 })];
    useChatStore.getState().setChats(chats);
    useChatStore.getState().setLoading(false);

    expect(selectChats(useChatStore.getState())).toBe(chats);
    expect(selectChatsLoading(useChatStore.getState())).toBe(false);
  });

  it('reset() restaure l’état initial (loading=true, chats vide)', () => {
    useChatStore.getState().setChats([makeChat('c1', { [ME]: 3 })]);
    useChatStore.getState().setLoading(false);
    useChatStore.getState().setError('boom');

    useChatStore.getState().reset();

    const s = useChatStore.getState();
    expect(s.chats).toEqual([]);
    expect(s.isLoading).toBe(true);
    expect(s.error).toBeNull();
    expect(s.unreadCountByUser).toEqual({});
  });
});
