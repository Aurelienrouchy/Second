import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs = createFirestoreMock(); holder.fs = fs;
vi.mock('../config/firebase', () => ({ get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentUpdated: (_options: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/logger', () => ({ info: () => {}, warn: () => {}, error: () => {} }));
import { onArticleSold, onArticleSoftDeleted } from './articles';
type Event = { id: string; params: { articleId: string }; data: { before: { data: () => unknown }; after: { data: () => unknown } } };
const sold = onArticleSold as unknown as (event: Event) => Promise<void>;
const inactive = onArticleSoftDeleted as unknown as (event: Event) => Promise<void>;
const event = (reason: 'sold' | 'inactive'): Event => ({ id: `event-${reason}`, params: { articleId: 'article' }, data: {
  before: { data: () => ({ isSold: false, isActive: true }) }, after: { data: () => ({ isSold: reason === 'sold', isActive: reason !== 'inactive' }) },
} });
function message(id: string, status = 'pending') { fs.setDoc(`messages/${id}`, { type: 'offer', chatId: 'chat', offer: { status }, 'offer.status': status }); }
const status = (id: string) => (fs.getDoc(`messages/${id}`)?.offer as { status: string }).status;
const notices = () => fs.writeOps.filter((w) => w.path.startsWith('messages/article_status_') && w.method === 'set');
beforeEach(() => { fs.reset(); fs.setDoc('chats/chat', { articleId: 'article', participants: ['buyer', 'seller'] }); });
describe('article offer expiration rechecks live state', () => {
  it('a delayed sold event preserves proposals after explicit cancellation/relisting', async () => {
    fs.setDoc('articles/article', { isSold: false, isActive: true }); message('current');
    await sold(event('sold'));
    expect(status('current')).toBe('pending'); expect(notices()).toHaveLength(0);
  });
  it('a delayed soft-delete event preserves proposals and search index after reactivation', async () => {
    fs.setDoc('articles/article', { isSold: false, isActive: true }); message('current');
    fs.setDoc('search_index/article', { title: 'Current active article' });
    await inactive(event('inactive'));
    expect(status('current')).toBe('pending'); expect(fs.getDoc('search_index/article')).toBeDefined();
    expect(notices()).toHaveLength(0);
  });
  it.each(['sold', 'inactive'] as const)('an offer accepted since the %s query snapshot remains accepted', async (reason) => {
    fs.setDoc('articles/article', { isSold: reason === 'sold', isActive: reason !== 'inactive' });
    message('accepted', 'accepted');
    fs.setQuery('messages', [{ id: 'accepted', data: { type: 'offer', chatId: 'chat', offer: { status: 'pending' }, 'offer.status': 'pending' } }]);
    await (reason === 'sold' ? sold : inactive)(event(reason));
    expect(status('accepted')).toBe('accepted'); expect(notices()).toHaveLength(0);
  });
  it('expires current pending proposals and emits one notice per chat despite replay', async () => {
    fs.setDoc('articles/article', { isSold: true, isActive: true }); message('one'); message('two'); message('accepted', 'accepted');
    await sold(event('sold')); await sold(event('sold'));
    expect(status('one')).toBe('expired'); expect(status('two')).toBe('expired'); expect(status('accepted')).toBe('accepted');
    expect(notices()).toHaveLength(1);
  });
});


it('a delayed sold trigger preserves favorites after relisting', async () => {
  fs.setDoc('articles/article', { isSold: false, isActive: true });
  fs.setDoc('favorites/buyer', { articleIds: ['article', 'other'] });
  await sold(event('sold'));
  expect(fs.getDoc('favorites/buyer')?.articleIds).toEqual(['article', 'other']);
});
