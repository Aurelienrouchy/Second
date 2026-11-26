## 07. Offres & négociation

Second permet à un acheteur potentiel de **proposer son propre prix** sur un article plutôt que de payer le prix affiché, puis d'entrer dans une **négociation** avec le vendeur directement dans la messagerie. C'est le cœur de l'expérience « marché aux puces » de l'app : on discute, on marchande, on s'entend sur un prix et un lieu, puis on conclut. Cette section décrit le parcours complet, les règles de gestion, les statuts d'une offre, les conditions/limites, et les spécificités Canada / iOS-Android.

> Note de cadrage produit : aujourd'hui, l'app fonctionne **en mode « remise en main propre » (meetup) uniquement**. Deux drapeaux le verrouillent dans `config/featureFlags.ts` : `SHIPPING_ENABLED = false` (livraison) et `PAYMENTS_ENABLED = false` (paiement in-app). Les éléments liés à la livraison et au paiement par carte sont donc décrits ci-dessous comme « présents dans le code mais inactifs ». Concrètement, toute nouvelle offre passe par le parcours meetup, et le règlement d'une offre acceptée se fait **de la main à la main** lors de la rencontre — l'app n'encaisse rien et ne prélève rien.

---

### 7.1. À quoi sert une offre

- Sur la fiche d'un article, l'acheteur dispose d'un bouton **« OFFRE »**, à côté du bouton d'achat (libellé **« PROPOSER UN ACHAT »** tant que la livraison est coupée).
- Une offre = un **montant proposé** (en dollars canadiens), accompagné d'un **message optionnel** au vendeur, et — en mode meetup — d'un **lieu de rencontre** proposé.
- L'offre apparaît ensuite comme une **bulle spéciale dans la conversation** entre l'acheteur et le vendeur (différente d'un simple message texte). Toute la négociation se déroule dans ce fil de discussion.
- Le destinataire peut **accepter**, **refuser**, ou **contre-proposer** (autre prix, autre lieu, autre horaire). À chaque contre-offre, le ballon repart dans l'autre camp — et **les deux parties** peuvent contre-proposer, pas seulement le vendeur.

Une offre n'est donc pas un achat : c'est une **proposition d'accord**. Tant qu'elle n'est pas acceptée, rien n'est réservé ni payé. L'article n'est bloqué **qu'au moment de l'acceptation**.

> Point produit à connaître : **une offre envoyée ne peut pas être retirée**. Son auteur ne voit aucun bouton sur sa propre bulle ; il doit attendre la réponse de l'autre partie ou l'expiration à 48 h.

---

### 7.2. Où et comment se déclenche une offre

Il existe **trois chemins** qui créent une offre dans le fil de discussion :

| Point d'entrée | Comportement |
|---|---|
| **Fiche article** — bouton « OFFRE » | Ouvre le formulaire d'offre. À l'envoi, la conversation avec le vendeur pour cet article est créée ou réutilisée, l'offre y est postée, puis l'app redirige vers le chat. |
| **Conversation existante** — bouton « $ » de la barre de saisie | Ouvre directement le formulaire d'offre dans le fil en cours. Le bouton n'apparaît que si la conversation est rattachée à un article. |
| **Bouton d'achat** — « PROPOSER UN ACHAT » → choix du lieu (`app/checkout/meetup.tsx`) | **Ce n'est pas un achat immédiat** : l'écran envoie lui aussi une offre meetup dans le chat, **au prix affiché**, avec le message « Demande de meetup pour "…" ». L'acheteur choisit un lieu parmi ceux du vendeur ou « À convenir par messagerie ». Aucune transaction n'est créée à cet instant. |

Le formulaire (chemins 1 et 2) est une **fenêtre coulissante (bottom sheet)** en plusieurs étapes, avec un indicateur de progression « ÉTAPE X SUR Y ».

**Garde-fous au déclenchement** — ils ne sont **pas les mêmes selon le point d'entrée** :

| Garde-fou | Depuis la fiche article | Depuis la conversation |
|---|---|---|
| Article vendu | Oui — « Cet article a déjà été vendu. » | Oui — « Cet article n'est plus disponible. » |
| Article désactivé / retiré | **Non vérifié** | Oui — « Cet article n'est plus disponible. » |
| Son propre article | Oui — « Vous ne pouvez pas faire une offre sur votre propre article. » | Sans objet (on ne discute pas avec soi-même) |
| Une offre déjà en attente du même acheteur | **Non vérifié** (le code porte un TODO explicite : le chemin fiche article ne connaît pas la conversation) | Oui — « Vous avez déjà une offre en attente pour cet article. » |
| Utilisateur bloqué | Non vérifié à l'ouverture (l'envoi échoue plus loin) | Oui — « Débloquez cet utilisateur pour faire une offre. » |

