# RAPPORT D'AUDIT -- Flow d'Achat (Cote Acheteur)

## Resume executif

| Severite | Nombre |
|----------|--------|
| CRITIQUE | 3 |
| HAUTE | 6 |
| MOYENNE | 8 |
| BASSE | 4 |
| **Total** | **21** |

Les 3 findings critiques concernent des pertes financieres potentielles : le solde vendeur n'est pas reverse lors de l'expiration de transactions payees (argent bloque a jamais), les statuts `disputed` et `refunded` sont absents du type TypeScript front (crash potentiel des ecrans), et la condition article utilise des accents dans le code TypeScript mais pas dans le schema Firestore (creation d'articles rejetee par les rules).

---

## SECTION 1 -- Etats et transitions

### [CRITIQUE] Expiration de transactions payees sans reversal du seller_balance (perte d'argent)

**Scenario** : Vendeur ne ship pas pendant 7 jours. La transaction passe de `paid` a `cancelled` par `expireOrphanedTransactions`. L'article est relibere (`isSold: false`). Mais le `seller_balance.pendingBalance` qui a ete credite par le webhook `payment_intent.succeeded` n'est PAS debite.

**Code** :
- `functions/src/scheduled/transactionExpiration.ts:159-187` -- cancelle la transaction et relibere l'article, mais ne touche jamais a `seller_balances`
- `functions/src/http/webhooks.ts:262-280` -- credite `pendingBalance` lors du paiement

Le webhook credite `pendingBalance += sellerPayout` au moment du paiement. Quand la transaction expire 7 jours plus tard, ce pending balance reste. L'argent du buyer a ete capture par Stripe mais aucun refund n'est initie, et le seller balance montre un montant fantome en pending qui ne sera jamais debloque (puisque la transaction est cancelled, pas delivered).

**Impact** : Double probleme -- (1) l'acheteur a ete debite mais ne recevra ni article ni remboursement automatique, (2) le vendeur voit un `pendingBalance` fantome qui ne deviendra jamais available et qu'il ne peut pas retirer.

**Recommandation** : Dans `expireOrphanedTransactions` pour les transactions `paid`, ajouter un `FieldValue.increment(-sellerPayout)` sur `seller_balances/{sellerId}.pendingBalance` et initier un refund Stripe via `stripe.refunds.create()`.

---

### [CRITIQUE] Statuts `disputed` et `refunded` absents du type TypeScript front

**Scenario** : Stripe envoie un webhook `charge.dispute.created` ou `charge.refunded`. Le backend met a jour le statut en `disputed` ou `refunded`. L'acheteur ouvre "Mes commandes" -- le composant `OrderCard` cherche `STATUS_LABELS[transaction.status]` et obtient `undefined` car ces statuts n'existent pas dans le mapping.

**Code** :
- `types/index.ts:243-251` -- `TransactionStatus` n'inclut ni `disputed` ni `refunded`
- `app/my-orders.tsx:40-49` -- `STATUS_LABELS` ne contient que 8 statuts (manque `disputed`, `refunded`)
- `app/my-sales.tsx:41-49` -- meme lacune
- `functions/src/http/webhooks.ts:569` -- ecrit `status: 'disputed'`
- `functions/src/http/webhooks.ts:629` -- ecrit `status: 'refunded'`
- `firestore-schema.md:427-429` -- documente correctement `disputed` et `refunded` dans le schema

**Impact** : L'acheteur et le vendeur voient un statut vide/undefined pour les transactions en litige ou remboursees. Pas de crash React (undefined.label retourne undefined, pas d'exception), mais affichage casse : pas de label, pas de couleur de dot.

**Recommandation** : Ajouter `'disputed'` et `'refunded'` au type `TransactionStatus` dans `types/index.ts`, et ajouter les entrees correspondantes dans les `STATUS_LABELS` de `my-orders.tsx` et `my-sales.tsx`.

---

### [HAUTE] Aucune expiration pour les transactions `meetup_confirmed`

**Scenario** : Le vendeur confirme un meetup (statut `meetup_confirmed`). Le buyer ne vient jamais au meetup et ne confirme jamais la reception via `completeMeetupTransaction`. La transaction reste en `meetup_confirmed` indefiniment. L'article est marque vendu (`isSold: true`) pour toujours.

**Code** :
- `functions/src/scheduled/transactionExpiration.ts` -- expire `meetup_pending` (48h), `pending_payment` (1h), `paid` (7d) mais ne traite PAS `meetup_confirmed`
- `functions/src/callable/payments.ts:1338-1339` -- `completeMeetupTransaction` requiert le statut `meetup_confirmed`, seul le buyer peut appeler

