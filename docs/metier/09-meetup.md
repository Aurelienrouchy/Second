## 09. Remise en main propre (meetup)

La **remise en main propre** (« meetup ») est le mode où l'acheteur et le vendeur se rencontrent physiquement pour échanger l'article et **régler le paiement directement entre eux**, hors plateforme. Ce point est fondamental pour comprendre toutes les règles de gestion : **aucun argent ne transite par Second dans un meetup.** Il n'y a ni encaissement Stripe, ni séquestre, ni remboursement automatique, ni écriture dans le portefeuille vendeur. Second sert à mettre les deux parties en relation, à convenir d'un point de rencontre, à suivre l'état de la transaction et à offrir un recours en cas de problème — mais la plateforme ne touche pas un dollar.

Conséquence commerciale directe : **le meetup est gratuit pour les deux parties.** Aucuns frais de plateforme, aucuns frais de livraison, aucune commission. Le montant remis en main propre est exactement le prix convenu.

**Aujourd'hui, le meetup est le SEUL parcours d'achat actif.** La livraison expédiée est désactivée par un drapeau produit (`SHIPPING_ENABLED = false` dans `config/featureFlags.ts`), et l'écran de choix du mode de livraison bascule automatiquement tout le monde en main-à-main. Tout ce chapitre décrit donc le parcours d'achat réel de la bêta.

---

### 9.1. Vue d'ensemble du parcours

Le meetup se déroule en quatre temps. **Attention : le premier temps ne crée aucune transaction.** Une demande de rencontre est, techniquement et commercialement, une **offre envoyée dans la messagerie**. La transaction n'existe qu'au moment où l'autre partie **accepte** cette offre.

| Étape | Statut technique | Qui agit | Ce qui se passe |
|-------|------------------|----------|-----------------|
| 0. Demande | *(aucune transaction)* | Acheteur | Une offre de rencontre (montant + lieu) est postée dans le chat. **L'article reste en vente.** L'offre expire d'elle-même au bout de 48 h. |
| 1. Acceptation | `meetup_pending` | La partie qui n'a PAS émis l'offre | L'offre passe à « acceptée », **la transaction naît**, et **l'article est réservé** (marqué vendu) au même instant. |
| 2. Confirmation du rendez-vous | `meetup_confirmed` | Vendeur | Le vendeur confirme le rendez-vous (lieu, et date/heure si elle a été fixée). |
| 3. Finalisation | `meetup_completed` | Acheteur **ou** vendeur | L'une des deux parties déclare que l'échange a eu lieu. État terminal positif : il débloque l'avis. |
| (3 bis) Incident | `disputed` ou `cancelled` | Une partie / le système | Absence signalée → litige et libération de l'article ; ou expiration automatique → annulation et libération de l'article. |

Toute la coordination concrète (« où exactement ? », « à quelle heure ? ») se fait **par messagerie**, dans le fil de discussion lié à l'article. La transaction sert de squelette d'état ; le chat porte la conversation **et toutes les actions** : les boutons de confirmation, de finalisation et de signalement d'absence n'existent **que** dans la bulle d'offre du chat.

---

### 9.2. Point de départ : proposer une rencontre

Deux portes d'entrée mènent au meetup. **Les deux aboutissent au même objet : une offre dans le chat.**

**A. Depuis le bouton d'achat — écran « Lieu de rencontre »**
Le bouton d'achat de la fiche article mène à l'écran de commande, qui bascule automatiquement en main-à-main, puis à l'écran **« Lieu de rencontre »** (`app/checkout/meetup.tsx`). Cet écran :

- Affiche un récapitulatif de l'article (photo, marque, titre, prix). Si un **prix négocié** a été transmis, l'écran affiche le prix négocié, le prix d'origine barré et un badge **« PRIX NÉGOCIÉ »** ; un badge **« MEETUP »** est toujours présent.
- Propose une liste de **lieux suggérés par le vendeur** — voir la limite ci-dessous.
- Propose **toujours** une option de repli : **« À convenir par messagerie »** (« Vous choisirez le lieu avec le vendeur après confirmation »), sélectionnable en toutes circonstances.
- Présélectionne le premier lieu suggéré s'il en existe, sinon l'option « à convenir ».
- Rappelle dans un encart que **la date et l'heure se conviennent ensuite par messagerie**.

