## 09. Remise en main propre (meetup)

La **remise en main propre** (« meetup ») est l'un des deux modes de transaction de Second, à côté de la livraison expédiée. C'est le mode où l'acheteur et le vendeur se rencontrent physiquement pour échanger l'article et **régler le paiement en argent comptant, directement entre eux**. Ce point est fondamental pour comprendre toutes les règles de gestion : **aucun argent ne transite par la plateforme dans un meetup.** Il n'y a donc ni encaissement Stripe, ni séquestre, ni remboursement automatique, ni écriture dans le portefeuille vendeur. Le meetup est un **pur cash-in-hand** : Second sert à mettre les deux parties en relation, à convenir d'un point de rencontre, à suivre l'état de la transaction et à offrir un recours en cas de problème — mais la plateforme ne touche pas un dollar.

Cette caractéristique entraîne une conséquence commerciale directe : **le meetup est gratuit pour les deux parties.** Aucuns frais de plateforme, aucuns frais de livraison, aucune commission. Le montant payé en main propre est exactement le prix convenu.

---

### 9.1. Vue d'ensemble du parcours

Le meetup se déroule en quatre temps, qui correspondent aux quatre statuts successifs de la transaction :

| Étape | Statut technique | Qui agit | Ce qui se passe |
|-------|------------------|----------|-----------------|
| 1. Demande de rencontre | `meetup_pending` | Acheteur | L'acheteur choisit un lieu et déclenche la demande ; l'article est réservé (marqué vendu). |
| 2. Confirmation | `meetup_confirmed` | Vendeur | Le vendeur confirme le rendez-vous (lieu + date/heure convenus en messagerie). |
| 3. Finalisation | `meetup_completed` | Acheteur **ou** vendeur | L'une des deux parties confirme que l'échange a bien eu lieu. État terminal positif. |
| (3 bis) Incident | `disputed` ou `cancelled` | Système / une partie | No-show signalé → litige ; ou expiration automatique → annulation. |

Toute la coordination concrète (« où exactement ? », « à quelle heure ? ») se fait **par messagerie**, dans le fil de discussion (chat) lié à l'article. La transaction sert de squelette d'état ; le chat porte la conversation.

---

### 9.2. Point de départ : choisir un lieu de rencontre

Deux portes d'entrée mènent au meetup.

**A. Depuis la fiche article — bouton de rencontre / écran « Lieu de rencontre »**
L'acheteur arrive sur l'écran `app/checkout/meetup.tsx`, intitulé **« Lieu de rencontre »**. Cet écran :

