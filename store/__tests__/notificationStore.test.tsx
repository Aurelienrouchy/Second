/**
 * notificationStore — compteur de notifications non lues + état du setup push.
 *
 * Comportement MÉTIER couvert :
 *  - le badge in-app (unreadCount) reflète exactement ce que les actions posent ;
 *  - l'incrément optimiste (arrivée d'une notif en foreground) ajoute +1 ;
 *  - clearUnreadCount remet le badge à zéro (lecture en masse) ;
 *  - le token FCM et le flag isSetupComplete sont indépendants du compteur ;
 *  - reset() (déconnexion) ramène TOUT l'état au snapshot initial — y compris le
 *    token, sinon un device déconnecté garderait un token actif (fuite de push).
 *  - selectUnreadCount lit bien le champ exposé au badge.
 *
 * Test en .tsx pour rester dans le périmètre Jest (les *.test.ts sont à Vitest).
 * Le store est un singleton de module → reset() entre chaque test pour l'isoler.
 */

import { act } from '@testing-library/react-native';

import {
  useNotificationStore,
  selectUnreadCount,
} from '@/store/notificationStore';

const get = () => useNotificationStore.getState();

beforeEach(() => {
  act(() => {
    get().reset();
  });
});

describe('notificationStore — compteur non lus (badge)', () => {
  it('démarre à 0 non lus, setup non terminé, sans token', () => {
    expect(get().unreadCount).toBe(0);
    expect(get().isSetupComplete).toBe(false);
    expect(get().pushToken).toBeNull();
  });

  it('setUnreadCount pose la valeur serveur exacte (source de vérité)', () => {
    act(() => get().setUnreadCount(7));
    expect(get().unreadCount).toBe(7);

    // Réconciliation descendante : le serveur peut renvoyer moins (lu ailleurs).
    act(() => get().setUnreadCount(2));
    expect(get().unreadCount).toBe(2);
  });

  it('incrementUnreadCount ajoute +1 (feedback optimiste à la réception)', () => {
    act(() => get().incrementUnreadCount());
    act(() => get().incrementUnreadCount());
    expect(get().unreadCount).toBe(2);
  });

  it('incrémente à partir du compteur serveur courant, pas de 0', () => {
    act(() => get().setUnreadCount(5));
    act(() => get().incrementUnreadCount());
    expect(get().unreadCount).toBe(6);
  });

  it('clearUnreadCount remet le badge à zéro (tout marquer comme lu)', () => {
    act(() => get().setUnreadCount(9));
    act(() => get().clearUnreadCount());
    expect(get().unreadCount).toBe(0);
  });
});

describe('notificationStore — token FCM & flag de setup', () => {
  it('setPushToken stocke le token du device', () => {
    act(() => get().setPushToken('fcm-abc:APA91b'));
    expect(get().pushToken).toBe('fcm-abc:APA91b');
  });

  it('setPushToken(null) efface le token (désenregistrement)', () => {
    act(() => get().setPushToken('fcm-abc:APA91b'));
    act(() => get().setPushToken(null));
    expect(get().pushToken).toBeNull();
  });

  it('setSetupComplete marque le setup terminé sans toucher au compteur', () => {
    act(() => get().setUnreadCount(3));
    act(() => get().setSetupComplete(true));
    expect(get().isSetupComplete).toBe(true);
    expect(get().unreadCount).toBe(3);
  });
});

describe('notificationStore — reset (déconnexion)', () => {
  it('reset() ramène compteur, token ET flag setup à l’état initial', () => {
    act(() => {
      get().setUnreadCount(12);
      get().setPushToken('fcm-old:APA91b');
      get().setSetupComplete(true);
    });

    act(() => get().reset());

    // Un device déconnecté ne doit garder NI badge NI token (fuite de push).
    expect(get().unreadCount).toBe(0);
    expect(get().pushToken).toBeNull();
    expect(get().isSetupComplete).toBe(false);
  });
});

describe('notificationStore — sélecteur de badge', () => {
  it('selectUnreadCount renvoie le champ unreadCount exposé au badge', () => {
    act(() => get().setUnreadCount(4));
    expect(selectUnreadCount(get())).toBe(4);
  });
});
