# Audit Boutiques (offre payante) & Administration — Cross-platform iOS/Android (2026-06-01)

## Résumé exécutif

La dimension « Boutiques » (offre payante validée par l'admin) et son administration présentent une rupture de sécurité majeure : la collection `shops` n'a **aucun verrou de champ ni clause `isAdmin()`** dans `firestore.rules` (lignes 41-55). Conséquence double et critique : (1) un propriétaire peut **s'auto-approuver** (`status:'approved'`) depuis le client SDK, contournant entièrement la modération et le modèle payant ; (2) symétriquement, un admin légitime **ne peut pas modérer** les boutiques d'autrui (les rules n'autorisent que l'owner), donc le panneau admin est de fait inopérant en prod. Toutes les transitions de statut sont en client SDK, **aucune Cloud Function** de validation boutique n'existe. À cela s'ajoutent : un **modèle métier payant totalement absent du code** (aucun champ tier/forfait, aucun lien `Article.shopId`), une **modération de contenu inexistante** (collection `reports` sans écran ni CF de traitement), un **blocage utilisateur asymétrique** (un bloqué peut toujours écrire dans le chat), et plusieurs écarts cross-plateforme (carte Google Maps cassée sur iOS ET Android, safe-area, voile Android). La modération boutique promise et le modèle de monétisation ne sont, en l'état, **ni sécurisés ni fonctionnels**.

| Sévérité | Nombre |
|----------|--------|
| **P0** | 10 |
| **P1** | 8 |
| **P2** | 8 |
| **P3** | 12 |
| **Total** | **38** |

> Note : plusieurs P0 (auto-approbation boutique, modération admin cassée, absence de CF) ont été levés par des analyses indépendantes sur des dimensions différentes (page boutique, modèle payant, sécurité admin, transverse). Ils décrivent la **même racine** : `firestore.rules` /shops sans verrou de champ + transitions de statut en client SDK. Ils sont regroupés ci-dessous sous **P0-1** (faille) et **P0-2** (modération cassée) pour éviter les corrections redondantes — un seul fix backend les résout.

---

## Findings P0 (dont failles d'accès admin)

### P0-1 — Auto-approbation de boutique : le propriétaire peut écrire `status:'approved'` sur son propre doc (contournement total de la modération + du modèle payant)
- **Sévérité** : P0
- **Plateforme** : both / backend
- **Fichiers** :
  - `firestore.rules:46-47` (create), `firestore.rules:49-51` (update), `firestore.rules:54` (delete)
  - `services/shopService.ts:40` (createShop pose `status:'pending'`), `services/shopService.ts:310-319` (approveShop)
  - `app/shop/[id].tsx:196-201` (badge « Boutique vérifiée »)
  - `services/shopService.ts:130-135` (getApprovedShops), `services/shopService.ts:222` (getShopsNearLocation)
- **Description** : La règle d'update de `shops` n'impose **aucune restriction de champ** : `allow update: if isAuthenticated() && request.auth.uid == resource.data.ownerId;` (firestore.rules:50-51). Aucun `diff().affectedKeys().hasAny([...])`, aucune clause `isAdmin()` (le helper existe pourtant, firestore.rules:22-24). Le propriétaire (`uid == ownerId`) peut donc envoyer directement `updateDoc(doc('shops', monShopId), { status:'approved', verificationDetails:{ verifiedBy: monUid } })` — exactement ce que fait `ShopService.approveShop` (shopService.ts:312-319). **Aggravation** : la règle `create` (46-47) ne force pas non plus `status == 'pending'`, donc un client peut créer directement une boutique en `status:'approved'`. La défense client `updateShop` (shopService.ts:286-287 `delete updateData.status`) est une simple convention, contournable par un `updateDoc` brut. Aucune Cloud Function n'intercepte (grep `approveShop|rejectShop|shops` dans `functions/src` = vide ; seules occurrences = deep-links de notification `notifications.ts:71-74`).
- **Impact** : Privilege escalation métier. Tout vendeur publie une boutique « approuvée / vérifiée » (badge app/shop/[id].tsx:196), visible publiquement (getApprovedShops, getShopsNearLocation), sans modération humaine ni paiement — fraude, blanchiment de visibilité, contournement de la monétisation adossée au statut.
- **Recommandation** : Déplacer approve/reject/suspend dans des **Cloud Functions callables v2** (région `northamerica-northeast1`, `memory >= 512MiB`) vérifiant `request.auth.token.admin`, écriture via Admin SDK. Durcir `firestore.rules` /shops : interdire au owner de muter `status`/`verificationDetails` (`!request.resource.data.diff(resource.data).affectedKeys().hasAny(['status','verificationDetails'])`) ET forcer `request.resource.data.status == 'pending'` au create. Déléguer à `firebase-backend`.

### P0-2 — La modération admin des boutiques est cassée : approveShop/rejectShop/suspendShop écrivent en client SDK mais les rules bloquent l'admin
- **Sévérité** : P0
- **Plateforme** : both / backend
- **Fichiers** :
  - `services/shopService.ts:310-324` (approve), `:329-344` (reject), `:349-364` (suspend)
  - `firestore.rules:50-51` (update = owner uniquement, pas d'`isAdmin()`)
  - `app/admin/shops.tsx:113` (approve), `:119` (Alert erreur), `:136` (reject), `:142` (Alert erreur)
  - `app/admin/shop-detail/[id].tsx:70` (approve), `:77` (Alert), `:93` (reject), `:100` (Alert)
- **Description** : Les écrans admin appellent `ShopService.approveShop(shop.id, user.id)` / `rejectShop` en client SDK. La seule règle d'update exige `request.auth.uid == resource.data.ownerId`. Or l'admin modère les boutiques **d'autrui** — il n'en est pas le propriétaire → l'écriture est **refusée par Firestore (permission-denied)**. Aucune branche `isAdmin()` dans le match /shops, aucune callable admin (grep `export const .*[Ss]hop` dans functions/src = 0). Le read fonctionne (`allow read: if true`, getPendingShops shopService.ts:94-98), donc le panneau **se peuple** mais chaque clic Approuver/Rejeter échoue avec une alerte générique (non silencieux : `Alert.alert('Erreur', ...)`).
- **Impact** : En prod avec rules déployées, **aucune boutique ne peut être validée par un admin** via le flow nominal → activation du modèle boutique payante bloquée. Soit la feature est cassée contre le repo, soit les rules déployées divergent du repo (faille de sécurité non tracée). Identique iOS/Android.
- **Recommandation** : Identique à P0-1 — callables Admin SDK gardées par le claim admin, qui tracent `verifiedBy/verifiedAt` côté serveur, retirer les `updateDoc` client de shopService.ts. Vérifier en parallèle que les rules déployées en prod == repo.

### P0-3 — Le signalement de contenu est un trou noir : collection `reports` sans écran admin ni Cloud Function de traitement
- **Sévérité** : P0
- **Plateforme** : both
- **Fichiers** :
  - `services/moderationService.ts:47` (statuts définis jamais transitionnés), `:82-100` (createReport), `:112-156` (getUserReports/hasUserReported = code mort)
  - `components/ReportBottomSheet.tsx:96-108` (promesse « Notre équipe va l'examiner »)
  - `app/admin/_layout.tsx`, `app/admin/shops.tsx`, `app/admin/shop-detail/[id].tsx` (aucun écran reports)
  - `firestore.indexes.json` (0 index reports), `functions/src/callable/recourse.ts:291` (buyerReport = litige de transaction, sans rapport)
- **Description** : `createReport` écrit toujours `status:'pending'` ; aucune méthode ne transitionne vers reviewed/resolved/dismissed. Aucun écran admin ne **lit** `reports`, aucune Cloud Function (resolveReport/hideContent/warnUser) n'existe, aucun index reports n'est défini. Le scaffolding de permission existe pourtant (firestore.rules:471-479 autorise read/update aux admin/moderator) mais reste totalement non consommé. `getUserReports`/`hasUserReported` sont du code mort.
- **Impact** : Les utilisateurs sont explicitement rassurés (« Notre équipe va l'examiner dans les plus brefs délais », ReportBottomSheet.tsx:98) alors qu'aucun humain ni système ne voit ni traite les rapports. Promesse non tenue, risque Loi 25 / conformité (contenu illégal, arnaque, harcèlement jamais retiré).
- **Recommandation** : Construire un écran admin de file de modération (lecture `reports` triés par status/createdAt + index dédié) + Cloud Functions admin (resolveReport/hideContent/warnUser) avec `runTransaction` et vérification du claim admin ; sinon retirer la promesse UI. Déléguer à `firebase-backend` puis `rn-expo-dev`.

### P0-4 — Le signalement utilisateur échoue toujours : champs `undefined` envoyés à Firestore (pas de `ignoreUndefinedProperties`)
- **Sévérité** : P0 (revue → **P1**)
- **Plateforme** : both
- **Fichiers** :
  - `services/moderationService.ts:82-100` (objet construit avec `targetOwnerId`/`description` toujours présents)
  - `config/firebaseConfig.ts:53` (`getFirestore(app)` sans `ignoreUndefinedProperties`)
  - `components/ReportBottomSheet.tsx:92` (`description.trim() || undefined`)
  - `app/user/[id].tsx:279` (`open('user', id)` sans ownerId → `targetOwnerId = undefined`)
- **Description** : `createReport` spread un objet contenant `targetOwnerId` et `description` qui valent `undefined` (signalement utilisateur sans détail). Firestore est initialisé sans `ignoreUndefinedProperties` (grep = 0 occurrence) → le SDK Web v12 rejette tout `undefined` → `addDoc` throw → `Alert('Erreur lors de l'envoi du signalement')`. Va à l'encontre de la règle projet « No undefined in Firestore ».
- **Impact** : Le signalement **utilisateur** (toujours sans ownerId) et tout signalement sans texte libre échouent systématiquement. Fonction de modération/sécurité cassée dans des cas fréquents. **Revue P0 → P1** : signalements article/message avec ownerId + texte passent ; ce n'est pas un trou de sécurité exploitable ni une perte de données financières.
- **Recommandation** : Activer `initializeFirestore(app, { ignoreUndefinedProperties: true })` (corrige tous les call sites du même type) OU omettre conditionnellement les clés undefined (`stripUndefined`) avant addDoc. Déléguer à `firebase-backend`.

### P0-5 — Aucun test de sécurité ne couvre la collection `shops`
- **Sévérité** : P0 (classé par l'analyse en **P2** — gap de couverture, pas l'exploit)
- **Plateforme** : backend
- **Fichiers** : `tests/security/` (aucun `shops.rules.test.ts`), `firestore.rules:49-51`
- **Description** : La suite (`users`, `transactions`, `wallets`, `server_only`, `storage`) ne teste **pas** `shops` (grep `shop` dans tests/security = vide). C'est précisément l'absence de seam de test qui a laissé passer la règle update sans verrou de champ. `vitest.config.ts:5` auto-collecterait un `shops.rules.test.ts` s'il existait.
- **Impact** : Régressions de sécurité sur le cycle de vie boutique non protégées par CI.
- **Recommandation** : Ajouter `tests/security/shops.rules.test.ts` : (a) owner NE PEUT PAS écrire `status='approved'`/`verificationDetails` ; (b) non-owner/non-admin ne peut pas écrire ; (c) lecture publique OK, delete refusé ; (d) chemin admin légitime via callable (todo). Déléguer à `firebase-backend`.

> **P0 regroupés** : Les analyses ont produit 7 findings P0 distincts décrivant les 2 mêmes racines (auto-approbation + modération cassée, ci-dessus P0-1 / P0-2). Ils proviennent des dimensions « Page boutique », « Modèle payant », « Validation admin », « Sécurité d'accès admin » et « Transverse ». **Un seul chantier backend** (callables admin + durcissement rules /shops + tests) clôt P0-1, P0-2, P0-5.

---

## Findings P1 — bugs & écarts iOS ↔ Android

### P1-1 — Le modèle « forfaits boutique + réduction des frais acheteur » est totalement absent du code
- **Sévérité** : P1 — **Plateforme** : backend
- **Fichiers** : `types/index.ts:554-577` (interface Shop sans tier/plan/forfait), `functions/src/utils/fees.ts:77` + `:109` (calculateFees/calculateServiceFee = 5% + 1,50$ fixe, min 2,00$, sans notion de boutique), `functions/src/callable/payments.ts:382-399` (getServiceFee ne prend que articlePrice), `:435-444` + `:716` (createTransaction ne reçoit pas shopId), `types/index.ts:182-221` (Article sans shopId).
- **Description** : Le modèle métier (« 3 forfaits → réduction des frais acheteur, commission vendeur 0% ») n'existe nulle part. Grep exhaustif (forfait/shop tier/plan/subscription/feeReduction) = 0. Le calcul de frais est identique pour tous, createTransaction ne sait même pas qu'un article appartient à une boutique (pas de shopId).
- **Impact** : Aucune différenciation ni revenu boutique possible : un acheteur paie les mêmes frais chez un particulier ou une boutique « premium ». Divergence majeure modèle/code.
- **Recommandation** : Contrat data : `Shop.tier` (enum 3 forfaits) + `Article.shopId`, réduction calculée **100% serveur** dans createTransaction (charger shop/tier depuis l'article, jamais le client), exposée en lecture seule via getServiceFee. Déléguer à `firebase-backend`.

### P1-2 — Fonctionnalité « articles de la boutique » non fonctionnelle : aucun lien article↔boutique
- **Sévérité** : P1 — **Plateforme** : both
- **Fichiers** : `types/index.ts:182` (Article sans shopId), `services/shopService.ts:42` (`articlesCount: 0` jamais incrémenté), `app/shop/[id].tsx:303` (`shop.articlesCount > 0 &&` → jamais affiché) + `:313` (`/search?shopId=`), `features/search/hooks/useSearchScreen.ts:116` (`sellerId: params.shopId`) + `:467` (titre), `services/articlesService.ts:620` (`where('sellerId', '==', ...)`), `services/shopService.ts:373` (getShopArticles dead code), `functions/src/callable/products.ts:346` (createArticle ne pose pas shopId).
- **Description** : Quatre cassures cumulées : Article n'a pas de shopId, `articlesCount` reste à 0 (section jamais rendue), le bouton « Voir tous les articles » mappe shopId→sellerId (un doc-ID boutique ≠ UID vendeur → 0 résultat), et getShopArticles interroge un champ inexistant et n'est jamais appelée.
- **Impact** : La vitrine d'articles de la page boutique est morte de bout en bout — contredit le positionnement marketplace et le modèle boutique payante.
- **Recommandation** : `Article.shopId` (renseigné à la publication dans createArticle), index `articles(shopId, isActive, isSold)`, `shop.articlesCount` via trigger CF, filtrer la recherche par shopId (pas sellerId). Déléguer `firebase-backend` + `rn-expo-dev`.

### P1-3 — Carte boutique cassée sur iOS ET Android : `PROVIDER_GOOGLE` sans clé Google Maps
- **Sévérité** : P1 — **Plateforme** : both
- **Fichiers** : `app/shop/[id].tsx:24` + `:249-251`, `app/admin/shop-detail/[id].tsx:24` + `:270-272`, `app.config.js:51` (plugin `expo-maps`, pas `react-native-maps`), `android/app/src/main/AndroidManifest.xml` (0 meta-data `com.google.android.geo.API_KEY`), `ios/Podfile.lock:1717` (`react-native-maps` mais aucun pod `GoogleMaps`), `package.json:67` + `:82` (deux libs maps coexistent).
- **Description** : Les deux écrans forcent `provider={PROVIDER_GOOGLE}` sans aucune clé Google Maps configurée (ni iOS `googleMapsApiKey`, ni Android `geo.API_KEY`, ni `GMSServices.provideAPIKey`). **Correction du cadrage initial** : ce n'est PAS un écart iOS/Android — la carte est cassée (tuile grise/vide) sur les **deux** plateformes. `expo-maps` est déclaré en plugin mais jamais importé (poids mort).
- **Impact** : Carte vide pour 100% des utilisateurs ayant une boutique géolocalisée (argument du modèle payant local). Confusion de build (deux libs).
- **Recommandation** : Choisir UNE lib. Soit migrer vers `expo-maps` (déjà en plugin) ; soit ajouter le config plugin `react-native-maps` + clés Maps iOS ET Android puis prebuild ; soit `PROVIDER_DEFAULT` (Apple Maps iOS immédiat, Google Android nécessite quand même la clé). Désinstaller `expo-maps` si non retenu. Déléguer à `rn-expo-dev`.

### P1-4 — Notifications de décision boutique systématiquement perdues (rules `notifications create: if false`)
- **Sévérité** : P1 — **Plateforme** : both
- **Fichiers** : `firestore.rules:72` (`allow create: if false`), `services/notificationService.ts:40-43` (addDoc client) + `:83-116` (catch silencieux notifyShopApproved/Rejected), `app/admin/shops.tsx:114` + `:137`, `app/admin/shop-detail/[id].tsx:71` + `:94`, `functions/src/utils/notifications.ts:86-108` (createInAppNotification Admin SDK existant mais jamais invoqué pour boutique).
- **Description** : Après décision, l'admin appelle notifyShopApproved/Rejected → `createNotification` fait `addDoc('notifications')` client, refusé par la rule (create réservé aux CF). L'erreur est avalée par try/catch. **Correction** : le volet « admins jamais notifiés des nouvelles boutiques » (`notifyAdminNewShop`) est du **code mort** (jamais appelé), pas un bug actif.
- **Impact** : Le propriétaire n'est jamais informé de l'approbation/rejet (ni de la raison). Aucun signal d'erreur côté admin.
- **Recommandation** : Émettre la notif depuis une CF Admin SDK (callable admin créant le doc, ou trigger `onUpdate` de shops sur changement de status — le helper `createInAppNotification` existe déjà). Cesser l'addDoc client. Déléguer à `firebase-backend`.

### P1-5 — Blocage utilisateur asymétrique : un bloqué peut toujours contacter celui qui l'a bloqué (chat)
- **Sévérité** : P1 — **Plateforme** : both
- **Fichiers** : `services/moderationService.ts:263-280` (areUsersBlocked unidirectionnel — lit seulement le doc de l'appelant), `services/chatService.ts:327-338` (sendMessage lit le doc du sender), `firestore.rules:259-315` (rules messages sans check de blocage), `functions/src/triggers/messages.ts:17-170` (trigger = push notif only, ne rejette rien), `functions/src/callable/swaps.ts:95-108` (seul check bidirectionnel, pour les swaps), `app/settings/blocked-users.tsx:146` (promesse fausse).
- **Description** : `areUsersBlocked(senderId, otherUserId)` ne teste que « est-ce que le sender a bloqué l'autre ». Quand B (bloqué par A) écrit, on lit le doc de B (qui ne contient pas A) → `isBlocked=false` → message créé via addDoc client. Le commentaire du service prétend que « le sens inverse est appliqué côté serveur » — FAUX pour le chat (seuls les swaps ont un check bidirectionnel).
- **Impact** : Le blocage ne protège pas : un harceleur bloqué continue d'écrire à sa victime. Contournement nominal (rien à forger). Promesse UI mensongère.
- **Recommandation** : Faire passer l'envoi par une callable, OU ajouter au trigger `onCreate` existant un check bidirectionnel qui supprime le message + n'envoie pas la notif (comme swaps.ts). Déléguer à `firebase-backend`.

### P1-6 — Footer Approuver/Rejeter chevauche le home indicator (safe-area bottom manquant)
- **Sévérité** : P1 — **Plateforme** : both
- **Fichiers** : `app/admin/shop-detail/[id].tsx:189` (`SafeAreaView edges={['top']}`), `:328-340` (footer actions), style footer `:556-563` (`padding: 20` fixe, pas d'inset), `app/admin/shops.tsx:189` (même limitation).
- **Description** : L'écran de validation utilise `edges={['top']}` (aucun inset bas) et le footer d'actions critiques a `padding: 20` fixe sans `insets.bottom`. `useSafeAreaInsets` n'est pas importé. Sur iPhone à home indicator (~34px) et Android gestes (~21-48px), la zone basse du footer est partiellement chevauchée. Boutons partiellement encroachés (pas entièrement masqués — il reste 20px), d'où P1.
- **Impact** : Zone de tap dégradée sur l'action la plus critique de la modération, les deux plateformes.
- **Recommandation** : Importer `useSafeAreaInsets()` et `paddingBottom: Math.max(20, insets.bottom)` sur le footer (préférable à `edges={['top','bottom']}` qui créerait du blanc résiduel). Déléguer à `rn-expo-dev`.

---

## Findings P2 / P3

### P2

**P2-1 — Statut `suspended` non géré côté public : boutique suspendue affichée et contactable**
- Plateforme : both. Fichiers : `app/shop/[id].tsx:196` (seul usage de status = badge), `:144` (`if (!shop)` ne couvre pas non-approuvé), `services/shopService.ts:62` (getShopById sans filtre status) + `:349` (suspendShop), `firestore.rules:43` (`read: if true`), `types/index.ts:512` (ShopStatus).
- Une boutique suspended/rejected reste accessible par lien direct, s'affiche entièrement et reste contactable (handleCall/handleEmail). Atténuation : les listes publiques filtrent sur `approved` et aucune navigation publique vers /shop/[id] n'existe (atteignable seulement par lien direct/deep link) → P2.
- Reco : gérer `status !== 'approved'` (état « indisponible » + désactivation des contacts) et/ou restreindre la lecture aux `approved` côté rules/getShopById.

**P2-2 — Statut `suspended` implémenté mais sans aucun chemin UI pour le déclencher**
- Plateforme : both. Fichiers : `services/shopService.ts:349-364` (suspendShop = code mort), `app/admin/shops.tsx:28` (TabType sans `suspended`), `app/admin/shop-detail/[id].tsx:327-340` (footer actions gardé par `status === 'pending'`), `components/admin/ShopValidationCard.tsx:29-30` (badge seulement).
- Aucun écran admin n'appelle suspendShop. Une boutique approuvée frauduleuse ne peut jamais être suspendue depuis l'app. Modération unidirectionnelle.
- Reco : ajouter une action « Suspendre » pour les boutiques approved (via callable admin), ou retirer suspendShop.

**P2-3 — Onglet « Toutes » omet les boutiques suspendues (liste incomplète)**
- Plateforme : both. Fichiers : `app/admin/shops.tsx:82-88` (case 'all' = pending+approved+rejected seulement), `services/shopService.ts:130-161` (pas de getSuspendedShops).
- Le case 'all' agrège 3 statuts via 3 requêtes ; 'suspended' jamais requêté → trou noir (latent tant que suspendShop n'est pas câblé). Compteur 'Toutes' sous-évalué.
- Reco : un seul `getDocs` non filtré pour 'all' (pas d'orderBy donc pas d'index requis), ou ajouter getSuspendedShops.

**P2-4 — Notifications de validation boutique en client SDK (échec silencieux)** — *doublon de P1-4 vu sous l'angle « sécurité admin »*
- Plateforme : both. Fichiers : `services/notificationService.ts:40-43`, `firestore.rules:72`, `app/admin/shops.tsx:114`/`:137`, `app/admin/shop-detail/[id].tsx:71`/`:94`. Volet « admins non notifiés » = code mort (notifyAdminNewShop). À fusionner avec P1-4.

**P2-5 — Type de signalement `message` jamais déclenché et `review` autorisé sans code**
- Plateforme : both. Fichiers : `services/moderationService.ts:17` (ReportType `user|article|message`), `components/ReportBottomSheet.tsx:122-123` (branche 'message' morte), `features/chat/hooks/useChatModeration.ts:62`+`:72` (seulement `open('user', ...)`), `firestore.rules:489` (autorise 'review' inexistant). Commentaire firestore.rules:481-485 « Aligned with moderationService.ts » trompeur.
- Reco : câbler `open('message', ...)` ou retirer 'message' ; aligner la liste targetType des rules (retirer 'review').

**P2-6 — Double-soumission possible du rejet de boutique (pas de garde de chargement)**
- Plateforme : both. Fichiers : `components/admin/RejectionModal.tsx:40-45` (onConfirm non-await + close synchrone, bouton `disabled={!reason.trim()}` seulement), `app/admin/shops.tsx:132-144`, `app/admin/shop-detail/[id].tsx:89-102`, `services/notificationService.ts:40` (addDoc → nouveau docId à chaque appel).
- Impact réel : deux docs notification distincts (rejectShop est idempotent sur le status). Le volet « double application_fee future » est hypothétique.
- Reco : `isSubmitting` dans RejectionModal (await + disable + spinner jusqu'à résolution).

**P2-7 — RejectionModal monté en permanence (index=-1) — risque de voile Android** *(confiance medium)*
- Plateforme : android. Fichiers : `components/admin/RejectionModal.tsx:63-65` (`BottomSheet index={-1}` toujours monté, pas de `if (!isOpen) return null`), `app/admin/shops.tsx:269-273` (frère de la FlashList, pas enfant — correction), `components/ReportBottomSheet.tsx:149` (pattern mount-on-open correct).
- À tester sur device Android. Note : c'est un `BottomSheet` plain avec `disappearsOnIndex={-1}` (cf. faux positif écarté ci-dessous) — risque atténué mais l'écart avec le pattern adopté par ReportBottomSheet justifie l'uniformisation.
- Reco : exposer `isOpen` piloté par `show()`/`onChange(index===-1)` + `if (!isOpen) return null`.

> **Conflit de verdicts sur P2-7** : une analyse confirme (needs_nuance, medium) en s'appuyant sur la mémoire « Bottom sheet voile Android » ; une autre l'écarte en **faux positif** car le voile ne touche que `BottomSheetModal`, pas le `BottomSheet` plain utilisé ici (cf. annexe). **Trancher par un test device Android avant correction** — ne pas refactorer à l'aveugle.

**P2-8 — Aucun test de sécurité ne couvre `shops`** — voir P0-5 (classé P2 par l'analyse en tant que gap de couverture).

### P3

**P3-1 — Pas de protection anti double-tap sur l'approbation admin (vue liste + détail)**
- Plateforme : both. Fichiers : `app/admin/shops.tsx:100`+`:132`, `app/admin/shop-detail/[id].tsx:57-83`+`:330-338`, `components/admin/ShopValidationCard.tsx:107-129` (pas de prop disabled).
- Revue P2 → **P3** : le chemin Approuver passe par un `Alert.alert` natif (sérialise) et le rejet par RejectionModal avec `close()` synchrone ; écritures idempotentes. Risque réel = double notification (fenêtre étroite).
- Reco : `isSubmitting` par shopId désactivant les boutons sur les deux écrans + prop `disabled` sur ShopValidationCard. Pattern déjà présent ailleurs (PayButton, SwapActions).

**P3-2 — `deleteShop` côté service mort/contradictoire avec les rules (`delete: if false`)**
- Plateforme : backend. Fichiers : `services/shopService.ts:418-425` (deleteDoc), `firestore.rules:54` (`allow delete: if false`). Code mort (0 appelant), opération toujours bloquée.
- Reco : retirer la méthode (retrait = `status:'suspended'`), ou router par CF admin si suppression voulue.

**P3-3 — `Article.shopId` non typé alors que getShopArticles l'interroge**
- Plateforme : backend. Fichiers : `services/shopService.ts:369`, `types/index.ts:182`, `firestore.indexes.json` (pas d'index). Revue P1 → **P3** : getShopArticles est du code mort (jamais appelée), donc l'impact « boutique affiche 0 article » n'a pas lieu via cette fonction. À fusionner avec P1-2 (vrai chemin de recherche). Direction de design valable (shopId + index + migration).

**P3-4 — `reporterName` figé à la création du signalement (pas de propagation displayName)**
- Plateforme : both. Fichiers : `components/ReportBottomSheet.tsx:88`, `services/moderationService.ts:82-92`, `functions/src/callable/users.ts` (deleteUserAccount n'anonymise PAS reports/reporterName — gap Loi 25 réel), `firestore.rules:465-479` (reports correctement verrouillé read/update admin).
- Reco : ré-hydrater le nom à la lecture admin via callable ; **inclure `reports/` dans le périmètre d'anonymisation de la suppression de compte** (point le plus important, Loi 25).

**P3-5 — Anti-doublon de signalement (`hasUserReported`) jamais utilisé : spam possible**
- Plateforme : both. Fichiers : `services/moderationService.ts:138-156` (code mort), `components/ReportBottomSheet.tsx:81-114` (createReport sans garde), `firestore.rules:465-491` (aucune contrainte d'unicité).
- Reco : docId déterministe `${reporterId}_${targetType}_${targetId}` + allow create conditionnel (la garde client est contournable), plutôt que l'appel client.

**P3-6 — L'écran admin shop-detail n'a pas de garde de rôle propre (dépend du `_layout`)**
- Plateforme : both. Fichiers : `app/admin/shop-detail/[id].tsx:38-42` (loadShopDetails sans isUserAdmin), `app/admin/shops.tsx:50-65` (double-vérif), `app/admin/_layout.tsx:39-48` (guard centralisé via Slot). Défense-en-profondeur incohérente, risque faible (la vraie barrière = rules + callables).
- Reco : uniformiser (retirer la double-vérif de shops.tsx OU l'ajouter à shop-detail). Ne jamais considérer ces vérifs client comme barrière de sécurité.

**P3-7 — `PROVIDER_GOOGLE` codé en dur sur la carte (smell, pas de Platform.select)** — voir P1-3. Sous l'angle « sécurité admin » classé P3 (aucun écart de sécurité, purement rendu). À traiter avec P1-3.

**P3-8 — ShopValidationCard utilise `Image` de react-native au lieu d'expo-image**
- Plateforme : both. Fichiers : `components/admin/ShopValidationCard.tsx:4` + `:56-57` (Image RN dans une FlashList admin). ~38 fichiers utilisent expo-image, seul ce composant ne le fait pas.
- Reco : remplacer par `import { Image } from 'expo-image'` (+ `recyclingKey={item.id}`, cachePolicy) pour cache/recyclage cohérent.

**P3-9 — Affichage adresse : pays brut non normalisé sur la fiche boutique**
- Plateforme : both. Fichiers : `app/shop/[id].tsx:242` (`{shop.address.country}` brut), `types/index.ts:533` (country string libre), `services/shopService.ts:30` (createShop ne normalise pas). **Correction** : le téléphone N'EST PAS affiché (seulement `tel:` dans handleCall, format brut correct) — retirer le volet « formater le téléphone ».
- Reco : normaliser/masquer le pays (libellé constant « Canada »), comme le reste de l'app force déjà `country:'CA'`.

**P3-10 — Commentaire de config obsolète « Helcim »**
- Plateforme : na. Fichier : `app.config.js:49` (`// Helcim payment via WebView`). Commentaire inerte (Stripe Connect livré Sprint 6). Déjà signalé dans un rapport antérieur (`fondations-crossplatform-2026-06-01.md` P2-18) — **traiter une seule fois**.
- Reco : mettre à jour/supprimer le commentaire pour refléter Stripe Connect Custom.

---

## Matrice cross-plateforme

| Zone | iOS | Android | Écart |
|------|-----|---------|-------|
| Auto-approbation boutique (rules /shops) | Exploitable | Exploitable | Aucun — faille data-layer identique |
| Modération admin (approve/reject/suspend) | Cassée (permission-denied) | Cassée (permission-denied) | Aucun |
| Signalement utilisateur (undefined) | Échoue | Échoue | Aucun — logique JS pure |
| File de modération admin (reports) | Absente | Absente | Aucun |
| Blocage chat (B→A) | Non appliqué | Non appliqué | Aucun |
| Carte boutique (PROVIDER_GOOGLE) | Cassée (pas de pod GoogleMaps) | Cassée (pas de geo.API_KEY) | Aucun — cassée des deux côtés *(corrige le cadrage initial « iOS-only »)* |
| Footer Approuver/Rejeter (safe-area) | Chevauche home indicator | Chevauche barre de gestes | Aucun — dégradé des deux côtés |
| RejectionModal voile (index=-1) | OK (BottomSheet plain) | Risque voile (à tester) | Potentiel — spécifique Android, **non prouvé** |
| ShopValidationCard Image RN | Flicker au recyclage | Flicker au recyclage | Aucun |
| Notifications décision boutique | Perdues | Perdues | Aucun |

> Constat : la quasi-totalité des défauts sont **cross-plateforme cohérents** (couche service/rules/functions partagée). Les cadrages initiaux « iOS-only » sur la carte se sont révélés faux à la vérification (cassée sur les deux). Le seul écart potentiellement spécifique (voile Android RejectionModal) reste **non prouvé statiquement** et requiert un test device.

---

## Plan d'action priorisé (P0 → P3)

**Bloc 1 — Sécurité boutique (P0, `firebase-backend`)** — *un seul chantier ferme P0-1, P0-2, P0-5*
1. Créer callables v2 `adminApproveShop` / `adminRejectShop` / `adminSuspendShop` (région `northamerica-northeast1`, `memory >= 512MiB`, vérif `request.auth.token.admin`, écriture Admin SDK, trace verifiedBy/verifiedAt serveur).
2. Durcir `firestore.rules` /shops : create force `status=='pending'` ; update owner interdit `status`/`verificationDetails` via `diff().affectedKeys().hasAny([...])` ; ces transitions exclusivement via Admin SDK.
3. Rebrancher les écrans admin sur les callables, retirer les `updateDoc` client de shopService.ts.
4. Ajouter `tests/security/shops.rules.test.ts` (auto-approbation refusée, non-owner refusé, lecture publique OK, delete refusé).

**Bloc 2 — Modération de contenu (P0, `firebase-backend` + `rn-expo-dev`)**
5. P0-3 : écran admin file de modération + callables resolveReport/hideContent/warnUser + index `reports`.
6. P0-4/P1-4 : activer `ignoreUndefinedProperties` (corrige signalement utilisateur) ; émettre les notifs boutique depuis une CF (callable admin ou trigger onUpdate shops).

**Bloc 3 — Modèle métier & data (P1, `firebase-backend` + `rn-expo-dev`)**
7. P1-1 + P1-2 + P3-3 : `Article.shopId` (renseigné dans createArticle) + `Shop.tier` (3 forfaits) + réduction de frais 100% serveur dans createTransaction + index + `articlesCount` via trigger + filtre recherche par shopId.
8. P1-5 : check de blocage bidirectionnel sur le chat (callable ou trigger onCreate).

**Bloc 4 — Cross-plateforme & UX (P1/P2, `rn-expo-dev`)**
9. P1-3 + P3-7 : une seule lib maps + clés Maps iOS/Android (ou expo-maps), retirer la lib morte.
10. P1-6 : safe-area bottom sur le footer de validation.
11. P2-1 : état « boutique indisponible » pour `status !== 'approved'`.
12. P2-2 + P2-3 : câbler la suspension admin (via callable) + inclure suspended dans l'onglet « Toutes ».

**Bloc 5 — Dette & hygiène (P2/P3)**
13. P2-6 + P3-1 : `isSubmitting` sur les deux écrans admin + RejectionModal.
14. P2-7 : **tester sur device Android** avant tout refactor (verdict contradictoire).
15. P2-5, P3-2, P3-4 (anonymisation reports = Loi 25), P3-5, P3-6, P3-8, P3-9, P3-10.

---

## Annexe — faux positifs écartés

**FP-1 — « Fallback admin sur champ Firestore `isAdmin` — dépend d'une autre règle » (allégué P1)**
Écarté. La structure (fallback `user?.isAdmin === true`, userService.ts:177-179) existe, mais la prémisse de risque est démentie par le code : `firestore.rules:163-166` (update users) ET `firestore.rules:153-155` (create) **interdisent explicitement** toute écriture de `isAdmin`/`role`/`customClaims` via `diff().affectedKeys().hasAny([...])`. Déjà couvert par `tests/security/users.rules.test.ts:41-44` et `:53-63` (assertFails sur self-elevation). Un attaquant ne peut jamais obtenir `isAdmin === true` dans son doc → le fallback ne peut être déclenché frauduleusement. Reste une dette d'hygiène (P3) : supprimer le fallback vestigial pour aligner sur le seul custom claim.

**FP-2 — « RejectionModal (gorhom) monté en permanence → voile transparent bloquant Android » (allégué)**
Écarté **avec réserve**. Le bug du voile Android documenté (mémoire `feedback-bottomsheet-android-veil`) est **spécifique à `BottomSheetModal`**, pas au `BottomSheet` plain utilisé ici (`RejectionModal.tsx:1` importe `BottomSheet`, ouvert via `.expand()`, fermé via `.close()` — aucun `present()`/`dismiss()`). La note projet dit explicitement que les `BottomSheet` plain (`index={-1}`) ne rendent PAS leur backdrop tant que fermés → pas de voile. Cross-check : `SelectionBottomSheet.tsx` (utilisé dans search.tsx, donné comme exemple sain) a le même montage. **Réserve** : une autre analyse maintient le doute (needs_nuance, medium). → conserver comme **P2-7 à tester sur device** plutôt que clore définitivement ; ne pas refactorer sans reproduction.
