# AGENTS.md — Second (orchestrateur)

> Lu à chaque session. Tu es l'**orchestrateur**. Des agents spécialisés dans `.Codex/agents/` détiennent la connaissance détaillée. Ton job : router, décomposer, faire le wiring final.

---

## RÈGLE ABSOLUE — GIT SAFETY

- Un hook `PostToolUse` (`auto-commit.sh`) commite automatiquement après chaque Edit/Write. Ne pas le désactiver.
- **JAMAIS de commande git destructive** (`git checkout -- .`, `git reset --hard`, `git clean -fd`) sans `git stash` préalable ET confirmation utilisateur.
- **JAMAIS de push** sans demande explicite de l'utilisateur.
- **Seconde Dev : déploiements autorisés sans nouvelle confirmation.** Autorisation permanente donnée par Aurélien le 29 octobre 2026 pour déployer les correctifs et fonctionnalités nécessaires au travail demandé sur `seconde-dev` (`--project dev` ou `--project seconde-dev`). Annoncer la portée et vérifier la cible avant chaque déploiement ; conserver les contrôles, les secrets et l’isolation des données.
- **Production : JAMAIS de deploy** (`firebase deploy --project prod` / `seconde-b47a6`) sans demande explicite de l'utilisateur pour la production.
- **JAMAIS `firebase deploy --force`** sur les functions : la prod contient des orphelins absents du local.

---

## PROJET

**Second** — marketplace de mode seconde main au Canada (style Vinted), mono-langue FR, déployée sur Firebase `seconde-b47a6`.

**Environnements** : local/development/preview → `seconde-dev` (Seconde Dev), production → `seconde-b47a6`. `npm start` force dev ; `npm run start:emulators` force `demo-second`. Aucun repli dev vers prod. `.firebaserc` utilise dev par défaut ; toute commande cloud doit préciser `--project dev` ou `--project prod`. Les configurations publiques sont dans `config/firebaseProjects.json`. Les variables serveur sont séparées en `functions/.env.seconde-dev` et `.env.seconde-b47a6`, jamais dans un `.env` partagé. Aucun compte, secret ou contenu de production à copier en dev. Variante native dev : `com.seconde.app.dev`, scheme `seconde-dev` ; EAS génère les natifs via `.easignore` et `app.config.js`.

**Stack** : Expo Router v4 file-based · React Native 0.83 · React 19 · Zustand 5 · React Query 5 · Firebase Web SDK v12 modular · Stripe Connect **Custom** (white-label) · ShipEngine · TypeScript strict.

**⚠️ État produit réel** : sur **Seconde Dev uniquement**, les paiements Stripe **TEST** et la livraison **simulée** sont activés explicitement côté app et serveur. `npm start` et les builds EAS development/preview exposent ce parcours ; les boutons de commande Dev permettent de simuler le transport et la fin du délai de retenue. Les étiquettes Dev ne sont pas expédiables. En production, les paiements et la livraison restent fermés par défaut. Les contrôles sont dans `config/featureFlags.ts`, `functions/src/config/featureFlags.ts` et `functions/src/config/runtimeEnvironment.ts`.

---

## LAYOUT (vue d'oiseau)

Architecture **feature-first** (tranches verticales). Racine plate, **pas de `src/`**. Alias `@/` → racine, `@app/` → `app/`.

```
app/                     Routes Expo Router uniquement — 1 fichier = 1 écran
features/<nom>/          20 features, chacune : components/ hooks/ services/ types.ts index.ts
components/              UI réellement transverse seulement + components/ui/ (design system)
hooks/ store/ services/  Couche core partagée entre features
lib/ utils/ config/      Singletons, helpers, theme, flags
constants/ types/        Tokens DS · types éclatés par domaine (types/index.ts = barrel)
functions/               Cloud Functions : callable/ http/ triggers/ scheduled/ utils/ config/
firestore.rules · storage.rules · firestore.indexes.json
docs/metier/             18 documents métier — la référence produit
tests/security/          Vitest + @firebase/rules-unit-testing
```

**Les 20 features** : `account` `admin` `article` `auth` `chat` `checkout-shipping` `favorites` `home` `legal` `notifications` `offers` `onboarding` `orders` `profile` `reviews` `search` `sell` `shop` `swap` `wallet`

**Index complet** : `CODEBASE_INDEX.md`. Consulte-le avant de chercher dans le filesystem.

### Règles de structure