> Conséquence à assumer : **la règle « une seule offre en attente » n'est pas étanche**. Un acheteur qui repasse par la fiche article peut empiler plusieurs offres en attente sur le même article. Le blocage n'existe que dans l'écran de conversation (`app/chat/[id].tsx`).

---

### 7.3. Le formulaire d'offre, étape par étape

Le formulaire s'adapte au mode (meetup vs livraison). En meetup, il a **3 étapes** ; en livraison (inactif aujourd'hui), il en a **2** (l'étape « lieu » est sautée).

#### Étape 1 — Le montant et le message

- L'acheteur voit le **titre de l'article** et le **prix affiché** en rappel.
- Il saisit **« VOTRE OFFRE »** au pavé numérique décimal, suffixée par « $ ».
- En temps réel, l'app calcule et affiche le **pourcentage de réduction** par rapport au prix affiché (ex. « 20% de réduction »). Si la réduction dépasse **50 %**, le texte passe en **orange (avertissement visuel)**.
- Champ **message au vendeur** facultatif, limité à **500 caractères**, avec compteur (« 0/500 »).
- Un encart d'aide rappelle la suite : en meetup, « Vous proposerez ensuite un lieu de rencontre » ; en livraison, « Votre offre sera envoyée au vendeur pour validation ».

**Règles de validation du montant** (`features/offers/components/MakeOfferModal/OfferStep.tsx`) :
- Montant **vide, illisible ou inférieur à 1 $** → erreur « Veuillez entrer un montant valide » ; on ne passe pas à l'étape suivante.
- Montant **supérieur à 50 000 $** → erreur « Montant trop élevé — Maximum 50000 $ CA ». Ce plafond est aussi **imposé côté serveur** (`firestore.rules` refuse la création d'une offre hors de la plage 0 < montant ≤ 50 000).
- Montant **inférieur à 30 % du prix affiché** → alerte « Offre trop basse » : l'app suggère de réviser, mais propose **« Continuer quand même »**. C'est un garde-fou pédagogique, **pas un blocage dur**.
- Montant **supérieur au prix affiché** → refus à l'envoi : « Le vendeur demande X $. Une offre plus élevée ne pourrait pas être acceptée — proposez au maximum le prix affiché. » Le serveur refuse en effet l'acceptation d'une offre au-dessus du prix (voir 7.6) ; le contrôle est fait ici, là où l'utilisateur peut encore corriger.

#### Étape 2 (meetup uniquement) — Le lieu de rencontre

C'est la sélection du lieu où acheteur et vendeur se rencontreront. Elle se fait en deux temps :

1. **Choisir un quartier**. Le référentiel (`data/neighborhoods.ts`) contient **45 quartiers de Montréal répartis sur 22 arrondissements**. L'app propose :
   - une **barre de recherche** de quartier ;
   - en tête, la **« Zone du vendeur »** si le vendeur a renseigné son quartier, marquée d'un badge **« RECOMMANDÉ »** ;
   - sinon, la liste de **tous les quartiers**.
2. **Choisir un lieu précis** dans le quartier. L'app affiche des **lieux populaires** (cafés, stations de métro, bibliothèques, centres commerciaux, parcs, centres communautaires, autres lieux publics), avec icône par catégorie. Les lieux que le **vendeur a indiqués comme préférés** sont mis en avant avec un badge **« SUGGÉRÉ »**.
3. **Proposer un autre lieu** : si rien ne convient, l'acheteur saisit un **lieu personnalisé** (nom libre + catégorie choisie parmi les 7). Ce lieu est marqué comme « suggéré par l'utilisateur ».

> Trou produit à connaître : **seuls 10 quartiers sur 45 ont des lieux populaires pré-remplis** (25 lieux au total : Mile End, Plateau Mont-Royal, Centre-ville, Rosemont, Hochelaga, Notre-Dame-de-Grâce, Saint-Henri, Griffintown, Villeray, Petite Italie). Dans les 35 autres, l'acheteur voit « Aucun lieu populaire dans ce quartier » et doit obligatoirement saisir un lieu à la main.

> À noter : le lieu retenu hérite du quartier choisi. Il n'y a **pas de sélection de date/heure** à ce stade — la date est convenue plus tard (de vive voix dans le chat, ou via une contre-offre d'horaire). Le référentiel privilégie des **lieux publics et fréquentés** par souci de sécurité de la rencontre.

#### Étape 3 — Récapitulatif et envoi

Écran de confirmation reprenant :
- le **montant** de l'offre (gros chiffre) et le titre de l'article ;
- le **message** s'il y en a un ;
- en meetup : le **lieu de rencontre** (nom, catégorie, quartier, adresse le cas échéant) ;
- une ligne **« MONTANT A PAYER »** reprenant le montant de l'offre ;
- une mention claire : en meetup, **« Aucun frais de service — paiement en main propre lors du meetup »** ;
- un encart « Comment ça marche? » qui annonce les suites possibles (accepter / refuser / autre prix ou lieu) et **l'expiration après 48 h sans réponse**.

Le bouton **« ENVOYER L'OFFRE »** transmet l'offre. En cas de succès : retour haptique de succès + alerte « Offre envoyée » expliquant que le vendeur peut accepter, refuser ou contre-proposer. En cas d'échec : « Impossible d'envoyer votre offre. Veuillez réessayer. »

---

### 7.4. La bulle d'offre dans la conversation

Une fois envoyée, l'offre s'affiche comme une **carte d'offre** dans le fil de discussion. Elle est vue différemment selon qu'on en est l'auteur ou le destinataire :

- En-tête **« VOTRE OFFRE »** (pour l'auteur) ou **« OFFRE RECUE »** (pour l'autre partie), avec une icône et une couleur qui dépendent du statut, plus l'avatar de l'autre partie sur une offre reçue.
- En meetup, un badge **« Meetup »** et une **carte détaillant le lieu** (nom, catégorie, quartier).
- Le **montant** en évidence, avec rappel « sur un prix affiche de … ».
- Le **message** éventuel, entre guillemets.
- Un **badge de statut** (En attente / Acceptée / Refusée / …) et, tant que l'offre est en attente, un **délai d'expiration** (« Expire dans 5h 12min », « Expire dans 47min », ou « Expirée »).
- Les **boutons d'action** dépendent du statut et du rôle (voir ci-dessous).

> Nuance d'affichage : ce délai **n'est pas un compte à rebours animé**. Il est recalculé à chaque fois que la bulle est redessinée (nouveau message, retour sur l'écran). Une conversation laissée ouverte affiche donc une valeur figée jusqu'au prochain rafraîchissement.

Cette bulle est l'**unité de négociation** : chaque offre et chaque contre-offre crée une nouvelle bulle, ce qui produit un historique visuel de la négociation dans le chat. Un **message système** est inséré dans le fil à chaque étape pour rendre la négociation lisible : « Offre de 40 $ acceptée », « Offre de 40 $ refusée », « Contre-offre : 50 $ → 45 $ », « Nouveau lieu proposé : Café Olympico », « Nouvel horaire proposé: 2026-06-01 à 14 h 30 » (rendu réel de la locale `fr-CA`).

---

### 7.5. Statuts d'une offre

Une offre porte un **statut** unique à un instant donné. Les 8 statuts possibles (`types/chat.ts`) :

| Statut | Sens métier | Affichage |
|---|---|---|
| `pending` | En attente de réponse de l'autre partie | « En attente » + délai restant |
| `accepted` | Acceptée → transaction meetup ouverte | « Acceptée » (vert) |
| `rejected` | Refusée définitivement | « Refusée » (rouge) |
| `counter_price` | A donné lieu à une contre-offre de **prix** | « Contre-offre prix » |
| `counter_location` | A donné lieu à une contre-proposition de **lieu** | « Autre lieu proposé » |
| `counter_time` | A donné lieu à une contre-proposition d'**horaire** | « Autre horaire proposé » |
| `expired` | Expirée faute de réponse (ou acceptée puis jamais consommée, ou en attente / contrée quand son auteur supprime son compte) | « Expirée » (rouge) |
| `completed` | Rencontre finalisée par une des deux parties | « Terminée » (vert) |

**Logique des statuts de contre-offre** : quand on contre-propose, l'offre d'origine ne reste pas « en attente ». Elle bascule en `counter_price` / `counter_location` / `counter_time` (elle est « consommée »), et **une nouvelle bulle d'offre `pending`** est créée avec la nouvelle valeur. C'est cette nouvelle offre que l'autre partie traite. Dans une chaîne de négociation donnée, on a donc **au plus une offre active (`pending`)** — mais rien n'empêche deux chaînes parallèles si l'acheteur repasse par la fiche article (cf. 7.2).

---

### 7.6. Répondre à une offre : accepter, refuser, contre-proposer

Les boutons n'apparaissent que pour la **partie qui n'est pas l'auteur** de l'offre et **seulement tant que l'offre est `pending`**. Acheteur comme vendeur peuvent donc répondre : un vendeur qui contre-propose crée une offre que l'acheteur pourra accepter.

#### Accepter

- Confirmation par alerte (« Voulez-vous accepter cette offre de X $ ? » ; en meetup, mention « avec meetup »).
- En meetup, l'acceptation n'est **pas** faite par le téléphone : elle passe par une opération serveur unique et atomique (`acceptMeetupOffer`, dans `functions/src/callable/payments/meetup.ts`) qui, en une seule fois : marque l'offre acceptée, **bloque l'article** (marqué vendu) et **crée la transaction meetup** (statut « en attente de meetup »), avec **0 $ de frais de service** et un montant vendeur égal au montant de l'offre.
- Le serveur refuse l'acceptation, avec un message explicite dans l'app, dans tous ces cas :

| Refus serveur | Message |
|---|---|
| Offre déjà traitée (acceptée, refusée, contrée, expirée) | « Cette offre ne peut plus être acceptée (statut …) » |
| Offre au-delà de sa date limite | « Cette offre a expiré » — l'offre bascule aussitôt en `expired` |
| Tentative d'accepter **sa propre** offre | « Vous ne pouvez pas accepter votre propre offre » |
| **Compte de l'acheteur supprimé** (le vendeur accepte l'offre d'un partant) | « Cette personne a supprimé son compte : son offre ne peut plus être acceptée. » |
| **Montant supérieur au prix affiché de l'article** | « Le montant de l'offre dépasse le prix de l'article » |
| Article désactivé | « Cet article n'est plus disponible » |
| Article déjà vendu (et aucune transaction en cours pour ce duo) | « Cet article a déjà été vendu » |
| Plus de 20 tentatives d'acceptation par minute | Erreur de limitation de débit |

> *(Corrigé : une offre **supérieure au prix affiché** est désormais refusée à l'ENVOI, avec le prix demandé dans le message — « Le vendeur demande X $. Une offre plus élevée ne pourrait pas être acceptée. » Auparavant elle partait sans obstacle et restait « En attente » 48 h avec un bouton « Accepter » qui échouait à tous les coups, sans que rien n'indique la cause ni la sortie.)*

- Cas particulier prévu : si une transaction meetup **encore vivante** (« en attente de meetup » ou « meetup confirmé ») existait déjà pour ce duo et cet article (parcours « PROPOSER UN ACHAT »), le serveur **réutilise** cette transaction au lieu d'en créer une seconde, et accepte quand même l'offre. Une transaction **gelée par un signalement d'absence** ou une **vente déjà conclue** n'est plus réutilisée : le serveur repasse par le chemin normal. Après une absence signalée, l'article a été débloqué, donc l'acceptation crée une **véritable nouvelle transaction** et **reverrouille** l'article. Après une vente conclue, l'article est resté vendu : l'acceptation est **refusée** (« Cet article a déjà été vendu ») tant que le vendeur ne l'a pas remis en vente.

#### Refuser

- Confirmation par alerte. Seule une offre encore **en attente** peut être refusée : sur une offre déjà acceptée, contrée ou expirée, l'app répond « Cette offre n'est plus en attente. » et ne touche à rien. Sinon l'offre passe en `rejected`, message système « Offre de X $ refusée ».
- **Effet de nettoyage** : si une transaction meetup **née de cette offre précise** (« en attente de meetup » ou « meetup confirmé ») existait, elle est **annulée**, ce qui **remet l'article en vente**. Une transaction meetup **sans lien avec une offre** — celle pré-créée par le parcours « PROPOSER UN ACHAT » — est annulée elle aussi. En revanche, les rencontres issues d'une **autre** offre du même fil ne sont plus touchées : refuser une offre restée en attente n'annule plus le rendez-vous convenu à partir d'une contre-offre acceptée.
- Côté sécurité, les règles Firestore n'autorisent le passage à `accepted` ou `rejected` **que par le destinataire** de l'offre, et **interdisent toute modification du montant** après création.
- **Limite constatée** : le refus **ne vérifie pas l'expiration**. On peut refuser une offre déjà périmée ; l'effet est cosmétique (statut `rejected` au lieu de `expired`) mais l'annulation de transaction associée, elle, s'exécute.

#### Contre-proposer

Le bouton **« Contre-offre »** ouvre :
- pour une offre **sans meetup** : directement le panneau **« PROPOSER UN AUTRE PRIX »** ;
- pour une offre **meetup** : un menu « Type de contre-offre » → **Modifier le prix**, **Proposer un autre lieu**, **Proposer un autre horaire**.

Chaque contre-offre est un petit formulaire intégré dans la bulle :

| Contre-offre | Champs | Règles de validation |
|---|---|---|
| **Prix** | Montant + message optionnel | Montant compris entre **1 $ et 50 000 $**. |
| **Lieu** (meetup) | Nom du lieu + message optionnel | Nom obligatoire. Le nouveau lieu **réutilise le quartier** de l'offre initiale. |
| **Horaire** (meetup) | Date/heure au format **« AAAA-MM-JJ HH:MM »** + message optionnel | Format strictement respecté (sinon « Format invalide »), date réelle, et **dans le futur** (sinon « Date passée »). |

Comportement commun : la contre-offre **hérite des autres caractéristiques** de l'offre précédente (une contre-offre de prix conserve le lieu déjà discuté), conserve un **historique de négociation** (qui a proposé quoi, valeur précédente → nouvelle valeur, message associé), et **repart sur un délai d'expiration de 48 h**. Un message système résume le changement. Comme pour l'acceptation, contre-proposer sur une offre **déjà expirée** est bloqué et force le statut à `expired`.

> Les contre-offres peuvent s'enchaîner librement entre les deux parties. Il n'y a **pas de limite** au nombre de tours de négociation.

> Deux défauts à connaître sur les contre-offres :
> - **Contre-offre de prix sur une ancienne offre « livraison »** (offres historiques sans meetup) : l'opération échoue et affiche « Impossible d'envoyer la contre-offre ». Sans conséquence tant que la livraison est coupée, mais bloquant le jour où on la rallume.
> - **Contre-offre de lieu** : le nouveau lieu est enregistré avec une catégorie hors référentiel, si bien que la bulle affiche le quartier **sans libellé de catégorie** (« • Mile-End » au lieu de « Café • Mile-End »). Cosmétique, mais visible.

---

### 7.7. Expiration des offres (règle des 48 h)

- Toute offre **meetup** (et toute contre-offre) reçoit une **date limite de 48 heures** à partir de sa création.
- **Côté affichage** : tant que l'offre est en attente, la bulle montre le temps restant (heures/minutes) ; une fois dépassé, « Expirée ».
- **Côté serveur (source de vérité)** : une tâche planifiée s'exécute **toutes les heures** (`functions/src/scheduled/offerExpiration.ts`, tâche `expireStaleOffers`) et bascule en `expired` toutes les offres encore « en attente » dont la date limite est passée — jusqu'à 1 000 offres par passage, le reliquat étant traité à l'heure suivante. Cela garantit que le statut est cohérent pour tout le monde, même si personne n'a rouvert le chat.
- **Deuxième tâche horaire, moins connue** (`expireStaleAcceptedOffers`) : une offre **acceptée mais jamais transformée en transaction** est elle aussi expirée après un délai de grâce de 48 h. Objectif métier : empêcher qu'un prix négocié reste réutilisable indéfiniment des semaines plus tard.
- **Garde-fou à l'action** : même entre deux passages horaires, on ne peut **ni accepter ni contre-proposer** une offre déjà expirée — la tentative force le statut à `expired` et affiche « Cette offre a expiré ».

> Conséquence métier : une offre laissée sans réponse meurt d'elle-même après 48 h. Pour relancer, il faut **refaire une offre** (ce qui crée une nouvelle bulle).

> **Angle mort vérifié dans le code, à traiter :**
> - Les offres **sans meetup** (parcours livraison historique) sont créées **sans date limite** : elles ne sont jamais ramassées par la tâche des offres en attente et restent « en attente » indéfiniment.
>
> *(Corrigé : la tâche qui expire les offres acceptées juge la consommation sur la **conversation**, et non plus sur l'émetteur supposé acheteur, et mesure la grâce depuis la **date d'acceptation**. Une contre-offre du vendeur acceptée par l'acheteur n'est donc plus expirée à tort, et la bulle garde ses boutons de clôture. La tâche parcourt en outre **plusieurs pages** par passage — jusqu'à 1 000 offres, le reliquat étant repris à l'heure suivante — au lieu de s'arrêter à la première.)*

---

### 7.8. De l'offre acceptée au règlement

**Mode meetup (le seul actif aujourd'hui)** — le règlement se fait **en main propre, hors application** :

1. Offre `accepted` → une transaction meetup est créée (statut « en attente de meetup »), l'article est bloqué, **0 $ de frais**, montant vendeur = montant de l'offre.
2. Les deux parties conviennent du rendez-vous (le lieu est dans l'offre ; l'horaire se cale via le chat ou une contre-offre d'horaire).
3. **Le vendeur confirme** la rencontre (bouton « Confirmer » sur la bulle). Le serveur n'autorise cette confirmation **qu'au vendeur** et seulement depuis le statut « en attente de meetup ». Un message système « Meetup confirmé! » est posté.
4. Ensuite, **l'acheteur OU le vendeur** peut clôturer (bouton « Confirmer » à nouveau, avec l'alerte « Confirmez-vous que la remise en main propre a bien eu lieu ? »). La transaction passe **« meetup terminé »**, la bulle affiche le badge **« Transaction terminée »**, un message système confirme que le paiement a été réglé en main propre, et l'**avis (review)** devient possible.
5. À chacune des deux étapes, un bouton **« Signaler une absence »** est proposé à côté (voir ci-dessous).

> Correction par rapport aux versions antérieures du produit : la clôture **n'est plus réservée à l'acheteur**. Les deux parties étaient physiquement présentes, les deux peuvent finaliser — sinon un acheteur qui disparaît laissait la transaction et l'article bloqués à vie.

**Le signalement d'absence (no-show)** a de vraies conséquences (`reportMeetupNoShow`) : la transaction est **gelée en litige**, l'**article est débloqué et redevient vendable**, et un **dossier de litige est ouvert pour révision humaine** enregistrant qui signale qui. Ouvert à l'acheteur comme au vendeur, uniquement tant que la rencontre est « en attente » ou « confirmée », et limité à 5 signalements par minute. Aucun remboursement n'est déclenché : aucun argent n'a transité par la plateforme. **La partie visée peut répondre** : dans la bulle d'offre, un bouton « Donner ma version » n'est affiché qu'à elle — jamais au signaleur — et enregistre une **contre-déclaration** sur la transaction, une seule fois, sans changer le statut, sans retoucher l'article et sans rouvrir le dossier. Le premier signaleur reçoit alors une notification « Signalement contesté ». Cette seconde version est aussi reportée sur le dossier de litige, mais **la console d'administration ne l'affiche pas encore** : elle ne montre que le récit du premier signaleur — à corriger pour que l'administrateur tranche sur les deux.

**Filets de sécurité automatiques** (`functions/src/scheduled/transactionExpiration.ts`) :

| Situation | Délai | Effet |
|---|---|---|
| Offre acceptée, **vendeur qui ne confirme jamais** la rencontre | 48 h | Transaction annulée, article remis en vente, acheteur notifié |
| Rencontre confirmée, **personne ne clôture** | 7 jours | Transaction annulée, article remis en vente, **les deux parties** notifiées |

Ces deux annulations sont enregistrées comme **décisions automatisées** (voir 7.10).

**Mode livraison / paiement in-app (présent mais inactif)** — quand une offre acceptée n'est **pas** un meetup, la bulle prévoit un bouton **« Payer maintenant »** (vers l'écran de paiement si une transaction existe, sinon vers le tunnel de checkout en transmettant le prix négocié). Ce bouton est **conditionné au drapeau `SHIPPING_ENABLED` et donc jamais affiché aujourd'hui**. Le contrôle serveur associé exige par ailleurs que l'offre acceptée ait été **émise par l'acheteur** : une contre-offre du vendeur acceptée par l'acheteur ne serait pas reconnue comme prix négocié au moment de payer — à corriger avant de rallumer le paiement.

---

### 7.9. Données clés d'une offre (langage métier)

Chaque offre, stockée comme une bulle dans la conversation, porte notamment :

- **Montant** proposé (CAD). Il est **immuable** une fois l'offre créée (règle serveur).
- **Statut** (cf. 7.5).
- **Message** optionnel de l'auteur.
- **Détails meetup** : lieu choisi (nom, catégorie, quartier, adresse éventuelle), **date/heure optionnelle** (absente tant qu'aucune contre-offre d'horaire n'a eu lieu), qui a proposé le lieu (acheteur ou vendeur), et deux jalons de suivi : **date de confirmation** par le vendeur, **date de clôture**.
- **Date d'expiration** (création + 48 h) — présente uniquement sur les offres meetup.
- **Historique de négociation** : la suite des actions (création, contre-prix, contre-lieu, contre-horaire) avec l'auteur, l'horodatage, l'ancienne et la nouvelle valeur, et le message associé. C'est la **traçabilité du marchandage**.
- Des **identifiants de chaînage** reliant une contre-offre à l'offre dont elle découle.

Deux précisions par rapport à d'anciennes versions de ce document :
- Le **signalement d'absence n'est pas stocké sur l'offre** : il vit sur la **transaction** (auteur, personne visée, motif, détail, date) et dans le **dossier de litige**. Le champ prévu sur l'offre n'est plus alimenté.
- Il n'existe **aucun score de fiabilité meetup** par utilisateur. Ce concept a existé dans les types mais a été supprimé ; rien dans le code ne compte les meetups réalisés, complétés ou les absences. Si le produit en veut un, c'est un chantier à ouvrir.

---

### 7.10. Spécificités Canada

- **Devise** : tous les montants sont en **dollars canadiens**, affichés selon la convention FR-CA (« 45 $ », « 45,50 $ »). Le plafond d'une offre est exprimé « 50000 $ CA ».
- **Géographie** : la sélection de lieu de meetup est **exclusivement montréalaise** — 45 quartiers, 22 arrondissements. Un utilisateur hors Montréal n'a aucun quartier pertinent à choisir et doit passer par le lieu personnalisé.
- **Dates** : les contre-offres d'horaire utilisent le format **« AAAA-MM-JJ HH:MM »** saisi à la main (pas de sélecteur de date natif) et l'affichage des dates suit la convention FR-CA.
- **Loi 25 / décisions automatisées** : le registre des décisions automatisées de la plateforme ne couvre aujourd'hui que **trois** types de décisions (libération de fonds, **annulation automatique de commande**, remboursement d'étiquette). Les **annulations automatiques de meetup** (48 h / 7 jours, cf. 7.8) y sont bien enregistrées et donnent accès, depuis la conversation, à un bloc de **transparence + demande de révision humaine**.
  **En revanche, l'expiration automatique d'une offre à 48 h n'est PAS enregistrée** comme décision automatisée et n'ouvre aucun droit de contestation dans l'app. Point à arbitrer avec le juriste : soit on considère que l'expiration d'une proposition commerciale n'est pas une « décision » au sens de l'art. 12.1, soit il faut l'ajouter au registre.

---

### 7.11. Différences iOS / Android (impact produit)

Le système d'offres est **identique en fonctionnalités** sur iOS et Android ; les différences sont surtout d'ergonomie de saisie :

- **Clavier et fenêtre coulissante** : le formulaire d'offre gère le clavier différemment selon la plateforme (sur Android, le contenu est redimensionné quand le clavier s'ouvre). L'objectif produit est que le champ « montant » et le bouton « Continuer » restent atteignables clavier ouvert sur les deux plateformes.
- **Retours haptiques** : les confirmations (offre envoyée, acceptée, refusée) déclenchent des **vibrations** ; le rendu est plus riche/nuancé sur iOS, plus basique sur Android (caractéristique matérielle, sans impact sur le déroulé).
- **Alertes de confirmation** : les confirmations d'accepter/refuser/contre-offre passent par les **boîtes de dialogue natives** de chaque OS, dont la présentation visuelle diffère légèrement (ordre/style des boutons), mais le contenu et la logique sont les mêmes.

**Notifications** — contrairement à ce qu'affirmait une version antérieure de ce document, **les offres déclenchent bien des notifications** (`functions/src/triggers/messages.ts`), push + cloche in-app, dans le respect des préférences de notification de l'utilisateur :

| Événement | Notification envoyée à | Contenu |
|---|---|---|
| Nouvelle offre | Le destinataire | « Nouvelle offre de {prénom} » — « 45 $ pour "{article}" » |
| Offre acceptée | L'auteur de l'offre | « Votre offre a ete acceptee ! » |
| Offre refusée | L'auteur de l'offre | « Offre refusee » |
| Contre-offre de prix / lieu / horaire | L'auteur de l'offre précédente | « Nouvelle contre-offre » / « Nouveau lieu propose » / « Nouvel horaire propose » |

> Une contre-offre ne déclenche plus qu'**une seule** notification. Elle en produisait deux — l'une sur le changement de statut de l'offre d'origine (« Nouvelle contre-offre »), l'autre sur la création du message de contre-offre (« Nouvelle offre de {vendeuse} », donc mal intitulée). Seule la première est conservée : c'est elle qui porte les libellés précis par type.

> Deux réserves : les libellés de réponse à une offre sont écrits **sans accents** (« Votre offre a ete acceptee ! », « Offre refusee », « Nouveau lieu propose ») — dette de rédaction à corriger ; et **aucune notification n'est envoyée à l'expiration** d'une offre — celui qui n'a pas répondu comme celui qui attendait l'apprennent en rouvrant la conversation.

---

### 7.12. Résumé des règles de gestion

- Offre = montant (CAD, entre 1 $ et 50 000 $) + message optionnel (+ lieu en meetup) ; pas un achat tant que non acceptée ; **non rétractable** une fois envoyée.
- Trois chemins créent une offre, dont le bouton d'achat lui-même (« PROPOSER UN ACHAT » envoie une offre au prix affiché).
- Garde-fous complets uniquement **depuis la conversation** (vendu, retiré, utilisateur bloqué, offre déjà en attente) ; depuis la fiche article, seuls « vendu » et « son propre article » sont vérifiés — la règle « une seule offre en attente » est donc contournable.
- Avertissement « offre trop basse » sous 30 % du prix affiché (non bloquant) ; alerte visuelle au-delà de 50 % de réduction.
- Réponses possibles : **accepter / refuser / contre-proposer** (prix, lieu, horaire), par l'une ou l'autre partie ; aller-retours **illimités**.
- Une offre **supérieure au prix affiché** est refusée **à l'envoi**, avec le prix demandé dans le message : l'impasse silencieuse d'autrefois (offre « En attente » 48 h avec un bouton « Accepter » qui échoue toujours) n'existe plus.
- Toute offre meetup **expire à 48 h** ; expiration appliquée côté serveur toutes les heures ; offre expirée ni acceptable ni contrable. Les anciennes offres « livraison » n'ont **aucune** date limite.
- Acceptation = opération serveur atomique : article bloqué + transaction meetup à **0 $ de frais**, montant vendeur = montant de l'offre.
- Meetup : règlement **en main propre, zéro frais de service** ; confirmation par le **vendeur**, puis clôture par **l'une ou l'autre** partie ; signalement d'absence = gel en litige + article débloqué + révision humaine ; refus = annulation de la transaction + remise en vente ; annulations automatiques à 48 h (non confirmé) et 7 jours (non clôturé).
- Notifications push + in-app à chaque étape (nouvelle offre, acceptation, refus, contre-offre) — **sauf à l'expiration**.
- Livraison et paiement in-app : **présents mais désactivés** ; toutes les offres sont en meetup tant que les drapeaux sont à `false`.