> **Trou produit à connaître.** Le champ « lieux suggérés par le vendeur » (`preferredMeetupSpots`) est **lu** par trois écrans mais **n'est écrit nulle part** : le parcours de mise en vente ne propose aucune interface pour enregistrer des points de rencontre. Le vendeur ne peut renseigner que ses **quartiers** (affichés sur la fiche article). En pratique, l'écran « Lieu de rencontre » n'affiche donc jamais de lieux suggérés et l'acheteur atterrit systématiquement sur « À convenir par messagerie ». Soit on branche une saisie côté vendeur, soit on retire la promesse de l'écran.

Le bouton **« CONFIRMER LE MEETUP »** **n'ouvre aucune commande** : il crée (ou récupère) la conversation avec le vendeur, y poste une **offre de rencontre** au prix affiché ou négocié, et redirige vers un écran de succès intitulé **« Demande envoyée »** (« Votre demande de rencontre a été envoyée au vendeur. Vous serez notifié·e dès qu'il l'aura acceptée »). L'article **reste en vente** pendant ce temps.

**B. Depuis la fiche article ou le chat — offre de rencontre**
L'acheteur peut composer une offre complète via le module d'offre (feuille en trois étapes : montant → lieu → confirmation) :
- **Montant** : libre entre 1 $ et 50 000 $. L'écran affiche le prix demandé et le pourcentage de réduction.
- **Lieu** : choix d'un **quartier** puis d'un **lieu populaire** de ce quartier (catalogue interne), ou saisie d'un lieu personnalisé avec sa catégorie (café, station de métro, bibliothèque, centre commercial, parc, centre communautaire, autre lieu public).
- **Aucune date/heure** n'est demandée à ce stade : une offre part toujours « à une date à convenir ».

Le vendeur reçoit une bulle d'offre interactive dans le chat, qu'il peut **accepter**, **refuser** ou **contrer** — contre-offre de **prix**, de **lieu** ou d'**horaire** (l'horaire ne peut donc être fixé formellement que par une contre-offre). Chaque contre-offre repart pour 48 h. Symétriquement, l'acheteur peut accepter une contre-offre du vendeur.

**Garde-fous à l'entrée (écran « Lieu de rencontre »)** :
- Utilisateur **non connecté** → redirection vers l'accueil.
- Article **introuvable** → « Article introuvable ».
- Article **déjà vendu** → « Cet article n'est plus disponible / Il a déjà été vendu ».
- **Le vendeur ne peut pas acheter son propre article** → message bloquant.
- Acheteur et vendeur **mutuellement bloqués** (modération) → contrôle effectué **au moment du clic** sur « Confirmer le meetup » : « Vous ne pouvez pas acheter cet article. »

---

### 9.3. Acceptation de l'offre → naissance de la transaction

C'est **l'acceptation** qui crée la transaction, pas la demande. Le traitement est entièrement porté par une Cloud Function (`functions/src/callable/payments/meetup.ts`, fonction `acceptMeetupOffer`) et s'exécute **de façon atomique** : en une seule opération indivisible, le serveur passe l'offre à « acceptée », **réserve l'article** et **crée la transaction**. C'est ce qui garantit qu'**un seul acheteur peut réserver un article donné**, même si deux personnes acceptent au même instant.

Contrôles serveur avant acceptation :

