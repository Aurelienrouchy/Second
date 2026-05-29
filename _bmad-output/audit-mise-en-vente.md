# RAPPORT D'AUDIT -- Mise en vente d'un produit (Second)

## Resume executif

| Severite | Nombre |
|----------|--------|
| CRITIQUE | 3 |
| HAUTE | 8 |
| MOYENNE | 11 |
| BASSE | 5 |
| **Total** | **27** |

Les 3 findings critiques (apres requalification de C1 en BASSE) : (1) Storage articles path sans verification de propriete -- n'importe quel user authentifie peut ecraser les photos d'un autre, (2) l'ecran edit envoie des URIs locaux `file://` au callable, et (3) le formulaire de retrait collecte des infos bancaires que la CF ignore.

---

## SECTION 1 -- Securite et integrite des donnees

### [CRITIQUE] C2 -- Storage articles path sans verification de propriete

**Scenario** : N'importe quel utilisateur authentifie peut ecraser les images d'un article d'un autre vendeur dans Firebase Storage.

**Code** : `storage.rules:39-43`
```
match /articles/{articleId}/{allPaths=**} {
  allow read: if true;
  allow write: if request.auth != null
               && (request.resource == null || isValidImageUpload());
}
```

Il n'y a aucune verification que `request.auth.uid` est le proprietaire de l'article.

**Impact** : Un utilisateur malveillant peut remplacer les photos d'un article qu'il ne possede pas.

**Recommandation** : Migrer le path vers `articles/{userId}/{articleId}/...` et ajouter `request.auth.uid == userId`.

---

### [CRITIQUE] C3 -- L'ecran edit envoie des URIs locaux via le callable updateArticle

**Scenario** : Un vendeur ajoute de nouvelles photos depuis la galerie sur l'ecran d'edition. Les URIs `file://...` sont envoyees directement au callable `updateArticle` sans upload prealable en Storage.

**Code** :
- `app/article/edit/[id].tsx:324-341` -- `handleAddPhoto` ajoute des `asset.uri` (local) a `editedImages`
- `app/article/edit/[id].tsx:267-269` -- `articleData.images = editedImages` contient ces URIs locaux
- `app/article/edit/[id].tsx:271` -- Envoie au callable `updateArticle`
- `functions/src/callable/products.ts:623-629` -- Le callable valide seulement que `img.url` est un string non-vide

**Impact** : L'article edite avec de nouvelles photos aura des images cassees pour tous les autres utilisateurs.

**Recommandation** : Uploader les nouvelles photos en Storage avant d'appeler `updateArticle`, comme le fait `ArticlesService.createArticle`.

---

### [CRITIQUE] C4 -- Le formulaire de retrait (seller-balance) demande des infos bancaires qui ne sont jamais envoyees

**Scenario** : Un vendeur demande un retrait sur l'ecran seller-balance. Le formulaire demande transit, institution, et numero de compte. Ces informations sont envoyees comme parametre `bankAccount` que la Cloud Function ignore.

**Code** :
- `app/seller-balance.tsx:102-103` -- `bankAccount = transitNumber-institutionNumber-accountNumber`, passe a `requestWithdrawal`
- `services/sellerBalanceService.ts:94-98` -- Envoie `{ amount, bankAccount }` au callable
- `functions/src/callable/payments.ts:1130` -- `const { amount } = request.data` -- **seul `amount` est destructure, `bankAccount` est ignore**

**Impact** : L'utilisateur saisit des informations bancaires sensibles qui sont jetees. S'il n'a pas de `addBankAccount` prealable, le retrait echouera malgre la saisie.

**Recommandation** : Soit envoyer les infos bancaires a `addBankAccount` avant le retrait, soit ne pas afficher le formulaire bancaire si un compte est deja attache.

---

## SECTION 2 -- Validations incoherentes front/back

### [HAUTE] H1 -- Limite de photos : 5 (front) vs 10 (back)

