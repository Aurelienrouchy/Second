import { describe, it, expect } from 'vitest';
import { queryKeys } from './queryKeys';

describe('queryKeys', () => {
  describe('articles', () => {
    it('all returns base key', () => {
      expect(queryKeys.articles.all).toEqual(['articles']);
    });

    it('detail includes article id', () => {
      expect(queryKeys.articles.detail('abc')).toEqual(['articles', 'abc']);
    });

    it('userList includes user id', () => {
      expect(queryKeys.articles.userList('u1')).toEqual(['articles', 'user', 'u1']);
    });
  });

  describe('notifications', () => {
    it('all returns base key', () => {
      expect(queryKeys.notifications.all).toEqual(['notifications']);
    });

    it('list includes user id', () => {
      expect(queryKeys.notifications.list('u1')).toEqual(['notifications', 'u1']);
    });
  });

  describe('orders', () => {
    it('all returns base key', () => {
      expect(queryKeys.orders.all).toEqual(['orders']);
    });

    it('list includes user id', () => {
      expect(queryKeys.orders.list('u1')).toEqual(['orders', 'u1']);
    });
  });

  describe('chat', () => {
    it('all returns base key', () => {
      expect(queryKeys.chat.all).toEqual(['chat']);
    });

    it('article includes article id', () => {
      expect(queryKeys.chat.article('a1')).toEqual(['chat', 'article', 'a1']);
    });

    it('transaction includes chat id', () => {
      expect(queryKeys.chat.transaction('c1')).toEqual(['chat', 'transaction', 'c1']);
    });
  });

  describe('shops', () => {
    it('detail includes shop id', () => {
      expect(queryKeys.shops.detail('s1')).toEqual(['shops', 's1']);
    });
  });

  describe('users', () => {
    it('profile includes user id', () => {
      expect(queryKeys.users.profile('u1')).toEqual(['users', 'u1']);
    });

    it('articles includes user id', () => {
      expect(queryKeys.users.articles('u1')).toEqual(['users', 'articles', 'u1']);
    });
  });

  describe('swaps', () => {
    it('userList includes user id', () => {
      expect(queryKeys.swaps.userList('u1')).toEqual(['swaps', 'u1']);
    });

    it('detail includes swap id', () => {
      expect(queryKeys.swaps.detail('sw1')).toEqual(['swaps', 'sw1']);
    });
  });

  describe('swapParties', () => {
    it('list returns fixed key', () => {
      expect(queryKeys.swapParties.list()).toEqual(['swap-parties', 'list']);
    });

    it('detail includes party id', () => {
      expect(queryKeys.swapParties.detail('p1')).toEqual(['swap-parties', 'p1']);
    });
  });

  describe('payments', () => {
    it('transaction includes payment id', () => {
      expect(queryKeys.payments.transaction('t1')).toEqual(['payments', 't1']);
    });
  });

  describe('sellers', () => {
    it('liked includes user id', () => {
      expect(queryKeys.sellers.liked('u1')).toEqual(['sellers', 'liked', 'u1']);
    });

  });

  describe('key uniqueness across domains', () => {
    it('all base keys are unique', () => {
      const baseKeys = [
        queryKeys.articles.all[0],
        queryKeys.notifications.all[0],
        queryKeys.orders.all[0],
        queryKeys.chat.all[0],
        queryKeys.shops.all[0],
        queryKeys.users.all[0],
        queryKeys.swaps.all[0],
        queryKeys.swapParties.all[0],
        queryKeys.payments.all[0],
        queryKeys.sellers.all[0],
      ];
      const unique = new Set(baseKeys);
      expect(unique.size).toBe(baseKeys.length);
    });
  });
});