- Le message est bien une **offre de rencontre** de cette conversation, et son statut est **encore « en attente »** (on ne peut pas accepter deux fois).
- L'offre **n'est pas expirée** (au-delà de 48 h, elle bascule en « expirée » et l'acceptation est refusée).
- **Qui est qui est déduit de l'article, jamais de l'expéditeur** : le vendeur est le propriétaire de l'article, l'acheteur est l'autre participant du chat. C'est ce qui permet à l'acheteur d'accepter une contre-offre du vendeur.
- **On ne peut pas accepter sa propre offre** : l'acceptant doit être la partie qui n'a pas émis l'offre.
- **Montant** : strictement positif et **inférieur ou égal au prix affiché**. Un montant supérieur est refusé (protection contre le sur-paiement).
- Article **actif** et **non vendu**.
- **L'acheteur a toujours un compte.** Avant toute écriture, le serveur relit le document de l'acheteur — déduit de l'article, comme plus haut, jamais de l'expéditeur — et refuse si le compte a disparu : « Cette personne a supprimé son compte : son offre ne peut plus être acceptée. » Sans cette garde, accepter l'offre d'un compte fermé verrouillerait l'article jusqu'à 48 h au profit de personne. Le vendeur, lui, n'est pas relu : c'est le propriétaire de l'article.
- **Différence clé avec la livraison** : pour un meetup, le serveur **n'exige PAS** que le vendeur ait un compte de paiement Stripe. C'est logique — aucun argent ne passe par la plateforme.

> **Piège produit.** Le module d'offre laisse saisir un montant **jusqu'à 50 000 $**, sans le plafonner au prix demandé, alors que le serveur refuse toute acceptation au-dessus du prix affiché. Une offre « au-dessus du prix » est donc envoyée normalement mais **impossible à accepter** : le vendeur reçoit une erreur incompréhensible. À corriger côté saisie.

À la création, la transaction porte : **frais de service = 0**, **frais de livraison = 0**, donc **total = montant convenu**. Le champ « versement vendeur » est égal au montant mais n'a **aucune portée financière** : aucun crédit n'aura lieu. Le **lieu de rencontre** est recopié depuis l'offre (nom, catégorie, quartier, et éventuellement adresse / coordonnées), et la transaction est liée au **chat**.

**Effet de bord immédiat de la réservation** : dès que l'article est marqué vendu, **toutes les autres offres en attente sur cet article, dans toutes les conversations, sont automatiquement expirées**, avec un message système : « Cet article a été vendu. Les offres en attente ont été annulées. » Les autres acheteurs ne restent donc pas avec une offre fantôme.

**Si l'acceptation échoue** (article vendu entre-temps, offre expirée, montant trop élevé), le message d'erreur du serveur remonte tel quel dans le chat.

*Note technique mineure* : la réutilisation d'une transaction existante pour ce couple chat + acheteur + article (cas des commandes pré-créées par le checkout direct) est bornée aux deux statuts **vivants** d'une rencontre, `meetup_pending` et `meetup_confirmed`. Une transaction gelée par un no-show (`disputed`) ou une vente déjà conclue (`meetup_completed`) n'est **pas** réutilisée : l'acceptation repasse par le chemin normal, qui exige un article **non vendu**, le reverrouille et crée une vraie nouvelle transaction. C'est ce qui permet aux deux parties de reconvenir d'une rencontre après un signalement d'absence — celui-ci relibère l'article (§9.6) — au lieu de se raccrocher à un dossier gelé qu'aucune des deux ne pouvait finaliser.

---

### 9.4. Confirmation du rendez-vous (`meetup_pending` → `meetup_confirmed`)

Une fois la transaction née, **le vendeur** doit confirmer le rendez-vous depuis la bulle d'offre du chat (bouton **« Confirmer »**). Une Cloud Function (`confirmMeetupTransaction`) effectue en **une seule opération atomique** : le passage de la transaction en `meetup_confirmed` (avec l'horodatage et l'identité du confirmant) **et** l'apposition de la marque de confirmation sur le message d'offre. Un message système est ensuite posté dans le chat : « Meetup confirmé! » suivi du lieu et de la date au format canadien-français (« le 12/06/2026 à 14:30 ») ou « à une date à convenir ».

**Règle de gestion forte : cette transition est réservée au vendeur.** Elle est verrouillée à deux niveaux — la Cloud Function refuse tout appelant qui n'est pas le vendeur de la transaction, et les règles de sécurité Firestore n'autorisent, pour un client, qu'une seule écriture directe sur une transaction : exactement ce passage `meetup_pending → meetup_confirmed` par le vendeur. Un acheteur ne peut pas auto-confirmer un rendez-vous.

> **Deux actions successives pour le vendeur.** Quand c'est l'acheteur qui a envoyé l'offre, le vendeur doit **d'abord l'accepter**, **puis appuyer sur « Confirmer »**. Ce sont bien deux gestes distincts (l'acceptation crée la commande, la confirmation acte le rendez-vous), mais rien à l'écran ne l'explique.
>
> **Libellé trompeur.** La boîte de dialogue de ce bouton demande : « Confirmez-vous que le meetup a bien eu lieu et que la transaction est terminée ? » — alors qu'à ce stade la rencontre **n'a pas encore eu lieu** : on ne fait que confirmer le rendez-vous. Le texte doit être réécrit.

