/**
 * `analyzeProductImage` — l'analyse IA d'une mise en vente, côté serveur.
 *
 * Chaque bloc correspond à une trouvaille de la chasse « mise en vente ».
 * Le modèle est bouchonné : on pilote sa réponse (texte, tableau, refus de
 * sécurité, panne) et on observe ce que la callable rend et ce qu'elle débite.
 */
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

type Reply = {
  text?: string;
  candidates?: { finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  reply: null as (() => Promise<Reply>) | null,
  calls: 0,
  providerRequests: [] as { model: string; contents: unknown; config?: unknown }[],
}));
const fs: MockFirestore = createFirestoreMock();
holder.fs = fs;

vi.mock('../config/firebase', () => ({
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
  auth: {
    getUser: async (uid: string) => ({
      uid,
      disabled: false,
      tokensValidAfterTime: new Date(0).toISOString(),
    }),
  },
}));
vi.mock('firebase-functions/v2/https', () => {
  class _HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    onCall: (opts: unknown, handler: object) => Object.assign(handler, { __options: opts }),
    HttpsError: _HttpsError,
  };
});
vi.mock('../services/ai', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/ai')>(),
  getGenAI: () => ({
    models: {
      generateContent: async (request: { model: string; contents: unknown; config?: unknown }) => {
        holder.calls++;
        holder.providerRequests.push(request);
        return holder.reply!();
      },
    },
  }),
  generateSingleStepAnalysisPrompt: () => 'PROMPT-MARKER-XYZ',
  validateAndNormalizeResponse: async (r: unknown) => r,
  retryWithBackoff: (fn: () => Promise<unknown>) => fn(),
  estimateTokens: () => 1,
}));
vi.mock('../services/brands', () => ({ loadBrands: async () => [] }));

import { analyzeProductImage } from './ai';
import { generateStyleProfile } from './style';

const call = analyzeProductImage as unknown as (r: {
  auth?: { uid: string; token?: { auth_time: number } } | null;
  data?: unknown;
}) => Promise<Record<string, unknown>>;

const UID = 'u1';
const QUOTA = `rate_limits/${UID}_analyzeProduct`;
const PHOTO = { base64: 'ZmFrZQ==', mimeType: 'image/jpeg' };

function used(): number {
  const q = fs.getDoc(QUOTA);
  return (q?.calls as number[] | undefined)?.length ?? (q?.count as number | undefined) ?? 0;
}

function analyze(images: unknown[] = [PHOTO]) {
  return call({ auth: { uid: UID, token: { auth_time: Math.floor(Date.now() / 1000) } }, data: { images } });
}

function answer(text: string) {
  holder.reply = async () => ({ text });
}

beforeEach(() => {
  fs.reset();
  holder.calls = 0;
  holder.providerRequests = [];
  answer('{"title":"Robe fleurie","genre":"femmes"}');
});

describe('analyzeProductImage — modèle disponible sur un nouveau projet', () => {
  it('envoie les deux photos au modèle Flash accessible en conservant la réponse JSON', async () => {
    await analyze([PHOTO, PHOTO]);
    expect(holder.providerRequests).toEqual([{
      model: 'gemini-3.8-flash',
      contents: [
        { text: 'PROMPT-MARKER-XYZ' },
        { inlineData: { mimeType: PHOTO.mimeType, data: PHOTO.base64 } },
        { inlineData: { mimeType: PHOTO.mimeType, data: PHOTO.base64 } },
      ],
      config: { responseMimeType: 'application/json' },
    }]);
    expect(used()).toBe(1);
  });
});

describe('generateStyleProfile — même modèle accessible', () => {
  it('conserve le profil produit par Flash après relecture du consentement', async () => {
    const runtime = generateStyleProfile as unknown as { __options: { secrets?: string[] } };
    expect(runtime.__options.secrets).toContain('GEMINI_API_KEY');
    fs.setDoc(`users/${UID}`, { preferences: { aiProfilingConsent: true } });
    const profile = {
      styleTags: ['casual'],
      styleDescription: 'Style décontracté.',
      recommendedBrands: [],
      suggestedSizes: { top: 'M', bottom: '38' },
      confidence: 0.8,
    };
    answer(JSON.stringify(profile));
    const styleCall = generateStyleProfile as unknown as typeof call;
    const result = await styleCall({
      auth: { uid: UID, token: { auth_time: Math.floor(Date.now() / 1000) } },
      data: { searches: ['jeans', 't-shirts', 'baskets', 'pulls', 'chemises'] },
    });
    expect(holder.providerRequests).toHaveLength(1);
    expect(holder.providerRequests[0].model).toBe('gemini-3.8-flash');
    expect(result).toEqual({ success: true, profile });
    expect(fs.getDoc(`users/${UID}`)?.styleProfile).toMatchObject(profile);
  });
});

