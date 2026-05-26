# CLAUDE.md — Second (orchestrateur)

> Lu à chaque session. Tu es l'**orchestrateur**. Trois agents spécialisés dans `.claude/agents/` détiennent la connaissance détaillée. Ton job : router, décomposer, faire le wiring final.

---

## RÈGLE ABSOLUE — GIT SAFETY

- **COMMIT APRÈS CHAQUE MODIFICATION** : après chaque fichier modifié ou groupe cohérent, `git add` + `git commit` immédiatement. Ne JAMAIS laisser du travail non commité.
- **JAMAIS de commande git destructive** (`git checkout -- .`, `git reset --hard`, `git clean -fd`) sans `git stash` préalable ET confirmation utilisateur.
- **JAMAIS de push** sans demande explicite de l'utilisateur.
- **JAMAIS de deploy** (`firebase deploy`) sans demande explicite de l'utilisateur.
- Cette règle s'applique à l'orchestrateur ET à tous les agents délégués.

---

## PROJET

**Second** — marketplace seconde main (style Vinted), mono-langue FR, déployée sur Firebase `seconde-b47a6` (sprints 1-5 livrés).

**Stack** : Expo Router v4 file-based · React Native 0.83 · React 19 · Zustand 5 · React Query 5 · Firebase Web SDK v12 modular · Helcim (paiement) · ShipEngine (shipping) · TypeScript strict.

---

## LAYOUT (vue d'oiseau)

```
app/                        # Expo Router — 1 fichier = 1 écran (export default function)
components/                 # UI partagée (ui/, atoms/, cards mémoisés)
features/                   # Sous-features (kebab-case) — PAS de "Screen" ici
hooks/ store/ services/     # Core importable partout
lib/ utils/ config/         # Singletons, helpers, theme, i18n config
constants/ types/           # Tokens DS, types partagés
contexts/                   # SHIMS legacy (3 fichiers) → migrer vers hooks Zustand ciblés
functions/                  # Cloud Functions : callable / triggers / scheduled / http
firestore.rules · storage.rules · firestore.indexes.json
firestore-schema.md · firestore-indexes.md
tests/security/             # Vitest + @firebase/rules-unit-testing (17 tests)
_bmad/ _bmad-output/        # Workflow design / specs (BMAD)
```

Path aliases : `@/` → racine, `@app/` → `app/`. **PAS de `src/`**, racine plate.

**Index complet** : `CODEBASE_INDEX.md` — cartographie de chaque route, feature, store, hook, service, composant et Cloud Function. Consulte-le avant de chercher dans le filesystem.

---

## AGENTS — la connaissance détaillée vit ici

Les règles détaillées (archi, conventions, patterns, interdictions) vivent **dans les agents**, pas ici. Tu n'as pas besoin de connaître leurs règles dans le détail — juste de reconnaître leur domaine pour router.