**Impact** : L'article est bloque comme "vendu" pour toujours si le buyer ne complete pas le meetup. Le vendeur peut annuler manuellement (cf. `cancelPendingTransaction` qui accepte `meetup_confirmed`), mais rien ne l'automatise.

**Recommandation** : Ajouter une 4eme section dans `expireOrphanedTransactions` pour expirer les `meetup_confirmed` plus anciennes que, par exemple, 7 jours.

---

### [HAUTE] Meetup transactions : totalAmount inclut le prix mais le seller_balance est credite sans qu'aucun paiement ne transite par la plateforme

**Scenario** : Un acheteur cree un meetup. La Cloud Function `createTransaction` cree la transaction avec `serviceFee: 0` et `totalAmount: amount` (le prix de l'article). Le vendeur confirme le meetup. Le buyer appelle `completeMeetupTransaction` qui credite `availableBalance += sellerPayout` dans `seller_balances`.

Mais pour un meetup, aucun paiement Stripe n'a eu lieu. Le paiement est en cash/main propre. Le `availableBalance` credite represente une "dette" fictive de la plateforme envers le vendeur, sans aucun fonds reel pour la couvrir.

**Code** :
- `functions/src/callable/payments.ts:334` -- `fee = deliveryType === 'meetup' ? 0 : calculateServiceFee(amount)`
- `functions/src/callable/payments.ts:1353-1408` -- `completeMeetupTransaction` credite `availableBalance` et `totalEarnings`
- Le message systeme dit : "Les fonds ont ete transferes au vendeur" (ligne 1430)

**Impact** : Si le vendeur tente un retrait (`requestWithdrawal`), la plateforme tenterait un Stripe Payout sur son connected account. Mais aucun fonds n'a ete collecte via Stripe pour les meetups. Le payout echouerait avec "insufficient funds on connected account". Le vendeur est induit en erreur par le message "fonds transferes".

**Recommandation** : Soit ne pas crediter le seller_balance pour les meetups (c'est du cash en main), soit separer clairement les "meetup earnings" (statistique non-retirable) des "shipping earnings" (retirables via Stripe). Le champ `totalMeetupEarnings` existe deja, mais le `availableBalance` melange les deux.

---

## SECTION 2 -- Coherence front/back

### [HAUTE] `article.location` est un `string` (legacy) mais le checkout shipping le traite comme un code postal

**Scenario** : Le checkout shipping tente d'extraire le code postal du vendeur depuis `article.location` en testant `CA_POSTAL_RE.test(article.location.trim())`. Mais `article.location` est type `string | undefined` (legacy) et contient typiquement le nom de la ville (ex: "Montreal"), pas un code postal.

**Code** :
- `types/index.ts:113` -- `location?: string; // Ville ou code postal (legacy)`
- `app/checkout/shipping.tsx:103-106` -- teste si `article.location` est un code postal, sinon utilise `DEFAULT_SELLER_POSTAL_CODE`
- `firestore-schema.md:76-84` -- le champ `location` dans articles est un objet `{ city?, postalCode?, province?, coordinates?, geohash? }`, pas un string

Le type TypeScript (`string`) et le schema Firestore (objet) sont incoherents. Le checkout shipping essaie de traiter un objet ou un string comme un code postal. Dans la plupart des cas, le fallback `DEFAULT_SELLER_POSTAL_CODE = 'H2S3C4'` sera utilise, ce qui signifie que les estimations de livraison sont toujours calculees depuis Montreal, meme si le vendeur est a Vancouver.

**Impact** : Les frais de livraison affiches a l'acheteur sont inexacts pour les vendeurs hors Montreal. L'acheteur paie plus ou moins que le cout reel.

**Recommandation** : Lire `article.location.postalCode` (quand c'est un objet) ou le code postal depuis l'adresse du vendeur dans le document `users/{sellerId}`.

---

### [HAUTE] `TransactionService.createShippingTransaction` passe `buyerId` et `sellerId` au client mais la CF les ignore

**Scenario** : Le client passe `buyerId` et `sellerId` a `createShippingTransaction` et `createMeetupTransaction`. La Cloud Function `createTransaction` ignore ces champs -- elle utilise `request.auth.uid` comme `buyerId` et `articleData.sellerId` comme `sellerId` (lignes 184, 229, 340).

**Code** :
- `services/transactionService.ts:24-33` -- accepte `buyerId` et `sellerId` comme parametres
- `services/transactionService.ts:40-48` -- ne les envoie PAS dans le payload callable
- `functions/src/callable/payments.ts:184` -- `const buyerId = request.auth.uid`
- `functions/src/callable/payments.ts:340` -- `sellerId: articleData.sellerId`

Les parametres `buyerId`/`sellerId` de la methode client sont des vestiges d'un ancien code.

**Impact** : API trompeuse -- un developpeur pourrait croire que ces parametres sont utilises et compter dessus. Pas de risque de securite immediat.

**Recommandation** : Retirer les parametres `buyerId` et `sellerId` de `createShippingTransaction` et `createMeetupTransaction` dans le service client.

---

### [MOYENNE] Le client passe `serviceFee` a `createTransaction` mais la CF le recalcule cote serveur

**Code** :
- `services/transactionService.ts:45` -- envoie `serviceFee: serviceFee || 0`
- `functions/src/callable/payments.ts:334` -- recalcule `calculateServiceFee(amount)` cote serveur

**Impact** : Le `serviceFee` envoye par le client est ignore (bon pour la securite). Mais l'API client est trompeuse.

**Recommandation** : Supprimer le parametre `serviceFee` de `TransactionService.createShippingTransaction`.

---

## SECTION 3 -- Edge cases non geres

### [HAUTE] Vendeur supprime son article pendant qu'une transaction `paid` existe

**Scenario** : L'acheteur a paye. La transaction est en statut `paid`. Le vendeur clique "Supprimer". `ArticlesService.deleteArticle` fait `isActive: false`. Cela ne casse pas la transaction directement, mais :
1. L'article n'apparait plus dans la recherche
2. Le `my-orders` affiche "Article indisponible"
3. Si le seller ne ship pas dans 7 jours, `expireOrphanedTransactions` tente `batch.update(articleRef, { isSold: false })` sur un article soft-deleted

**Code** :
- `features/article/hooks/useArticleActions.ts:225-250` -- deleteArticle sans verification de transactions actives
- `services/articlesService.ts:530-536` -- deleteArticle = soft delete (`isActive: false`)
- `functions/src/callable/payments.ts:224-225` -- createTransaction verifie `isActive === false` et bloque, mais une transaction DEJA creee n'est pas protegee

**Impact** : UX degradee pour l'acheteur. Potentiellement confus si le seller veut annuler la transaction en supprimant l'article.

**Recommandation** : Empecher la suppression d'un article qui a des transactions actives (pending_payment, paid, shipped, meetup_pending, meetup_confirmed).

---

### [HAUTE] Fallback rateId dans les estimations shipping cree des labels impossibles

**Scenario** : Si `getShippingEstimate` echoue, le client affiche `FALLBACK_ESTIMATES` avec des rateIds `fallback_standard` et `fallback_express`. L'acheteur selectionne un de ces fallback, paie, et la transaction est creee avec `shipEngineRateId: 'fallback_standard'`. Le webhook detecte le prefix `fallback_` et skip la creation de label, flaggant `labelCreationPending: true`.

**Code** :
- `features/checkout-shipping/types.ts:33-52` -- `FALLBACK_ESTIMATES` avec `rateId: 'fallback_standard'`
- `functions/src/http/webhooks.ts:321-330` -- detecte et skip les fallback rateIds

**Impact** : L'acheteur a paye mais aucune etiquette n'est generee. L'intervention humaine est requise. Le montant paye (8.50$ ou 14.50$) peut ne pas correspondre au cout reel.

**Recommandation** : Soit empecher la selection d'un fallback rate, soit creer un job schedule qui retente la creation de labels.

---

### [MOYENNE] Pas de verification que l'article est encore `isActive` au moment du checkout client

**Code** :
- `app/checkout/index.tsx:138-151` -- verifie `isSold` mais pas `isActive`
- `app/checkout/meetup.tsx:280-293` -- idem
- `app/checkout/shipping.tsx:353-367` -- idem

La CF `createTransaction` verifie bien `isActive === false` (ligne 225), donc la transaction serait rejetee. Mais l'acheteur fait tout le flow checkout avant de voir l'erreur.

**Impact** : UX frustrante.

**Recommandation** : Ajouter une verification `!article.isActive` dans les guards des ecrans checkout.

---

### [MOYENNE] Seller balance : `totalEarnings` n'est pas incremente pour les seller_balances existantes lors du paiement

**Code** :
- `functions/src/http/webhooks.ts:262-279` :
  - Pour un NOUVEAU seller_balance (ligne 267) : `totalEarnings: sellerPayout` est initialise
  - Pour un seller_balance EXISTANT (lignes 275-278) : seul `pendingBalance` est incremente. `totalEarnings` n'est PAS incremente.

Cependant, quand la transaction est delivered, `totalEarnings: FieldValue.increment(actualPayout)` est appele. Donc pour les NEW seller_balances, la premiere vente compte les earnings au paiement, les suivantes a la livraison.

**Impact** : Le `totalEarnings` est incoherent pour la premiere vente.

**Recommandation** : Ne pas initialiser `totalEarnings: sellerPayout` a la creation. Initialiser a 0.

---

### [MOYENNE] Le prix affiche dans "Mes ventes" montre `totalAmount` au vendeur

**Code** : `app/my-sales.tsx:88` -- `formatPrice(transaction.totalAmount)`

**Impact** : Le vendeur pense qu'il va recevoir le totalAmount (ex: 54$) alors qu'il ne recevra que le prix article (ex: 45$).

**Recommandation** : Afficher `transaction.amount` ou `transaction.sellerPayout` au lieu de `transaction.totalAmount`.

---

### [MOYENNE] `getTransactionByChat` n'inclut pas `meetup_completed` dans les statuts recherches

**Code** : `services/transactionService.ts:156-163` -- `allowedStatuses` n'inclut pas `meetup_completed`

**Impact** : Apres un meetup complete, le chat perd la reference a la transaction.

**Recommandation** : Ajouter `meetup_completed` a `allowedStatuses`.

---

### [MOYENNE] System message dit "fonds transferes au vendeur" pour les meetups sans paiement plateforme

**Code** : `functions/src/callable/payments.ts:1430`

**Impact** : Aucun fonds n'a ete "transfere" car le paiement est en main propre.

**Recommandation** : Changer le message en "Rencontre confirmee ! La transaction est terminee." sans mention de transfert.

---

### [MOYENNE] Pas de notification push a l'acheteur quand le meetup expire (48h)

**Code** :
- `functions/src/scheduled/transactionExpiration.ts:48-96` -- expire meetup_pending sans notification
- `functions/src/scheduled/transactionExpiration.ts:192-208` -- expire paid avec notification

**Impact** : L'acheteur ne sait pas que son meetup a expire. Il peut se rendre au lieu de rencontre sans savoir que la transaction est annulee.

**Recommandation** : Ajouter un `sendPushNotification` au buyer dans le bloc d'expiration des meetup_pending.

---

## SECTION 4 -- Coherence locale Canada

### [BASSE] `formatPrice` ne respecte pas completement la norme canadienne-francaise

**Code** : `utils/formatPrice.ts:6-11`

**Impact** : Mineur. L'affichage est globalement correct pour le Canada francophone.

**Recommandation** : Utiliser `formatPriceWithCurrency` dans les contextes financiers (checkout, balance).

---

### [BASSE] Province par defaut manquante dans le formulaire d'adresse

**Code** :
- `features/checkout-shipping/types.ts:30` -- `province: ''` dans `INITIAL_ADDRESS`
- `app/checkout/shipping.tsx:184-187` -- `canPay` ne requiert pas `province`

**Impact** : Les estimations utilisent le fallback `QC` pour les acheteurs hors Quebec.

**Recommandation** : Ajouter la province comme champ obligatoire dans `canPay`.

---

### [BASSE] Wording "Remboursement si l'article ne correspond pas" sans politique de retour

**Code** : `app/payment/[transactionId].tsx:248-249`

**Impact** : Promesse UX non tenue. Aucun flow de retour/remboursement n'est implemente.

**Recommandation** : Modifier le wording pour etre plus honnete ("Paiement securise par Stripe").

---

### [BASSE] Le checkout shipping affiche "A partir de 8,50 $" en dur

**Code** : `app/checkout/index.tsx:253` -- `formatPrice(8.50)` en dur

**Impact** : Trompeur si les frais reels sont superieurs.

**Recommandation** : Afficher "Frais de livraison calcules a l'etape suivante".

---

## SECTION 5 -- Diagramme des etats de transaction

```
SHIPPING FLOW:
  pending_payment ──[buyer pays]──> paid ──[webhook + label]──> shipped ──[tracking DELIVERED]──> delivered
       |                              |                                         |
       |                              |                                         └──[dispute]──> disputed
       |                              |                                         └──[refund]──> refunded
       |                              └──[7d no ship / expiry]──> cancelled [BUG: no balance reversal, no refund]
       └──[1h expiry / buyer cancel / payment_failed]──> cancelled

MEETUP FLOW:
  meetup_pending ──[seller confirms]──> meetup_confirmed ──[buyer completes]──> meetup_completed
       |                                       |
       └──[48h expiry / cancel]──> cancelled   └──[cancel]──> cancelled
                                               └──[BUG: no auto-expiry]──> stuck forever
```

Etats terminaux : `delivered`, `meetup_completed`, `cancelled`, `disputed`, `refunded`
Etats actifs : `pending_payment`, `paid`, `shipped`, `meetup_pending`, `meetup_confirmed`