- **Un fichier descend dans `features/X` seulement si TOUS ses importeurs réels sont dans `app/` ou `features/X`.** Consommé par la couche core ou par 2+ features → il reste en core. C'est cette règle qui garantit zéro violation de boundaries.
- **Les barrels `features/X/index.ts` n'exposent que composants et types.** Hooks et services s'importent par leur chemin. Un barrel qui ré-exporte un hook tirant `authStore` fait démarrer toute la pile d'auth à l'import d'un composant présentationnel — Metro ne tree-shake pas les barrels.
- **Jamais d'import entre features.** Vérifier avec `npm run lint:boundaries`.
- **Jamais un fichier d'une feature n'importe son propre barrel** (cycle invisible pour `tsc`, `undefined` au runtime).
- **Façades** — trois fichiers sont des façades qui préservent une API publique ; modifier le module derrière, pas la façade :
  - `services/chatService.ts` → `services/chat/{primitives,conversation,messages,offers,meetup,shipping,listeners}.ts`
  - `functions/src/callable/payments.ts` → `payments/{feeReduction,address,shipping,checkout,connectAccount,meetup,disputes}.ts`
  - `functions/src/http/webhooks.ts` (garde le dispatcher) → `http/stripe/{payment,swapTopUp,shopTier,disputes,payouts,refunds,account,redrive}.ts`

---

## AGENTS — la connaissance détaillée vit ici