**Refus de l'offre.** Tant que l'offre est « en attente », l'autre partie peut la **refuser** : l'offre passe à « refusée », un message système est posté, et si une transaction de rencontre lui était liée (cas hérité), elle est **annulée** via la Cloud Function d'annulation, ce qui **relibère l'article**.

> **Sortir d'une rencontre sans accuser personne.** Une fois l'offre acceptée, le bouton « Refuser » disparaît, mais un lien discret **« Annuler la rencontre »** reste offert **aux deux parties** tant que la rencontre est vivante (`meetup_pending` comme `meetup_confirmed`). Il appelle la Cloud Function d'annulation, qui **libère l'article**, **éteint la bulle d'offre** — ses boutons ne survivent pas à la sortie — et **n'ouvre aucun litige**. Un message système l'annonce : *« Rencontre annulée d'un commun accord. L'article est de nouveau en vente. »*
>
> C'est volontairement une action **secondaire** dans la hiérarchie visuelle : « Confirmer » reste le geste attendu. Avant son ajout, se désister obligeait soit à **signaler une absence** — donc à mettre en cause l'autre personne, §9.6 — soit à **attendre l'expiration automatique**, §9.7.

---

### 9.5. Finalisation (`meetup_confirmed` → `meetup_completed`)

Une fois la rencontre faite et l'argent remis, la transaction doit être marquée **terminée**. C'est l'état terminal positif, qui **débloque la possibilité de laisser un avis** sur l'autre partie (fenêtre de 60 jours après la finalisation) et qui fait apparaître la commande comme « Réglée en main propre » dans *Mes commandes* / *Mes ventes*.

**Qui peut finaliser ?** — **L'acheteur OU le vendeur**, aussi bien côté serveur que dans l'interface. C'est un choix de conception assumé : la rencontre est un acte à deux, les deux personnes étaient physiquement présentes. Si seul l'acheteur pouvait finaliser et qu'il disparaissait après coup, la transaction resterait bloquée en `meetup_confirmed` pour toujours (« transaction zombie ») et l'article resterait invendable.

Effet serveur (`completeMeetupTransaction`) :
- Vérifie que l'appelant est **bien partie à la transaction** (acheteur ou vendeur), sinon refus.
- Vérifie que le statut est **bien `meetup_confirmed`**, sinon refus.
- Passe le statut à **`meetup_completed`** et pose les horodatages, dont l'identité de celui qui a finalisé.
- **N'écrit AUCUN crédit vendeur, AUCUNE ligne de portefeuille** — paiement comptant hors-ligne pur.
- Poste un message système : *« Rencontre confirmée ! La transaction est terminée. Le paiement a été réglé en main propre entre l'acheteur et le vendeur. »*

**Côté interface (bulle d'offre)**, les boutons apparaissent de façon contextuelle :
- Le **vendeur** voit « Confirmer » (= confirmer le rendez-vous) tant que l'offre est acceptée et que le rendez-vous n'est pas encore confirmé.
- Une fois le rendez-vous confirmé, **l'acheteur ET le vendeur** voient « Confirmer » (= « Terminer la transaction / Confirmez-vous que la remise en main propre a bien eu lieu ? »), jusqu'à la finalisation. Un badge « Transaction terminée » remplace ensuite les boutons.
- L'ordre des opérations est protégé par le serveur lui-même : dans **une seule transaction indivisible**, `completeMeetupTransaction` passe le statut à `meetup_completed`, marque le message d'offre (`offer.status = 'completed'`, `offer.meetup.completedAt`) et écrit le message système de clôture. Le client n'écrit plus rien sur la bulle : il la marquait auparavant lui-même après l'appel, et un échec réseau laissait une rencontre finalisée côté serveur avec une bulle offrant encore des boutons inopérants. Il ne poste plus, après coup, que le second message système de l'app (« Transaction complétée avec succès ! Merci d'utiliser Second. »), dont l'échec est sans conséquence. Si la transaction a été annulée automatiquement ou gelée entre-temps, l'appel échoue en bloc, l'erreur du serveur est affichée telle quelle et rien n'est marqué à tort.