- Affiche un récapitulatif de l'article (photo, marque, titre, prix). Si un **prix négocié** a été accepté en amont, l'écran affiche le prix négocié, le prix d'origine barré, et un badge **« PRIX NÉGOCIÉ »** ; un badge **« MEETUP »** est toujours présent.
- Propose les **lieux suggérés par le vendeur** (« preferred meetup spots ») s'il en a enregistré. Chaque lieu affiche son nom, sa catégorie (ex. lieu public, station de métro, café, etc., via des libellés FR) et le quartier.
- Propose **toujours** une option de repli : **« À convenir par messagerie »** (« Vous choisirez le lieu avec le vendeur après confirmation »). Cette option est sélectionnable même si le vendeur n'a renseigné aucun lieu.
- Présélectionne automatiquement le premier lieu suggéré s'il en existe, sinon l'option « à convenir ».
- Une boîte d'information rappelle que **la date et l'heure se conviennent ensuite par messagerie** (et que le lieu aussi, si l'option « à convenir » est choisie).

Le bouton **« CONFIRMER LE MEETUP »** déclenche la création de la transaction.

**B. Depuis le chat — offre de meetup**
L'acheteur peut aussi envoyer directement une **offre de meetup** dans la conversation (montant + lieu), via le module d'offre. Le vendeur reçoit une bulle d'offre interactive (`OfferBubble`) qu'il peut accepter, refuser ou contrer (contre-offre de prix, de lieu, ou d'horaire).

**Garde-fous à l'entrée (écran meetup)** — avant même de confirmer, l'écran bloque les cas impossibles :
- Utilisateur **non connecté** → redirection vers l'accueil.
- Article **introuvable** → message « Article introuvable ».
- Article **déjà vendu** (`isSold`) → écran « Cet article n'est plus disponible / Il a déjà été vendu ».
- **Le vendeur ne peut pas acheter son propre article** → « Vous ne pouvez pas acheter votre propre article ».
- Acheteur et vendeur **mutuellement bloqués** (modération) → « Vous ne pouvez pas acheter cet article. »

---

### 9.3. Confirmation côté acheteur → création de la transaction

Quand l'acheteur confirme le meetup, l'app enchaîne :

1. **Vérification de blocage** entre les deux comptes (modération).
2. **Création ou récupération du chat** entre acheteur et vendeur pour cet article.
3. **Création de la transaction meetup** via la Cloud Function `createTransaction` (mode `deliveryType = 'meetup'`).
4. **Envoi d'une offre de meetup structurée** dans le chat (bulle interactive). Si l'option « à convenir » a été choisie, le lieu est posé en placeholder « À convenir ».
5. **Rafraîchissement de l'accueil** pour que l'article réservé disparaisse des listes.
6. **Redirection vers l'écran de succès** (récap : titre, montant, lieu, lien vers le chat).

**Côté serveur (`createTransaction`)**, la création est **atomique** (`runTransaction` via le SDK Admin) — c'est ce qui garantit qu'**un seul acheteur peut réserver un article donné**, même si deux personnes confirment au même instant. Les contrôles serveur :

- Article existe, **non vendu** (`isSold !== true`), **actif** (`isActive !== false`).
- L'acheteur **n'est pas** le vendeur.
- **Contrôle du montant** : le prix payé doit être soit le prix affiché, soit un **prix négocié adossé à une offre acceptée** par le vendeur pour cet acheteur/article (sinon refus). Tout montant **supérieur** au prix affiché est rejeté (protection contre le sur-paiement).
- **Différence clé avec la livraison** : pour un meetup, le serveur **n'exige PAS** que le vendeur ait un compte de paiement Stripe actif. C'est logique — aucun argent ne passe par la plateforme. (À l'inverse, une vente expédiée exige un compte Stripe vendeur opérationnel.)

À la création, le serveur :
- Marque l'article **vendu** (`isSold = true`) → il est retiré de la vente le temps de la rencontre.
- Pose le statut **`meetup_pending`**.
- Calcule les montants : **`serviceFee = 0`**, **`shippingCost = 0`**, donc **`totalAmount = montant convenu`**. Le champ `sellerPayout` est égal au montant, mais il n'a **aucune portée financière** ici (aucun crédit n'aura lieu) ; c'est un simple champ de données.
- Enregistre le **lieu de rencontre** (`meetupSpot` : nom, catégorie, quartier, et éventuellement adresse / coordonnées) en nettoyant les champs vides (Firestore refuse les valeurs `undefined`).
- Lie la transaction au **chat** (`chatId`).

**Si la confirmation échoue** (ex. l'article vient d'être vendu par quelqu'un d'autre), l'erreur serveur remonte telle quelle à l'acheteur (« Cet article a déjà été vendu ») et le ramène en arrière.

---

### 9.4. Confirmation côté vendeur (`meetup_pending` → `meetup_confirmed`)

Après réception de la demande, **le vendeur** confirme le rendez-vous depuis la bulle d'offre du chat (bouton de confirmation, ex. « J'ai rencontré l'acheteur » / confirmation du meetup). L'app :

- Pose `confirmedAt` sur l'offre du message.
- Fait passer la transaction liée de **`meetup_pending`** à **`meetup_confirmed`**.
- Poste un message système récapitulant le lieu et la date/heure convenue (format canadien-français, ex. « le 12/06/2026 à 14:30 »), ou « à une date à convenir ».

**Règle de gestion forte (sécurité Firestore)** : la transition `meetup_pending → meetup_confirmed` est **réservée au vendeur**. Les règles Firestore exigent explicitement que l'auteur de la mise à jour soit le `sellerId` de la transaction. Un acheteur ne peut pas auto-confirmer un rendez-vous.

Si le vendeur **refuse** l'offre, la transaction associée (qu'elle soit `meetup_pending` ou déjà `meetup_confirmed`) est **annulée** (`cancelled`), ce qui **relibère l'article**.

---

### 9.5. Finalisation (`meetup_confirmed` → `meetup_completed`)

Une fois la rencontre faite et l'argent remis, la transaction doit être marquée **terminée**. C'est l'état terminal positif, qui notamment **débloque la possibilité de laisser un avis** (review) sur l'autre partie.

**Qui peut finaliser ?** — La Cloud Function `completeMeetupTransaction` autorise **l'acheteur OU le vendeur** à confirmer la complétion. C'est un choix de conception assumé : la rencontre est un acte à deux où les deux personnes étaient physiquement présentes. Si seul l'acheteur pouvait finaliser et qu'il « disparaissait » après coup, la transaction resterait bloquée en `meetup_confirmed` pour toujours (« transaction zombie ») et l'article resterait invendable. Permettre aux deux parties de finaliser évite ce blocage.

Effet serveur de `completeMeetupTransaction` :
- Vérifie que l'appelant est **bien partie à la transaction** (acheteur ou vendeur), sinon refus (`permission-denied`).
- Vérifie que le statut est **bien `meetup_confirmed`**, sinon refus (`failed-precondition`).
- Passe le statut à **`meetup_completed`**, pose `completedAt`, `meetupCompletedAt`, et `meetupCompletedBy` (qui a finalisé).
- **N'écrit AUCUN crédit vendeur, AUCUN ledger.** (Réaffirmé en commentaire : « paiement cash hors-ligne pur ».)
- Poste un message système dans le chat : *« Rencontre confirmée ! La transaction est terminée. Le paiement a été réglé en main propre entre l'acheteur et le vendeur. »*

**Côté interface (bulle d'offre)**, les boutons apparaissent de façon contextuelle :
- Le **vendeur** voit le bouton de confirmation tant que l'offre est acceptée, qu'il s'agit bien d'un meetup, et que ni `confirmedAt` ni `completedAt` ne sont posés.
- L'**acheteur** voit le bouton « Terminer la transaction » (« Confirmez-vous que la remise en main propre a bien eu lieu ? ») une fois le rendez-vous **confirmé** (`confirmedAt` posé) et avant complétion.

> **Note d'implémentation honnête** : depuis l'interface chat, la finalisation est principalement portée par l'action « terminer » côté acheteur (`completeMeetup`), qui appelle bien la Cloud Function. La règle « acheteur **ou** vendeur peut finaliser » est garantie au niveau serveur ; c'est aussi cette ouverture qui rend possible le filet de sécurité du planificateur (voir §9.7).

---

### 9.6. No-show : l'autre partie ne s'est pas présentée

Un meetup peut échouer si l'une des parties **ne se présente pas**, annule à la dernière minute, ou si la situation est jugée non sécuritaire. Second prévoit un **signalement de no-show**.

**Le traitement « avec effet » est porté par la Cloud Function `reportMeetupNoShow`.** Quand elle est invoquée :
- L'appelant doit être **partie à la transaction** (acheteur ou vendeur) — un no-show peut venir de l'un ou de l'autre côté.
- La transaction doit être **un meetup** et dans un état **encore ouvert** : `meetup_pending` ou `meetup_confirmed` (on ne signale pas un no-show sur une transaction déjà terminée, annulée ou en litige — idempotence).
- **Motifs acceptés** : `other_party_no_show` (l'autre ne s'est pas présenté), `cancelled_last_minute` (annulation de dernière minute), `unsafe_situation` (situation non sécuritaire), `other` (autre). Un motif inconnu retombe sur « no-show ». Un texte libre de détails (max 1000 caractères) peut être joint.

Effets (le tout **atomique**, sans mouvement d'argent puisque c'est du cash) :
1. **Gel de la transaction** au statut **`disputed`** (`disputed = true`), avec mémorisation du statut précédent (`statusBeforeDispute`) pour qu'un administrateur puisse comprendre le contexte. La transaction ne peut plus être finalisée et ne bloque plus l'article comme « active ».
2. **Libération de l'article** (`isSold = false`) → le vendeur peut le re-lister / re-vendre.
3. **Ouverture d'un dossier de litige** (`disputes`) de type `meetup_no_show`, en statut `open`, enregistrant **qui a signalé qui** (`reportedBy` / `reportedAgainst`), le motif, les détails, et les références (transaction, article). C'est le **recours pour les deux parties** : le plaignant expose sa version, et la personne visée peut **contester auprès de l'administration** (voie de révision humaine — voir Loi 25, §9.8).
4. **Notification push** à la personne visée : *« Un no-show a été signalé pour … Notre équipe va examiner la situation. Si vous contestez ce signalement, vous pouvez nous le signaler. »*
5. Un signal d'alerte est journalisé pour le tableau de bord de modération.

**Limite produit actuelle (à connaître).** L'interface du chat câble aujourd'hui le **signalement « cosmétique »** (`ChatService.reportNoShow`) : un bouton **« Signaler une absence »** affiche une alerte de confirmation, écrit un marqueur sur le message de chat et poste « No-show signalé. Notre équipe va examiner la situation. » **Ce chemin d'interface ne déclenche pas (encore) la Cloud Function `reportMeetupNoShow`** : il ne gèle pas la transaction, ne libère pas l'article et n'ouvre pas de dossier de litige automatiquement. La logique serveur « avec effet » existe, est testée et déployable, mais n'est pas branchée sur le bouton du chat à ce jour. Concrètement, un no-show signalé depuis le chat **alerte verbalement** mais **ne débloque pas automatiquement l'article** ; le déblocage repose alors sur l'**expiration automatique** (§9.7) ou un traitement manuel. C'est un écart connu entre la capacité backend et le câblage frontend.

---

### 9.7. Expiration automatique (filet de sécurité anti-blocage)

Un planificateur (`scheduled/transactionExpiration.ts`, exécuté **toutes les heures**) nettoie les transactions « orphelines » qui ne sont jamais arrivées à terme. Deux cas concernent le meetup. **Comme un meetup n'implique aucun argent, ces expirations n'entraînent jamais de remboursement et ne touchent jamais le portefeuille.**

| Cas | Condition | Délai | Action |
|-----|-----------|-------|--------|
| Rendez-vous jamais confirmé | Statut `meetup_pending` | **48 h** après création | Annulation (`cancelled`, motif `meetup_expired_48h`) + libération de l'article. **L'acheteur** est notifié. |
| Rencontre confirmée mais jamais finalisée (« zombie ») | Statut `meetup_confirmed` | **7 jours** après création | Annulation (`cancelled`, motif `meetup_confirmed_expired_7d`) + libération de l'article. **Les deux parties** sont notifiées. |

Pourquoi deux délais ? Une demande non confirmée sous **48 h** signifie que le vendeur n'a pas donné suite : on libère vite l'article. Une rencontre **confirmée** mérite une fenêtre plus généreuse (**7 jours**), car les parties ont pu convenir d'une date plusieurs jours plus tard ; au-delà, on considère la rencontre abandonnée et on relibère l'article pour qu'il ne reste pas invendable. La branche `meetup_confirmed` re-vérifie le statut **sous verrou** (transaction atomique) pour rester idempotente si une partie finalise/annule entre la requête et l'écriture.

Chaque expiration est **journalisée comme décision automatisée** (conformité Loi 25, voir §9.8) et accompagnée d'une **notification push** expliquant que l'annulation est **automatique** et **contestable**. Exemples de messages :
- meetup non confirmé : *« Votre commande … a été annulée automatiquement : le rendez-vous n'a pas été confirmé dans les délais (48 h). Si vous contestez cette décision, vous pouvez nous le signaler. »*
- rencontre non finalisée : *« La rencontre pour « … » a été annulée automatiquement : elle n'a pas été finalisée dans les délais (7 jours). … »*

---

### 9.8. Spécificités Canada

- **Devise** : tous les montants sont en **dollars canadiens (CAD)**, affichés au format local (ex. « 45 $ »). Le paiement en main propre se fait en argent comptant CAD, de la main à la main, hors plateforme.
- **Lieux et quartiers** : les points de rencontre suggérés sont structurés par quartier / arrondissement (modèle pensé pour des villes canadiennes), avec des catégories de lieux publics (sécurité des rencontres : privilégier des endroits passants).
- **Conformité Loi 25 (Québec — protection des renseignements et décisions automatisées)** : toute **annulation automatique** d'un meetup par le planificateur est (a) **journalisée** comme décision automatisée (type, critères, fenêtre de délai, résultat), et (b) **notifiée** à la/aux personne(s) concernée(s) avec la mention explicite que la décision est **automatique** et qu'elle peut être **contestée** (droit à une révision humaine). De même, un **litige de no-show** ouvre un dossier où la personne visée **peut contester** auprès d'un humain. Cette transparence et ce droit de recours sont intégrés au cœur du flux, pas en option.

---

### 9.9. Spécificités iOS / Android

Le parcours meetup est **identique sur iOS et Android** (mêmes écrans, mêmes statuts, mêmes Cloud Functions). Les seuls points sensibles relèvent des notifications et de l'affichage des feuilles :

- **Notifications push** (no-show signalé, annulations automatiques) : leur livraison dépend des autorisations de notification accordées par l'utilisateur sur son appareil. Sur iOS, les notifications nécessitent un consentement explicite ; si l'utilisateur l'a refusé, il ne recevra pas l'alerte push (l'état reste néanmoins consultable dans l'app via le chat et l'historique de commandes). Les notifications sont **best-effort** : un échec d'envoi n'empêche jamais l'action métier (annulation, gel, libération de l'article) de s'effectuer.
- **Feuilles / bottom sheets** (sélection de motif, confirmations) : Second utilise un montage des feuilles à l'ouverture pour éviter, **côté Android**, un voile transparent qui bloquerait scroll et clics. Cela n'affecte pas le déroulé métier, seulement l'ergonomie.

---

### 9.10. Récapitulatif des règles de gestion

- Meetup = **paiement comptant entre les parties**, **0 $ de frais**, **aucun argent via la plateforme**, **aucun remboursement** (rien à rembourser).
- L'article est **réservé** (`isSold = true`) dès la demande, et **relibéré** en cas de refus, de no-show traité, ou d'expiration automatique.
- Réservation **atomique** côté serveur : **un seul acheteur** gagne un article donné.
- Un meetup **n'exige pas** que le vendeur ait un compte de paiement Stripe (contrairement à la livraison).
- Transitions de statut :
  - `meetup_pending → meetup_confirmed` : **vendeur uniquement** (règle Firestore).
  - `meetup_confirmed → meetup_completed` : **acheteur ou vendeur** (Cloud Function), pour éviter les transactions zombies.
  - vers `disputed` : via signalement de no-show (Cloud Function `reportMeetupNoShow`).
  - vers `cancelled` : refus d'offre, ou expiration automatique (48 h non confirmé / 7 jours non finalisé).
- La **finalisation débloque l'avis** (review) sur l'autre partie ; un meetup non finalisé ne permet pas d'avis.
- **Limite connue** : le bouton de no-show du chat utilise aujourd'hui le chemin **cosmétique** (alerte + message), pas la Cloud Function « avec effet » ; le déblocage automatique de l'article repose donc sur l'expiration programmée.
- Conformité **Loi 25** : décisions automatiques journalisées + notifiées + contestables ; litiges ouverts avec droit de réponse de la partie visée.