**Code** :
- `app/sell/capture.tsx:37` -- `const MAX_PHOTOS = 5`
- `functions/src/callable/products.ts:218-219` -- `if (data.images.length > 10)` "Maximum 10 images"

**Impact** : Un API client pourrait poster 6-10 photos sans que le front ne puisse les afficher correctement en edition.

**Recommandation** : Aligner la constante ou documenter clairement.

---

### [HAUTE] H2 -- Description maxLength : 500 (front) vs 5000 (back)

**Code** :
- `app/sell/details.tsx:275` -- `maxLength={500}`
- `functions/src/callable/products.ts:262-263` -- `stripHtml(String(data.description)).substring(0, 5000)`

**Impact** : L'utilisateur est artificiellement limite a 500 caracteres.

**Recommandation** : Decider d'une limite unique et l'appliquer des deux cotes.

---

### [HAUTE] H3 -- Validation du prix cote preview vs pricing

**Code** :
- `app/sell/pricing.tsx:148` -- `priceNum < 0.01` (minimum 0.01)
- `app/sell/preview.tsx:125` -- `pricing.price <= 0` (minimum >0, pas 0.01)
- `functions/src/callable/products.ts:196` -- `data.price < 0.01` (minimum 0.01)
- `firestore.rules:19` -- `price >= 0.01`

**Impact** : La preview accepterait un prix de 0.005 que le CF rejettera.

**Recommandation** : Aligner la validation preview sur `>= 0.01`.

---

### [HAUTE] H4 -- Pas de verification email cote front avant publication

**Code** :
- `app/sell/_layout.tsx:8-25` -- Le gate du sell flow verifie seulement `user` (connecte), pas `email_verified`
- `functions/src/callable/products.ts:165-169` -- `if (!request.auth.token.email_verified)` rejette

**Impact** : Frustration UX majeure. L'utilisateur passe 5 ecrans de saisie pour se faire rejeter au dernier moment.

**Recommandation** : Verifier `email_verified` dans `_layout.tsx` du sell flow AVANT d'entrer dans le flow.

---

### [HAUTE] H5 -- L'ecran d'edition utilise le callable mais deleteArticle utilise updateDoc directement

**Code** :
- `app/article/edit/[id].tsx:271` -- `httpsCallable(functions, 'updateArticle')` (bon : passe par le CF)
- `services/articlesService.ts:530-533` -- `deleteArticle` appelle `this.updateArticle` (direct client via `updateDoc`)

**Impact** : Les soft-deletes contournent les validations server-side.

**Recommandation** : Migrer `deleteArticle` vers un callable.

---

### [HAUTE] H6 -- Le brouillon est mono-device (AsyncStorage)

**Code** : `services/draftService.ts:1-2` -- Le brouillon est stocke dans AsyncStorage (local au device).

**Impact** : Les brouillons ne sont pas synchronises entre appareils.

**Recommandation** : Documenter cette limitation dans l'UX ou migrer vers Firestore.

---

### [HAUTE] H7 -- Pas de verification Stripe Connect avant la publication (front)

**Code** :
- `functions/src/callable/products.ts:326-334` -- Le catch autour de la creation Stripe est non-bloquant
- `functions/src/callable/payments.ts:320-325` -- `createTransaction` rejette si `!stripeChargesEnabled`

**Impact** : L'article est visible, un acheteur engage le processus d'achat, mais le paiement echoue a cause du vendeur.

**Recommandation** : Soit rendre la creation Stripe bloquante dans `createArticle` (si shipping est active), soit afficher un statut "compte paiement non configure".

---

### [HAUTE] H8 -- La condition "description requise" est incoherente entre details.tsx et le CF

**Code** :
- `app/sell/details.tsx:215` -- `fields.description.trim() !== ''` (requis)
- `functions/src/callable/products.ts:262-264` -- `data.description ? ... : ''` (optionnel)