> **À noter** : le même libellé « Confirmer » sert aux deux étapes (confirmer le rendez-vous, puis confirmer que l'échange a eu lieu). C'est une source de confusion évitable.
>
> **Aucune notification push n'est envoyée** lors de la confirmation du rendez-vous ni de la finalisation : seul un message système apparaît dans le chat. Les notifications push existent pour l'offre reçue, acceptée, refusée, contrée, pour le signalement d'absence et pour les annulations automatiques — pas pour ces deux étapes-là.

---

### 9.6. Absence signalée (« no-show »)

Un meetup peut échouer si l'une des parties **ne se présente pas**, annule à la dernière minute, ou si la situation est jugée non sécuritaire. Le bouton **« Signaler une absence »** de la bulle d'offre appelle **bien la Cloud Function `reportMeetupNoShow`**, qui a de vrais effets.

Conditions d'acceptation du signalement :
- L'appelant doit être **partie à la transaction** (acheteur ou vendeur) — une absence peut venir de l'un comme de l'autre.
- La transaction doit être **une rencontre** et dans un état **encore ouvert** : `meetup_pending` ou `meetup_confirmed`. On ne signale pas une absence sur une transaction déjà terminée ou annulée. Sur une transaction **déjà en litige**, un second signalement du même signaleur reste refusé (idempotence), mais celui de la partie **accusée** est accepté — une seule fois — comme **contre-déclaration** : elle ne change ni le statut, ni le verrou de l'article, et n'ouvre pas de second dossier ; elle est enregistrée sur la transaction, rattachée au dossier de litige déjà ouvert (qui reste ouvert), et le premier signaleur reçoit une notification « Signalement contesté ».
- **Motifs acceptés côté serveur** : absence de l'autre partie, annulation de dernière minute, situation non sécuritaire, autre. Un texte libre de détails (1000 caractères max) peut être joint ; un motif inconnu retombe sur « absence de l'autre partie ».

Effets, le tout **atomique** et **sans aucun mouvement d'argent** :
1. **Gel de la transaction** au statut **`disputed`**, avec mémorisation du statut précédent pour qu'un administrateur comprenne le contexte, et enregistrement du rapport (qui a signalé qui, motif, détails, date). La transaction ne peut plus être finalisée.
2. **Libération de l'article** → le vendeur peut le remettre en vente immédiatement.
3. **Ouverture d'un dossier de litige** de type « rencontre manquée », en statut ouvert, avec les deux parties, le motif, les détails et les références (transaction, article). Il apparaît dans la console d'administration.
4. **Notification push** à la personne visée : *« Un no-show a été signalé pour … Notre équipe va examiner la situation. Si vous contestez ce signalement, vous pouvez nous le signaler. »* Elle ouvre la **conversation**, et non « Mes achats » — une liste vide pour un vendeur accusé —, c'est-à-dire l'endroit exact où se trouve le droit de réponse. Si le signalement est ensuite contesté, le premier signaleur reçoit à son tour une notification **« Signalement contesté »**.
5. Une alerte est journalisée pour le tableau de bord de modération.

**Limites produit à connaître.**
- **Un seul motif est réellement proposé.** L'interface n'affiche pas de sélecteur : elle envoie systématiquement « l'autre personne ne s'est pas présentée », avec un texte de détails figé. Les trois autres motifs (annulation de dernière minute, situation non sécuritaire, autre) existent côté serveur mais sont **inatteignables depuis l'app**.
- **L'acheteur ne peut pas signaler avant la confirmation du rendez-vous.** Pendant `meetup_pending`, les boutons de la bulle d'offre ne s'affichent que pour le **vendeur** ; l'acheteur ne voit « Signaler une absence » qu'après que le vendeur a confirmé. Un vendeur qui accepte puis disparaît sans jamais confirmer laisse donc l'acheteur sans recours autre que l'expiration à 48 h.
- **La contestation tient en un bouton, sans écran dédié.** La bulle d'offre affiche **« Donner ma version »** à la partie **visée** par le signalement, et à elle seule. Le serveur enregistre cette contre-déclaration **une seule fois**, sans changer le statut, sans retoucher l'article et sans rouvrir le dossier : elle est écrite sur la transaction (`counterReport`) et reportée sur le dossier de litige (`counterReportedBy`, `counterReason`, `counterDetails`), et le premier signaleur reçoit une notification « Signalement contesté ». Le texte de la réponse est **figé** (« Je conteste ce signalement : je me suis présenté au rendez-vous. ») : aucune saisie libre. Deux réserves, toutes deux à lever. Côté client, la transaction est encore résolue parmi les seuls statuts `meetup_pending` / `meetup_confirmed`, alors que le signalement l'a passée en `disputed` : le bouton remonte donc une erreur tant que cette résolution n'est pas élargie. Et la console d'administration n'affiche toujours que le premier récit (`reason`, `details`) — les champs `counter*` sont écrits mais lus par personne, si bien que l'administrateur ne voit pas encore les deux versions. Le support par courriel (`contact@seconde.ca`, accessible depuis Réglages → Aide) reste le canal pour tout le reste.
- **Les outils de résolution de l'administrateur restent ceux du rail payant, sans traitement dédié à la rencontre.** Sur un litige « rencontre manquée », la console propose **« Clôturer (acheteur) »** — et non « Rembourser l'acheteur » comme sur un litige de livraison — avec une boîte de dialogue qui précise qu'aucun argent n'a transité par la plateforme, qu'il n'y a donc rien à rembourser, et que l'article restera en vente. La seconde action, **« Clôturer (vendeur) »**, restaure le statut de rencontre d'avant le litige **et rallume la bulle d'offre** (le marqueur d'absence est effacé dans la même transaction, sans quoi la rencontre repartait sans qu'aucune des deux parties puisse la finaliser), mais **sans re-réserver l'article** — libéré au signalement, il peut déjà avoir été vendu à quelqu'un d'autre. Les deux actions passent par les Cloud Functions de paiement (`adminRefundTransaction`, `resolveDispute`) ; un traitement dédié « rencontre manquée » reste à écrire.

---

### 9.7. Expiration automatique (filet de sécurité anti-blocage)

Un planificateur (`functions/src/scheduled/transactionExpiration.ts`, exécuté **toutes les heures**) nettoie les transactions « orphelines » qui ne sont jamais arrivées à terme. Deux cas concernent le meetup. **Comme un meetup n'implique aucun argent, ces expirations n'entraînent jamais de remboursement et ne touchent jamais le portefeuille.**

| Cas | Condition | Délai | Action |
|-----|-----------|-------|--------|
| Rendez-vous jamais confirmé | Statut `meetup_pending` | **48 h** après la **création de la transaction** (donc après l'acceptation de l'offre) | Annulation + libération de l'article. **L'acheteur** est notifié. |
| Rencontre confirmée mais jamais finalisée (« zombie ») | Statut `meetup_confirmed` | **7 jours** après la **création de la transaction** (et non après la confirmation) | Annulation + libération de l'article. **Les deux parties** sont notifiées. |

Pourquoi deux délais ? Une commande non confirmée sous **48 h** signifie que le vendeur n'a pas donné suite : on libère vite l'article. Une rencontre **confirmée** mérite une fenêtre plus généreuse (**7 jours**), car les parties ont pu convenir d'une date plusieurs jours plus tard ; au-delà, on considère la rencontre abandonnée et on relibère l'article pour qu'il ne reste pas invendable. Les deux branches revérifient le statut **sous verrou** avant d'écrire, pour rester sans effet si une partie confirme, finalise ou annule entre la lecture et l'écriture.

> **Point d'attention sur les 7 jours** : le compte à rebours part de la **création** de la transaction, pas de la confirmation du rendez-vous. Un rendez-vous accepté le 1er et fixé au 9 sera annulé automatiquement le 8, avant même d'avoir eu lieu. Les deux parties peuvent alors relancer une offre, mais le comportement surprend.

À ne pas confondre avec l'**expiration des offres** : une offre restée « en attente » plus de **48 h** est basculée en « expirée » par un autre planificateur horaire (et l'acceptation la refuse de toute façon). Ce sont deux compteurs de 48 h distincts — l'un avant l'acceptation, l'autre après.

