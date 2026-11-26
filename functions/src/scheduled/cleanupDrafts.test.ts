/**
 * Le balayage quotidien des images de brouillon (`cleanupExpiredDrafts`).
 *
 * Le parcours de vente par défaut téléverse les photos sous
 * `drafts/{uid}/{draftId}/` pendant l'analyse IA, et la publication réutilise
 * ces URL telles quelles : les photos d'un article publié VIVENT sous
 * `drafts/`. L'âge et l'absence de référence ne qualifient pas une autorité
 * de suppression : le job conserve les fichiers sans IO Storage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

type FakeFile = {
  name: string;
  metadata: { timeCreated?: string };
  getMetadata: () => Promise<[{ timeCreated?: string; generation?: string }]>;
  delete: () => Promise<void>;
};

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  files: [] as FakeFile[],
  deleted: [] as string[],
  metadataCalls: 0,
  articlesUnreadable: false,
  scheduleOpts: null as Record<string, unknown> | null,
}));

const fs: MockFirestore = createFirestoreMock();
holder.fs = fs;

vi.mock('../config/firebase', () => {
  const failing = {
    collection: () => {
      const q = {
        select: () => q,
        get: async () => {
          throw new Error('Firestore indisponible');
        },
      };
      return q;
    },
  };
  return {
    get db() {
      return holder.articlesUnreadable ? failing : holder.fs!.db;
    },
    storage: {
      bucket: () => ({ getFiles: async () => [holder.files] }),
    },
  };
});

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (opts: Record<string, unknown>, handler: unknown) => {
    holder.scheduleOpts = opts;
    return handler;
  },
}));

vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}));

import { cleanupExpiredDrafts } from './cleanupDrafts';

const run = cleanupExpiredDrafts as unknown as () => Promise<void>;

const DAY = 24 * 60 * 60 * 1000;

function file(name: string, ageDays: number): FakeFile {
  const timeCreated = new Date(Date.now() - ageDays * DAY).toISOString();
  return {
    name,
    metadata: { timeCreated },
    getMetadata: async () => {
      holder.metadataCalls++;
      return [{ timeCreated, generation: '100' }];
    },
    delete: async () => {
      holder.deleted.push(name);
    },
  };
}

/** L'URL exacte que produit `aiService.uploadImageToStorage` (chemin encodé). */
function downloadUrl(path: string): string {
  return (
    'https://firebasestorage.googleapis.com/v0/b/seconde-b47a6.firebasestorage.app/o/' +
    `${encodeURIComponent(path)}?alt=media&token=tok`
  );
}

const PUBLISHED = 'drafts/uid1/draftA/draftA_0_1757000000000.jpg';
const ABANDONED = 'drafts/uid2/draftB/draftB_0_1757000000000.jpg';

beforeEach(() => {
  fs.reset();
  holder.files = [];
  holder.deleted = [];
  holder.metadataCalls = 0;
  holder.articlesUnreadable = false;
});

describe('cleanupExpiredDrafts', () => {
  it("n'efface pas les photos d'un article publié, même vieilles de plus de 14 jours", async () => {
    fs.setDoc('articles/art1', {
      isActive: true,
      isSold: false,
      images: [{ url: downloadUrl(PUBLISHED) }],
    });
    holder.files = [file(PUBLISHED, 20)];

    await run();

    expect(holder.deleted).not.toContain(PUBLISHED);
  });

  it('protège aussi les photos d’un article désactivé ou vendu, encore affichées dans les conversations', async () => {
    fs.setDoc('articles/art1', {
      isActive: false,
      isSold: true,
      images: [{ url: downloadUrl(PUBLISHED) }],
    });
    holder.files = [file(PUBLISHED, 20)];

    await run();

    expect(holder.deleted).not.toContain(PUBLISHED);
  });

  it("conserve aussi les images d'un brouillon abandonné sans autorité de suppression qualifiée", async () => {
    fs.setDoc('articles/art1', { images: [{ url: downloadUrl(PUBLISHED) }] });
    holder.files = [file(PUBLISHED, 20), file(ABANDONED, 20)];

    await run();

    expect(holder.deleted).toEqual([]);
  });

  it('garde les images récentes, référencées ou non', async () => {
    holder.files = [file(ABANDONED, 3)];

    await run();

    expect(holder.deleted).toEqual([]);
  });

  it("échoue fermé : si les articles sont illisibles, rien n'est effacé", async () => {
    holder.articlesUnreadable = true;
    holder.files = [file(PUBLISHED, 20), file(ABANDONED, 20)];

    await run();

    expect(holder.deleted).toEqual([]);
  });

  it('ne lit aucune métadonnée Storage tant que la suppression reste non autorisée', async () => {
    holder.files = [file(ABANDONED, 20), file(PUBLISHED, 3)];

    await run();

    expect(holder.metadataCalls).toBe(0);
  });

  it('se donne le temps de finir un balayage long', () => {
    expect(Number(holder.scheduleOpts?.timeoutSeconds ?? 60)).toBeGreaterThanOrEqual(300);
  });
});