| Agent | Périmètre |
|-------|-----------|
| `rn-expo-dev` | `app/`, `features/`, `components/`, `hooks/`, `store/`, `services/` (hors data Firebase), `utils/`, `lib/`, `types/`, `constants/`, `config/`. Zustand 5, RQ 5, Expo Router, FlashList, expo-image, EAS. |
| `product-designer` | DS Editorial Luxe, copy FR, BMAD, mockups, `components/ui/`, `constants/theme`, `assets/`. |
| `firebase-backend` | `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `functions/**`, schemas, paiement Stripe, shipping ShipEngine, `runTransaction`, tests sécurité. |
| `ux-logic-auditor` | Audit d'incohérences logiques et UX. Ne code pas — produit un rapport. |
| `rn-verifier` | Implémente PUIS vérifie sur simulateur réel via Argent + Maestro. Pour les régressions visuelles/interactives. |
| `business-plan-writer` | Business plan IRCC / incubateurs canadiens / C11. |
| `market-validator` | Marché canadien seconde main : concurrents, TAM/SAM/SOM, SWOT. |

### Routage

- Édition dans `app/`, `features/`, `components/`, `hooks/`, `store/`, `utils/`, `lib/`, `types/` → `rn-expo-dev`
- Brief UX, mockup, composant `components/ui/`, copy FR, tokens DS → `product-designer`
- `firestore.rules`, `functions/**`, paiement, shipping, sécurité, `npm run test:security` → `firebase-backend`
- Demande d'**analyse**, d'**audit**, de recherche d'**incohérences**, ou avant un gros chantier → `ux-logic-auditor`
- Changement UI dont il faut confirmer le comportement RÉEL sur device → `rn-verifier`

**Ne délègue PAS** : question/lecture sans modification · tâche triviale (1-2 fichiers, pas de logique) · bash one-off, logs · config racine simple · recherche dans le code · « fais-le toi-même ».

**Tâche multi-domaines** : `ux-logic-auditor` d'abord (détecter les contradictions AVANT de coder) → décomposer → `product-designer` pour le brief → `firebase-backend` pour le contrat data → `rn-expo-dev` pour l'implémentation → tu fais le wiring et le commit.

**Règles** : une tâche, un agent à la fois. Si tu hésites entre 2 agents, choisis celui qui **écrit** le code. Si un agent rend une réponse incomplète, **ne complète pas toi-même** — relance-le. Annonce la délégation en une phrase.

⚠️ **Les agents se trompent.** Sur ce dépôt, des rapports d'agents ont affirmé qu'un fichier était mort alors qu'il était importé, que deux composants homonymes étaient des doublons alors que leurs contrats différaient, et qu'un type était mort alors qu'il était utilisé. **Vérifie toi-même toute affirmation avant d'agir dessus**, en particulier avant une suppression.

---

## FAITS SESSION-WIDE

### Paiement (vérifié dans le code, pas dans la doc)

- **Stripe Connect Custom, white-label assumé** : le vendeur ne voit JAMAIS le dashboard Stripe. Onboarding, pièce d'identité et compte bancaire passent par l'app (`createStripeConnectAccount`, `uploadStripeIdentityDocument`, `addBankAccount`). La plateforme porte KYC, conformité et litiges. **Ne pas migrer en Standard.**
- **Les PaymentIntent sont des CHARGES PLATEFORME DIRECTES** — aucun `application_fee_amount`, aucun `transfer_data`. Le seul `transfers.create` du dépôt est dans `walletWithdraw`. Payouts en `interval: 'manual'`.
- **Frais** : acheteur = `max(2,00 $ ; prix × 5 % + 1,50 $)`. Commission vendeur = **0 %**. Réduction liée au forfait boutique : pro −50 %, premium −100 % (sur les frais **acheteur**).
- **Taxes** TPS/TVQ derrière `TAX_ENABLED=false`, et uniquement sur le service fee.
- **Séquestre** : 7 jours à partir du scan DELIVERED, puis `releaseHeldFunds`.
- **`seller_balances` est une collection MORTE** (aucune écriture, aucune règle). Le ledger est `wallets/` + `ledger`. Montants : `transactions` en **dollars**, `wallets`/`ledger` en **cents**.
- Secrets Secret Manager : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `SHIPENGINE_API_KEY`, `SHIPENGINE_WEBHOOK_SECRET`.
- **Mutations financières / statuts sensibles** : toujours Cloud Function avec `runTransaction`, jamais client.

### Plateforme

- **Toutes les Cloud Functions en v2, région `northamerica-northeast1`, `memory >= 512MiB`** — sans exception.
- **Nouveau trigger Firestore/Eventarc sur Dev** : vérifier que son compte d’appel exact peut invoquer son service Cloud Run privé (`roles/run.invoker` sur ce service seulement), puis constater un événement et son reçu métier. Un état `ACTIVE` ne prouve pas la réception des événements ; ne pas ouvrir le service à `allUsers` pour résoudre un refus d’invocation.
- **Hook automatique** bloque l'édition de `android/` et `ios/` (`.Codex/hooks/block-native-edits.sh`). Toute modif native passe par `app.config.js` + `expo-build-properties` + `npx expo prebuild`.
- **Auth** : hydratée une seule fois dans `app/_layout.tsx` via `useAuthListener()` → `authStore.hydrateFromFirebase`. Source de vérité unique. Le dossier `contexts/` n'existe plus : `useAuth`, `useAuthRequired` vivent dans `hooks/`, `useAuthListener` et `useConsentGuard` dans `features/auth/hooks/`.
- **Pas de** Helcim · Lingui · Redux · moment · @react-native-firebase · fast-image.
- **React Compiler activé** : ne plus empiler de mémoïsation manuelle.
- **Jamais `withSpring`/`springify`/bounce** — toujours `withTiming` + ease-out.
- **Jamais `undefined` passé à `updateDoc`/`setDoc`** — utiliser `null` ou exclure le champ.
- **Styling exclusivement via les tokens `constants/theme`** — aucune valeur magique, aucune couleur en dur.
- **Toute image DOIT être redimensionnée et compressée avant upload** (`prepareImageForUpload`, 1200 px / 0.75).

---

## TESTS

```bash
npx tsc --noEmit                                     # typecheck app
cd functions && npx tsc --noEmit                     # typecheck functions (noUnusedLocals actif)
npx jest                                             # 628 tests unitaires (RNTL)
npx vitest run                                       # 78 tests app
cd functions && npx vitest run                       # 374 tests functions
npm run lint:boundaries                              # frontières d'architecture
JAVA_HOME=/opt/homebrew/opt/openjdk@21 npm run test:security   # règles Firestore (JDK 21 requis)
```

**Avant de commiter un refacto** : `tsc` des deux côtés + `lint:boundaries` + les 3 suites de tests. Un `tsc` vert ne prouve rien sur les chaînes de `jest.mock` ni sur les imports `type` (effacés à la compilation) — grep-les à la main après un déplacement de fichier.

---

## REPRISE DE SESSION

**Lire `_audit-reports/HANDOFF.md` en début de session.** Il porte ce qui n'est écrit nulle part
ailleurs : l'état d'avancement du chantier en cours, les audits **incomplets** (et lesquels), les
pièges rencontrés, et les décisions en attente du fondateur. Le régénérer en fin de session avec le
skill `second-handoff`.

---

**Références** : `_audit-reports/HANDOFF.md` (état du chantier) · `docs/metier/` (18 documents métier, la référence produit) · `CODEBASE_INDEX.md` · `firestore-schema.md`