Chaque expiration de rencontre est **journalisée comme décision automatisée** (conformité Loi 25, §9.8) et accompagnée d'une **notification push** expliquant que l'annulation est **automatique** et **contestable** :
- rendez-vous non confirmé : *« Votre commande … a été annulée automatiquement : le rendez-vous n'a pas été confirmé dans les délais (48 h). Si vous contestez cette décision, vous pouvez nous le signaler. »*
- rencontre non finalisée : *« La rencontre pour « … » a été annulée automatiquement : elle n'a pas été finalisée dans les délais (7 jours). … »*

---

### 9.8. Spécificités Canada

- **Devise** : tous les montants sont en **dollars canadiens**, affichés au format local (ex. « 45 $ »), dates et heures au format `fr-CA`. Le paiement en main propre se fait en argent comptant, de la main à la main, hors plateforme.
- **Couverture géographique réellement codée : Montréal.** Le catalogue de quartiers et de lieux populaires est **exclusivement montréalais** (`data/neighborhoods.ts` : arrondissements Ville-Marie, Plateau, Rosemont, Villeray, Côte-des-Neiges, Sud-Ouest, Verdun, Ahuntsic, Montréal-Nord, Saint-Léonard, etc.), et l'écran de commande l'annonce : « Rencontrez le vendeur dans un lieu public **à Montréal** ». Ouvrir une autre ville demandera d'étendre ce catalogue.
- **Sécurité des rencontres** : les catégories de lieux proposées sont toutes des **lieux publics** (café, station de métro, bibliothèque, centre commercial, parc, centre communautaire, autre lieu public) — le modèle pousse vers des endroits passants, sans jamais l'imposer (un lieu personnalisé reste saisissable en texte libre).
- **Conformité Loi 25 (Québec — décisions automatisées)** : toute **annulation automatique** d'une rencontre par le planificateur est (a) **journalisée** comme décision automatisée (type, critères, fenêtre de délai, résultat) et (b) **notifiée** à la ou aux personnes concernées avec la mention explicite que la décision est **automatique** et **contestable**. Ce recours est **réellement branché dans l'app** : sur une commande de type rencontre, un encart « décision automatisée » apparaît avec l'explication et un bouton de contestation qui ouvre une demande de révision humaine.
- **En revanche**, un **litige d'absence** (§9.6) n'est toujours pas journalisé comme décision automatisée. La personne visée dispose désormais d'un droit de réponse **dans l'app** — le bouton « Donner ma version » de la bulle d'offre, utilisable une seule fois, joint au dossier — mais pas de la demande de révision humaine formelle qu'ouvrent les annulations automatiques. L'asymétrie subsiste, réduite.

