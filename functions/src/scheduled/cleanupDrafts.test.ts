import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ files: [] as Array<{ name: string; getMetadata: () => Promise<unknown[]>; delete: ReturnType<typeof vi.fn> }>, protected: new Set<string>(), failReferences: false }));
vi.mock('../config/firebase', () => ({ storage: { bucket: () => ({ getFiles: async () => [state.files] }) } }));
vi.mock('../utils/articleMedia', () => ({ publishedDraftPaths: async () => { if (state.failReferences) throw new Error('read failure'); return state.protected; } }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_: unknown, handler: unknown) => handler }));
import { cleanupExpiredDrafts } from './cleanupDrafts';
const run = cleanupExpiredDrafts as unknown as () => Promise<void>;
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
const file = (name: string, timeCreated: string) => ({ name, getMetadata: async () => [{ timeCreated }], delete: vi.fn() });
describe('draft cleanup lifecycle', () => {
  beforeEach(() => { state.files = []; state.protected = new Set(); state.failReferences = false; });
  it('deletes only abandoned files older than 14 days; preserves published refs and recent files', async () => {
    state.files = [file('drafts/alice/old/abandoned.jpg', daysAgo(15)), file('drafts/alice/old/published.jpg', daysAgo(90)), file('drafts/alice/new/photo.jpg', daysAgo(13))];
    state.protected.add(state.files[1].name);
    await run();
    expect(state.files.map((f) => f.delete.mock.calls.length)).toEqual([1, 0, 0]);
  });
  it('fails closed if published references cannot be read', async () => {
    state.files = [file('drafts/alice/old/photo.jpg', daysAgo(90))]; state.failReferences = true;
    await run();
    expect(state.files[0].delete).not.toHaveBeenCalled();
  });
  it('preserves files with invalid creation metadata', async () => {
    state.files = [file('drafts/alice/old/photo.jpg', 'invalid')];
    await run();
    expect(state.files[0].delete).not.toHaveBeenCalled();
  });
});