describe('analyzeProductImage — lecture de la réponse (I05)', () => {
  it('lit une réponse en TABLEAU au lieu d’échouer en « Erreur serveur »', async () => {
    answer('[{"title":"Robe fleurie","genre":"femmes"},{"title":"Ceinture"}]');
    const result = await analyze();
    expect(result.title).toBe('Robe fleurie');
  });
});

describe('analyzeProductImage — quota (I02)', () => {
  it('une analyse réussie débite une unité', async () => {
    await analyze();
    expect(used()).toBe(1);
  });

  it('une panne du modèle ne débite pas le quota', async () => {
    holder.reply = async () => {
      throw Object.assign(new Error('boom'), { status: 500 });
    };
    await expect(analyze()).rejects.toBeDefined();
    expect(used()).toBe(0);
  });

  it('refuse toujours un compte dont la fenêtre est pleine, sans appeler le modèle', async () => {
    fs.setDoc(QUOTA, { userId: UID, count: 10, windowStartedAt: new Date() });
    await expect(analyze()).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(holder.calls).toBe(0);
  });
});

describe('analyzeProductImage — quota en heure glissante (I01)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ne rouvre pas dix analyses d’un coup à la fin d’une tranche horaire', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-09-12T10:00:00Z').getTime();
    vi.setSystemTime(t0);
    await analyze();
    vi.setSystemTime(t0 + 59 * 60_000);
    for (let i = 0; i < 9; i++) await analyze();
    vi.setSystemTime(t0 + 61 * 60_000);
    // Seule l'analyse de t0 est sortie de l'heure glissante : une place.
    await analyze();
    await expect(analyze()).rejects.toMatchObject({ code: 'resource-exhausted' });
  });
});

describe('analyzeProductImage — branche Enfants (CG01)', () => {
  it('transmet la branche filles ou garçons que le modèle a lue', async () => {
    answer('{"title":"T-shirt rayé","genre":"Garçons","category":"T-shirts"}');
    const result = await analyze();
    const meta = result._analysisMetadata as Record<string, unknown>;
    expect(meta.topLevelCategory).toBe('kids');
    expect(meta.kidsBranch).toBe('kids_boys');
  });
});

describe('analyzeProductImage — bornes sur les images (I03)', () => {
  it('refuse plus de cinq photos, avant tout appel et sans débit', async () => {
    await expect(analyze(Array(6).fill(PHOTO))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(holder.calls).toBe(0);
    expect(fs.getDoc(QUOTA)).toBeUndefined();
  });

  it('refuse un fichier qui n’est pas une image', async () => {
    await expect(analyze([{ base64: 'ZmFrZQ==', mimeType: 'video/mp4' }])).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(holder.calls).toBe(0);
  });

  it('refuse une photo sans contenu', async () => {
    await expect(analyze([{ mimeType: 'image/jpeg' }])).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });
});

describe('analyzeProductImage — refus du filtre de sécurité (I06)', () => {
  it('dit que la photo a été refusée par la modération, au lieu d’une erreur opaque', async () => {
    holder.reply = async () => ({ text: '', candidates: [{ finishReason: 'SAFETY' }] });
    await expect(analyze()).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringContaining('modération'),
    });
  });
});

describe('analyzeProductImage — messages lus par l’utilisateur (I09)', () => {
  it('une surcharge du modèle se dit en français', async () => {
    holder.reply = async () => {
      throw Object.assign(new Error('The model is overloaded'), { status: 503 });
    };
    await expect(analyze()).rejects.toMatchObject({
      code: 'unavailable',
      message: expect.stringMatching(/Réessayez/),
    });
  });

  it('une erreur interne ne renvoie pas le message brut du fournisseur', async () => {
    holder.reply = async () => {
      throw new Error('INTERNAL: upstream 0xDEADBEEF');
    };
    await expect(analyze()).rejects.toMatchObject({
      code: 'internal',
      message: expect.not.stringContaining('DEADBEEF'),
    });
  });
});

describe('analyzeProductImage — journaux (I04)', () => {
  it('ne recopie pas le prompt complet dans les journaux à chaque analyse', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await analyze();
      const logged = spy.mock.calls.flat().map(String).join('\n');
      expect(logged).not.toContain('PROMPT-MARKER-XYZ');
    } finally {
      spy.mockRestore();
    }
  });
});