---

### 9.9. Spécificités iOS / Android

Le parcours meetup est **identique sur iOS et Android** (mêmes écrans, mêmes statuts, mêmes Cloud Functions). Les seuls points sensibles sont périphériques :

- **Notifications push** (offre reçue/acceptée/refusée/contrée, absence signalée, annulations automatiques) : leur livraison dépend des autorisations accordées sur l'appareil. Sur iOS, elles exigent un consentement explicite ; si l'utilisateur l'a refusé, il ne recevra pas l'alerte, mais l'état reste consultable dans l'app (chat, historique de commandes, cloche de notifications). Les envois sont **best-effort** : un échec n'empêche jamais l'action métier (gel, libération de l'article, annulation) de s'effectuer.
- **Confirmations d'action** : les dialogues de confirmation, de finalisation et de signalement d'absence sont des **alertes système natives**, pas des feuilles maison — comportement identique sur les deux plateformes.
- **Feuille « Faire une offre »** : c'est une feuille glissante (bottom sheet) **montée uniquement à l'ouverture**, précisément pour éviter, côté Android, un voile transparent qui bloquerait scroll et clics. Cela n'affecte pas le déroulé métier, seulement l'ergonomie.

---

### 9.10. Récapitulatif des règles de gestion

- Meetup = **paiement comptant entre les parties**, **0 $ de frais**, **aucun argent via la plateforme**, **aucun remboursement** (rien à rembourser). C'est aujourd'hui le **seul parcours d'achat actif** (livraison désactivée par drapeau).
- Une demande de rencontre est **une offre dans le chat**. Elle **ne réserve pas** l'article et **expire au bout de 48 h**.
- La **transaction naît à l'acceptation de l'offre**, par la partie qui ne l'a pas émise. L'article est **réservé** au même instant, de façon **atomique** : **un seul acheteur** gagne un article donné. Toutes les autres offres en attente sur cet article sont alors automatiquement expirées.
- Un meetup **n'exige pas** que le vendeur ait un compte de paiement Stripe (contrairement à la livraison).
- Le montant accepté doit être **≤ prix affiché** (le sur-paiement est refusé côté serveur).
- Transitions de statut :
  - création → `meetup_pending` : **acceptation de l'offre** (Cloud Function).
  - `meetup_pending → meetup_confirmed` : **vendeur uniquement** (Cloud Function + règle Firestore).
  - `meetup_confirmed → meetup_completed` : **acheteur ou vendeur** (Cloud Function), pour éviter les transactions zombies.
  - vers `disputed` : **signalement d'absence** par l'une des parties (Cloud Function, avec libération de l'article et ouverture d'un litige).
  - vers `cancelled` : **annulation à l'amiable par l'une des deux parties** (Cloud Function, depuis la bulle d'offre), refus d'une offre encore en attente, ou expiration automatique (48 h non confirmé / 7 jours non finalisé, comptés depuis la création). Dans les trois cas l'article est libéré et la bulle d'offre est éteinte, pour que ses boutons ne survivent pas à la sortie.
- La **finalisation débloque l'avis** sur l'autre partie (fenêtre de 60 jours) ; une rencontre non finalisée ne permet aucun avis.
- Conformité **Loi 25** : décisions automatiques journalisées, notifiées et **contestables depuis l'app** ; litiges d'absence ouverts avec droit de réponse **dans l'app** (bouton « Donner ma version », réservé à la partie visée, une seule fois), mais sans journalisation comme décision automatisée.

**Trous produit ouverts, à trancher :**

> **Deux décisions attendent le fondateur**, documentées là où elles se jouent :
> le **compteur de signalements d'absence abusifs** (seuil, sanction, visibilité) en §11.10, et la
> **pseudonymisation ou non des transactions** à la fermeture d'un compte en §17.12.

1. Le vendeur **ne peut pas enregistrer de lieux de rencontre** : l'écran acheteur promet des « lieux suggérés » qui n'existeront jamais.
2. ~~**Aucune annulation à l'amiable** après acceptation~~ — **comblé.** Les deux parties disposent désormais d'un lien « Annuler la rencontre » dans la bulle d'offre, tant que la rencontre est vivante : il libère l'article, éteint la bulle et n'accuse personne. Se désister n'oblige donc plus à signaler une absence.
3. L'acheteur **ne peut pas signaler une absence** tant que le vendeur n'a pas confirmé le rendez-vous.
4. **Un seul motif d'absence** est atteignable depuis l'app sur les quatre prévus.
5. Le module d'offre **laisse dépasser le prix affiché**, produisant une offre que le vendeur ne peut pas accepter.
6. Le libellé « Confirmer » sert aux **deux étapes** (rendez-vous puis échange), et le texte de la première dialogue annonce à tort que « le meetup a bien eu lieu ».
7. Le compteur des **7 jours part de la création**, pas de la date convenue : un rendez-vous lointain est annulé avant d'avoir lieu.
8. La **résolution d'un litige d'absence par l'administrateur** n'a toujours pas d'outillage dédié : les libellés disent désormais la vérité (« Clôturer (acheteur) », aucun argent en jeu), mais clore en faveur du vendeur restaure le statut sans re-réserver l'article. La **contestation**, elle, existe : la partie visée donne sa version une fois depuis la bulle d'offre.