**Impact** : Le front est plus strict que le back.

**Recommandation** : Ajouter une validation de description minimale cote CF.

---

## SECTION 3 -- Gestion des brouillons

### [MOYENNE] M1 -- Race condition sur la sauvegarde du brouillon

**Code** : `app/sell/details.tsx:124-148` -- L'auto-save utilise `draft` de l'etat local. Stale closure sur `draft` si deux saves partent en parallele.

**Impact** : Perte occasionnelle de donnees lors de la saisie rapide.

**Recommandation** : Utiliser `draftRef` au lieu de l'etat local, ou un pattern de save queue.

---

### [MOYENNE] M2 -- Pas de cleanup Storage quand le brouillon expire cote client (user non connecte)

**Code** : `services/draftService.ts:260-261` -- Si l'utilisateur n'est pas connecte au moment ou `loadDraft` detecte l'expiration, `uid` est null et les images Storage ne sont PAS supprimees.

**Impact** : Images Storage orphelines pendant jusqu'a 24h supplementaires. Cout Storage mineur.

**Recommandation** : Acceptable avec le cleanup scheduled. Documenter le comportement.

---

### [MOYENNE] M3 -- Le brouillon ne stocke qu'un seul brouillon a la fois

**Code** : `services/draftService.ts:8` -- `DRAFT_KEY = '@article_draft'` (cle unique)

**Impact** : Un seul brouillon possible a la fois.

**Recommandation** : Limitation acceptable pour le MVP.

---

## SECTION 4 -- Upload et gestion des photos

### [MOYENNE] M4 -- Les photos ajoutees sur l'ecran photos-review ne mettent pas a jour le brouillon

**Code** : `app/sell/photos-review.tsx:247-267` -- `handleAddPhotos` met a jour `photos` (state local) mais pas de sauvegarde au brouillon.

**Impact** : Si l'utilisateur ajoute des photos sur photos-review puis ferme l'app, les nouvelles photos sont perdues.

**Recommandation** : Ajouter un effect de sauvegarde des photos dans le brouillon.

---

### [MOYENNE] M5 -- Suppression de la photo principale sans recalcul AI

**Code** : `app/sell/photos-review.tsx:280-283` -- Si l'analyse est complete et l'utilisateur supprime la photo 0, l'`aiResult` n'est pas re-genere.

**Impact** : L'AI result est potentiellement base sur une photo supprimee.

**Recommandation** : Avertir l'utilisateur ou re-lancer l'analyse.

---

### [MOYENNE] M6 -- Qualite de compression incoherente entre camera et galerie

**Code** :
- `app/sell/capture.tsx:123` -- `quality: 0.7` (camera)
- `app/sell/capture.tsx:145` -- `quality: 0.8` (galerie)

**Impact** : Incoherence mineure de qualite d'image.

**Recommandation** : Unifier la qualite a 0.8 partout.

---

## SECTION 5 -- Stripe Connect et paiements

### [MOYENNE] M7 -- Stripe onboarding UI obsolete (Standard vs Custom)

**Code** : `app/settings/stripe-onboarding.tsx:110` -- "Vous allez etre redirige vers Stripe pour completer votre inscription"

**Impact** : L'utilisateur s'attend a une redirection Stripe qui n'arrivera pas (comptes Custom).

**Recommandation** : Mettre a jour le wording.

---

### [MOYENNE] M8 -- Le seller-balance affiche "$ CA" mais le checkout affiche "X $"

**Code** :
- `utils/formatPrice.ts:6-11` -- `formatPrice` retourne `"45 $"`
- `utils/formatPrice.ts:21-23` -- `formatPriceWithCurrency` retourne `"45,00 $ CA"`

**Impact** : Confusion mineure.

**Recommandation** : Utiliser `formatPriceWithCurrency` dans les contextes financiers.

---

## SECTION 6 -- Propagation de donnees

### [MOYENNE] M9 -- sellerName/sellerImage figes a la creation de l'article

