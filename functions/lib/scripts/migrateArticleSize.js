"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  RUN MANUEL APRÈS REVIEW — NE PAS auto-exécuter, NE PAS déployer.        │
 * │  Ce fichier N'EST PAS un Cloud Function et N'EST PAS exporté depuis      │
 * │  functions/src/index.ts. Il ne crée donc aucun orphelin en prod.        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Migration `articles.size` (et miroir `search_index.size`) : string -> objet
 * ArticleSize { value, system } (findings L1/L2 + contrat de types).
 *
 * Règles :
 *  - size string non vide  -> { value: <string>, system: 'EU' }  (défaut EU)
 *  - size null/vide/absent -> laissé null (aucune écriture)
 *  - size déjà objet       -> skip (idempotent)
 *
 * Le système par défaut est 'EU' : la marketplace est canadienne mais le stock
 * historique a été saisi en tailles européennes. Ajuster ce défaut ici si la
 * convention diffère, AVANT d'exécuter.
 *
 * USAGE (depuis ./functions, identifiants admin requis) :
 *
 *   1. npm run build
 *   2. DRY-RUN :   node lib/scripts/migrateArticleSize.js --dry-run
 *   3. Relire les compteurs, PUIS pour de vrai :
 *                  node lib/scripts/migrateArticleSize.js
 *
 * Idempotent : ré-exécutable (skip les size déjà objet).
 */
const admin = __importStar(require("firebase-admin"));
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
const DRY_RUN = process.argv.includes('--dry-run');
const DEFAULT_SYSTEM = 'EU';
const BATCH_SIZE = 400;
/**
 * Convert a legacy size value into an ArticleSize object, or null if it should
 * be left untouched / cleared.
 * Returns `undefined` when no write is needed (already an object, or empty).
 */
function toArticleSize(raw) {
    // Already migrated -> no write
    if (raw && typeof raw === 'object' && 'value' in raw) {
        return undefined;
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed.length === 0)
            return undefined; // empty string -> leave as-is
        return { value: trimmed, system: DEFAULT_SYSTEM };
    }
    // null / undefined / number -> leave null, no write
    return undefined;
}
async function migrateCollection(collectionName) {
    var _a;
    const snap = await db.collection(collectionName).get();
    console.log(`[migrateArticleSize] ${collectionName}: ${snap.size} docs`);
    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    let batch = db.batch();
    let pending = 0;
    for (const docSnap of snap.docs) {
        scanned++;
        const newSize = toArticleSize((_a = docSnap.data()) === null || _a === void 0 ? void 0 : _a.size);
        if (newSize === undefined) {
            skipped++;
            continue;
        }
        if (DRY_RUN) {
            updated++;
            continue;
        }
        batch.update(docSnap.ref, { size: newSize });
        pending++;
        updated++;
        if (pending >= BATCH_SIZE) {
            await batch.commit();
            batch = db.batch();
            pending = 0;
        }
    }
    if (!DRY_RUN && pending > 0) {
        await batch.commit();
    }
    console.log(`[migrateArticleSize] ${collectionName}: scanned=${scanned} updated=${updated} skipped=${skipped}`);
}
async function run() {
    console.log(`[migrateArticleSize] start (dryRun=${DRY_RUN}, defaultSystem=${DEFAULT_SYSTEM})`);
    await migrateCollection('articles');
    await migrateCollection('search_index');
    console.log('[migrateArticleSize] done');
}
run()
    .then(() => process.exit(0))
    .catch((err) => {
    console.error('[migrateArticleSize] FAILED', err);
    process.exit(1);
});
//# sourceMappingURL=migrateArticleSize.js.map