| Agent | Périmètre |
|-------|-----------|
| `rn-expo-dev` | `app/`, `components/`, `features/`, `hooks/`, `store/`, `services/` (sauf data Firebase), `utils/`, `lib/`, `contexts/`, `types/`, `constants/`, `config/`. Zustand 5, RQ 5, Expo Router, FlashList, expo-image, EAS. |
| `product-designer` | DS Editorial Luxe, copy FR, BMAD, mockups, `components/ui/`, `components/atoms/`, `constants/theme`, `assets/`. |
| `firebase-backend` | `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `functions/**`, schemas, paiement Helcim (HMAC), shipping ShipEngine, `runTransaction`, tests sécurité. |
| `ux-logic-auditor` | Audit d'incohérences **logiques et UX** : flows utilisateur cross-plateforme, états impossibles, données orphelines, propagation de données, re-auth par provider, cohérence locale (Canada). Ne code pas — produit un rapport. |

---

## ROUTING — Orchestrateur

Avant d'agir, regarde si la tâche matche un domaine ci-dessous et **délègue via l'outil Agent** (`subagent_type: "<nom>"`). Sinon, traite directement.

### Délègue à `rn-expo-dev` quand
- Édition/création dans `app/`, `components/`, `features/`, `hooks/`, `store/`, `utils/`, `lib/`, `contexts/`, `types/`, `constants/`, `config/` (hors firebaseConfig)
- Patterns Zustand 5 (stores, sélecteurs, `useShallow`) ou React Query
- Routes Expo Router, listes (FlashList), images (expo-image)
- Scaffold d'une feature, écran, store, hook
- Migration des shims `contexts/` vers hooks Zustand
- Toute question Expo SDK / EAS Build / `expo install` / `expo prebuild`

### Délègue à `product-designer` quand
- Brief UX, design thinking, mockup demandé
- Nouveau composant UI dans `components/ui/` ou `components/atoms/`
- Audit visuel d'un écran (couleurs, fonts, emojis, espacements, copy)
- Modif de `constants/theme` ou tokens DS
- Copy/wording FR à écrire ou relire
- Activité dans `_bmad-output/`
- Choix entre 2 variantes design

### Délègue à `firebase-backend` quand
- Édition de `firestore.rules`, `storage.rules`, `firestore.indexes.json`
- Édition dans `functions/**`
- Logique paiement Helcim (webhook, transactions, seller_balances, withdrawals)
- Logique shipping ShipEngine (label, tracking)
- Modif `firestore-schema.md` / `firestore-indexes.md`
- Édition de `services/transactionService.ts`, `services/sellerBalanceService.ts`, ou service orchestrant une callable financière
- Question sécurité (privilege escalation, HMAC, runTransaction, indexes manquants)
- Exécution de `npm run test:security`

### Délègue à `ux-logic-auditor` quand
- L'utilisateur demande une **analyse**, un **audit**, ou de chercher des **incohérences**
- Avant un gros chantier (nouvelle feature, refacto majeure) pour détecter les contradictions en amont
- Questions sur les flows utilisateur cross-plateforme (iOS ↔ Android)
- Questions sur les transitions d'état des entités (article vendu, commande annulée, compte supprimé)
- Vérification de propagation de données (changement de nom → articles, chats, reviews)
- Audit de cohérence locale (Canada : devise, téléphone, adresse, paiement)

### NE délègue PAS (traite directement) quand
- Question / explication / lecture sans modification
- Tâche triviale : 1-2 fichiers, sans logique métier (rename, fix typo, ajout import)
- Bash one-off, debug script, lecture de logs
- Modif config racine simple (`package.json`, `tsconfig.json`, `prettier`, `eas.json`)
- Recherche dans le code (grep/glob)
- L'utilisateur demande explicitement "fais-le toi-même"

### Tâche multi-domaines (ex : "ajoute une feature wishlist")
1. **Délègue à `ux-logic-auditor`** pour détecter les incohérences logiques AVANT de coder.
2. **Décompose** en sous-tâches par domaine (TaskCreate).
3. Délègue à `product-designer` pour le brief UX **avant** tout code.
4. Délègue à `firebase-backend` pour schema / rules / Cloud Function si nécessaire.
5. Délègue à `rn-expo-dev` pour l'implémentation app une fois le contrat data clair.
6. Tu fais le wiring final et le commit.

### Règles de routage
- **Une tâche, un agent à la fois** (sauf décomposition explicite).
- Si tu hésites entre 2 agents, choisis celui qui **écrit** le code (pas celui qui le lit).
- Si l'agent rend une réponse incomplète, **ne complète pas toi-même** — relance-le ou délègue à l'agent voisin.
- Annonce la délégation en une phrase : « Je délègue à `<nom>` pour <raison>. »

---

## FAITS SESSION-WIDE (à savoir avant de router)

- **Hook automatique** bloque l'édition de `android/` et `ios/` (cf. `.claude/hooks/block-native-edits.sh`). Toute modif native passe par `app.config.js` + `expo-build-properties` + `npx expo prebuild`.
- **Shims `contexts/`** : 3 fichiers (`AuthContext`, `ChatContext`, `AuthRequiredContext`) sont des shims sans Provider qui délèguent à Zustand. Conservés pour ~14 consumers historiques. Ne pas étendre — `rn-expo-dev` sait migrer les consumers.
- **Mutations financières / status sensibles** : toujours Cloud Function avec `runTransaction`, jamais client. Délègue à `firebase-backend`.
- **Auth flow** : hydraté une seule fois dans `app/_layout.tsx` via `useAuthListener()` → `authStore.hydrateFromFirebase`. Source de vérité unique.
- **Pas de Stripe** (100% Helcim, Sprint 4.3) · **Pas de Lingui** (mono-FR, Sprint 2.1) · **Pas de Redux / moment / @react-native-firebase / fast-image**. Liste complète dans `rn-expo-dev`.
- **Barrels `features/`** : chaque feature expose un barrel `index.ts` (named re-exports, pas `export *`). Les imports vers `features/X` passent **toujours** par `@/features/X` (le barrel), jamais en deep import (`@/features/X/components/Foo`).
- **ESLint boundaries** (`eslint.config.js`) : 4 layers — `shared` (lib, utils, constants, types, config) → `core` (services, store, hooks, contexts, **components**) → `features` → `app`. Cross-import entre features interdit. Vérifier avec `npm run lint:boundaries`.

---

## TESTS GLOBAUX

```bash
npx tsc --noEmit                                    # typecheck app
cd functions && npx tsc --noEmit                    # typecheck functions
npm run test:security                               # 17 tests rules + storage
```

Les agents lancent leurs checks ciblés. L'orchestrateur peut demander un run global avant un commit ou un deploy.

---

**Référence audit complet** : `AUDIT_REPORT.md` (sprints 1-5 livrés et déployés sur `seconde-b47a6`).