**Code** : `app/sell/preview.tsx:159-179` -- `sellerName: currentUser.displayName`, `sellerImage: currentUser.photoURL`

Un trigger `onUserProfileUpdated` existe dans `triggers/users.ts` -- verifier qu'il propage bien.

**Recommandation** : Verifier que le trigger met bien a jour `sellerName` et `sellerImage` dans tous les articles.

---

### [MOYENNE] M10 -- Le search_index n'est pas nettoye quand un article est marque vendu

**Code** : `functions/src/triggers/products.ts:38-39` -- Le search index verifie `isActive` et `moderationStatus` mais pas `isSold`.

**Impact** : Performance degradee sur les recherches full-index.

**Recommandation** : Ajouter `!articleData.isSold` a la condition du trigger.

---

## SECTION 7 -- Edge cases UX

### [MOYENNE] M11 -- Pas de protection double-tap sur le bouton ANALYSER

**Code** : `app/sell/photos-review.tsx:519` -- Le bouton ANALYSER n'a pas de `disabled` pendant le loading.

**Impact** : L'utilisateur pourrait lancer deux analyses simultanees.

**Recommandation** : Ajouter `disabled={isAnalyzing}` sur le bouton.

---

### [BASSE] B1 -- Le commentaire TODO dans storage.rules est obsolete

**Code** : `storage.rules:46-48`

**Recommandation** : Supprimer le TODO.

---

### [BASSE] B2 -- Le guide camera utilise le tutoiement et le vouvoiement de maniere incoherente

**Code** :
- `app/sell/capture.tsx:228` -- "Cadrez votre article" (vouvoiement)
- `app/sell/capture.tsx:230` -- "Ajoute un detail" (tutoiement)

**Recommandation** : Choisir tutoiement ou vouvoiement et l'appliquer uniformement.

---

### [BASSE] B3 -- Le sell flow ne verifie pas si l'utilisateur a configure une adresse d'expedition

**Code** : `functions/src/callable/payments.ts:41-48` -- `MONTREAL_FALLBACK` utilise quand le vendeur n'a pas d'adresse.

**Impact** : Les estimations de frais de port seront basees sur Montreal.

**Recommandation** : Suggerer au vendeur de configurer son adresse avant de publier.

---

### [BASSE] B4 -- Pas d'empty state explicite pour l'historique sur seller-balance quand le solde est a zero

**Code** : `app/seller-balance.tsx:393-397`

**Recommandation** : Ajouter un CTA vers le sell flow dans l'empty state.

---

### [BASSE] B5 -- Le `Dimensions.get('window').width` est appele au top level dans preview.tsx

**Code** : `app/sell/preview.tsx:27`

**Recommandation** : Utiliser `useWindowDimensions()`.

---

## SECTION 8 -- Flow de creation complet

| Etape | Ecran | Validations front | Validations back |
|-------|-------|-------------------|------------------|
| 0 | sell.tsx | Auth check (_layout.tsx) | - |
| 1 | capture.tsx | >= 1 photo, <= 5 photos | - |
| 2 | photos-review.tsx | Photos presentes, AI ou manual | - |
| 3 | details.tsx | titre non-vide, description non-vide, categorie selectionnee | - |
| 4 | pricing.tsx | prix 0.01-10000, >= 1 mode livraison | - |
| 5 | preview.tsx | titre >= 3 chars, prix > 0, <= 10000, >= 1 image, >= 1 categorie | CF: auth, email_verified, titre >= 3, prix 0.01-10000, >= 1 image (max 10), condition valide, >= 1 categorie |

**Gaps** :
1. Pas de check `email_verified` en front (H4)
2. Description requise en front mais optionnelle en back (H8)
3. Limite 5 photos front vs 10 back (H1)
4. Description max 500 front vs 5000 back (H2)
5. Preview accepte prix > 0 mais back exige >= 0.01 (H3)
