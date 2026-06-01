## 07. Offres & négociation

Second permet à un acheteur potentiel de **proposer son propre prix** sur un article plutôt que de payer le prix affiché, puis d'entrer dans une **négociation** avec le vendeur directement dans la messagerie. C'est le cœur de l'expérience « marché aux puces » de l'app : on discute, on marchande, on s'entend sur un prix et un lieu, puis on conclut. Cette section décrit le parcours complet, les règles de gestion, les statuts d'une offre, les conditions/limites, et les spécificités Canada / iOS-Android.

> Note de cadrage produit : aujourd'hui, l'app fonctionne **en mode « remise en main propre » (meetup) uniquement**. La livraison/expédition (« shipping ») existe dans le code mais est **désactivée par un drapeau** (`SHIPPING_ENABLED = false`). Les éléments liés à la livraison sont donc décrits ci-dessous comme « prévus mais inactifs ». Concrètement, toute nouvelle offre passe par le parcours meetup, et le paiement d'une offre se fait **de la main à la main** lors de la rencontre.

---

### 7.1. À quoi sert une offre

- Sur la fiche d'un article, à côté de « Acheter », l'acheteur dispose d'une action **« Faire une offre »**.
- Une offre = un **montant proposé** (en dollars canadiens), accompagné d'un **message optionnel** au vendeur, et — en mode meetup — d'un **lieu de rencontre** proposé.
- L'offre apparaît ensuite comme une **bulle spéciale dans la conversation** entre l'acheteur et le vendeur (différente d'un simple message texte). Toute la négociation se déroule dans ce fil de discussion.
- Le vendeur peut **accepter**, **refuser**, ou **contre-proposer** (autre prix, autre lieu, autre horaire). À chaque contre-offre, le ballon repart dans l'autre camp.

Une offre n'est donc pas un achat : c'est une **proposition d'accord**. Tant qu'elle n'est pas acceptée, rien n'est réservé ni payé.

---

### 7.2. Où et comment se déclenche une offre

L'acheteur peut lancer une offre depuis **deux points d'entrée**, qui aboutissent au même formulaire :

| Point d'entrée | Comportement |
|---|---|
| **Fiche article** (`Faire une offre`) | Ouvre/réutilise la conversation avec le vendeur pour cet article, puis redirige vers le chat une fois l'offre envoyée. |
| **Conversation existante** (barre du chat) | Ouvre directement le formulaire d'offre dans le fil en cours. |

Le formulaire est une **fenêtre coulissante (bottom sheet)** en plusieurs étapes, avec un indicateur de progression « ÉTAPE X SUR Y ».

**Garde-fous au déclenchement** (vérifiés avant même d'ouvrir le formulaire, côté conversation) :
- **Article vendu** → message « Cet article n'est plus disponible. » L'offre est bloquée.
- **Article désactivé / retiré** → même blocage.
- **Une offre déjà en attente** de la part de cet acheteur sur cet article → message « Vous avez déjà une offre en attente pour cet article. » On ne peut donc pas empiler plusieurs offres « en attente » simultanées du même acheteur.
- **Son propre article** → un vendeur ne peut pas faire une offre sur son propre article (« Vous ne pouvez pas faire une offre sur votre propre article. »).

---

### 7.3. Le formulaire d'offre, étape par étape

Le formulaire s'adapte au mode (meetup vs livraison). En meetup, il a **3 étapes** ; en livraison (inactif aujourd'hui), il en a **2** (l'étape « lieu » est sautée).

#### Étape 1 — Le montant et le message

- L'acheteur voit le **titre de l'article** et le **prix affiché** en rappel.
- Il saisit **« Votre offre »** au pavé numérique décimal, suffixée par « $ ».
- En temps réel, l'app calcule et affiche le **pourcentage de réduction** par rapport au prix affiché (ex. « 20 % de réduction »). Si la réduction dépasse **50 %**, le texte passe en **orange (avertissement visuel)**.
- Champ **message au vendeur** facultatif, limité à **500 caractères**, avec compteur (« 0/500 »). Sert à justifier l'offre (« Je peux passer ce week-end », etc.).
- Un encart d'aide rappelle la suite : en meetup, « Vous proposerez ensuite un lieu de rencontre » ; en livraison, « Votre offre sera envoyée au vendeur pour validation ».

**Règles de validation du montant :**
- Montant **vide, nul ou négatif** → erreur « Veuillez entrer un montant valide » ; on ne passe pas à l'étape suivante.
- Montant **inférieur à 30 % du prix affiché** → alerte « Offre trop basse » : l'app suggère de réviser, mais propose **« Continuer quand même »**. C'est un garde-fou pédagogique, **pas un blocage dur** : une offre très basse reste possible si l'acheteur insiste.

#### Étape 2 (meetup uniquement) — Le lieu de rencontre

C'est la sélection du lieu où acheteur et vendeur se rencontreront pour l'échange en main propre. Elle se fait en deux temps :

1. **Choisir un quartier** (Montréal). L'app propose :
   - une **barre de recherche** de quartier ;
   - en tête, la **« Zone du vendeur »** si le vendeur a renseigné son quartier, marquée d'un badge **« RECOMMANDÉ »** ;
   - sinon, la liste de **tous les quartiers** de Montréal.
2. **Choisir un lieu précis** dans le quartier. L'app affiche des **lieux populaires** (cafés, métro, bibliothèques, centres commerciaux, parcs, centres communautaires), avec icône par catégorie. Les lieux que le **vendeur a indiqués comme préférés** sont mis en avant avec un badge **« SUGGÉRÉ »**.
3. **Proposer un autre lieu** : si rien ne convient, l'acheteur peut saisir un **lieu personnalisé** (nom libre + catégorie). Ce lieu est marqué comme « suggéré par l'utilisateur ».

> À noter : le choix du lieu se fait dans le **quartier**, le lieu retenu hérite de ce quartier. Il n'y a **pas de sélection de date/heure** à ce stade — la date est convenue plus tard (de vive voix dans le chat, ou via une contre-offre d'horaire). Le système privilégie des **lieux publics et fréquentés** (cafés, métro, bibliothèques) par souci de sécurité de la rencontre.

#### Étape 3 — Récapitulatif et envoi

Écran de confirmation reprenant :
- le **montant** de l'offre (gros chiffre) et le titre de l'article ;
- le **message** s'il y en a un ;
- en meetup : le **lieu de rencontre** (nom, catégorie, quartier, adresse le cas échéant) ;
- une ligne **« Montant à payer »** ;
- une mention claire : en meetup, **« Aucun frais de service — paiement en main propre lors du meetup »**.
- un encart « Comment ça marche ? » qui annonce les suites possibles (accepter / refuser / autre prix ou lieu) et **l'expiration après 48 h sans réponse**.

Le bouton **« Envoyer l'offre »** transmet l'offre. En cas de succès : retour haptique de succès + alerte « Offre envoyée » expliquant que le vendeur peut accepter, refuser ou contre-proposer. En cas d'échec : « Impossible d'envoyer votre offre. Veuillez réessayer. »

---

### 7.4. La bulle d'offre dans la conversation

Une fois envoyée, l'offre s'affiche comme une **carte d'offre** dans le fil de discussion. Elle est vue différemment selon qu'on en est l'auteur ou le destinataire :

- En-tête **« VOTRE OFFRE »** (pour l'auteur) ou **« OFFRE REÇUE »** (pour l'autre partie), avec une icône et une couleur qui dépendent du statut.
- En meetup, un badge **« Meetup »** et une **carte détaillant le lieu** (nom, catégorie, quartier).
- Le **montant** en évidence, avec rappel « sur un prix affiché de … ».
- Le **message** éventuel, entre guillemets.
- Un **badge de statut** (En attente / Acceptée / Refusée / etc.) et, tant que l'offre est en attente, un **compte à rebours d'expiration** (« Expire dans 5 h 12 min », « Expire dans 47 min », ou « Expirée »).
- Les **boutons d'action** dépendent du statut et du rôle (voir ci-dessous).

Cette bulle est l'**unité de négociation** : chaque offre et chaque contre-offre crée une nouvelle bulle, ce qui produit un historique visuel de la négociation dans le chat. Un **message système** (« Offre de 40 $ acceptée », « Contre-offre : 50 $ → 45 $ », etc.) est inséré dans le fil à chaque étape pour rendre la négociation lisible.

---

### 7.5. Statuts d'une offre

Une offre porte un **statut** unique à un instant donné. Les statuts possibles :

| Statut | Sens métier | Affichage |
|---|---|---|
| `pending` | En attente de réponse de l'autre partie | « En attente » + compte à rebours |
| `accepted` | Acceptée → on passe au règlement | « Acceptée » (vert) |
| `rejected` | Refusée définitivement | « Refusée » (rouge) |
| `counter_price` | A donné lieu à une contre-offre de **prix** | « Contre-offre prix » |
| `counter_location` | A donné lieu à une contre-proposition de **lieu** | « Autre lieu proposé » |
| `counter_time` | A donné lieu à une contre-proposition d'**horaire** | « Autre horaire proposé » |
| `expired` | Expirée faute de réponse (48 h) | « Expirée » (rouge) |
| `completed` | Transaction terminée (meetup complété) | « Terminée » (vert) |

**Logique des statuts de contre-offre** : quand on contre-propose, l'offre d'origine ne reste pas « en attente ». Elle bascule en `counter_price` / `counter_location` / `counter_time` (elle est « consommée »), et **une nouvelle bulle d'offre `pending`** est créée avec la nouvelle valeur. C'est cette nouvelle offre que l'autre partie traite. On a donc toujours **au plus une offre active (`pending`)** dans la chaîne de négociation.

---

### 7.6. Répondre à une offre : accepter, refuser, contre-proposer

Les boutons n'apparaissent que pour la **partie qui n'est pas l'auteur** de l'offre et **seulement tant que l'offre est `pending`**.

#### Accepter
- Confirmation par alerte (« Voulez-vous accepter cette offre de X $ ? » ; en meetup, mention « avec meetup »).
- Vérification d'**expiration** : si l'offre a dépassé sa date limite, l'acceptation est refusée et l'offre passe automatiquement en `expired` (« Cette offre a expiré »).
- Sinon, l'offre passe en `accepted`, un message système « Offre de X $ acceptée » est posté.
- En meetup : si aucune transaction n'existe encore pour cette conversation, elle est **créée à l'acceptation** (l'article est alors réservé/marqué comme en cours de vente, et une transaction meetup est ouverte).

#### Refuser
- Confirmation par alerte. L'offre passe en `rejected`, message système « Offre de X $ refusée ».
- **Effet de nettoyage** : si une transaction meetup avait déjà été ouverte (statut « en attente de meetup » ou « meetup confirmé ») pour cette conversation, elle est **annulée**, ce qui **remet l'article en vente** (il n'est plus bloqué). Cela évite qu'un article reste « coincé » comme réservé après un refus.

#### Contre-proposer
Le bouton **« Contre-offre »** ouvre :
- pour une offre **sans meetup** : directement le panneau **« Proposer un autre prix »** ;
- pour une offre **meetup** : un menu « Type de contre-offre » → **Modifier le prix**, **Proposer un autre lieu**, **Proposer un autre horaire**.

Chaque contre-offre est un petit formulaire intégré dans la bulle :

| Contre-offre | Champs | Règles de validation |
|---|---|---|
| **Prix** | Montant + message optionnel | Montant valide (> 0) obligatoire. |
| **Lieu** (meetup) | Nom du lieu + message optionnel | Nom obligatoire. Le nouveau lieu **réutilise le quartier** de l'offre initiale. |
| **Horaire** (meetup) | Date/heure au format « AAAA-MM-JJ HH:MM » + message optionnel | Date interprétable obligatoire ; la date doit être **dans le futur** (sinon « Date passée »). |

Comportement commun : la contre-offre **hérite des autres caractéristiques** de l'offre précédente (ex. une contre-offre de prix conserve le lieu/meetup déjà discuté), conserve un **historique de négociation** (qui a proposé quoi, valeur précédente → nouvelle valeur), et **relance un délai d'expiration de 48 h** sur la nouvelle offre. Un message système résume le changement (ex. « Contre-offre : 50 $ → 45 $ »).

> Les contre-offres peuvent s'enchaîner librement entre les deux parties (aller-retour de marchandage). Il n'y a pas de limite codée au nombre de tours de négociation.

---

### 7.7. Expiration des offres (règle des 48 h)

- Toute offre (et toute contre-offre) reçoit une **date limite de 48 heures** à partir de sa création.
- **Côté affichage** : tant que l'offre est en attente, la bulle montre un **compte à rebours** (heures/minutes). Une fois dépassée, elle indique « Expirée ».
- **Côté serveur (source de vérité)** : une tâche planifiée s'exécute **toutes les heures** côté Firebase et bascule en `expired` toutes les offres encore « en attente » dont la date limite est passée. Cela garantit que le statut « expirée » est cohérent pour tous (les deux téléphones, les déclencheurs serveur), même si personne n'a rouvert le chat.
- **Garde-fou à l'action** : même entre deux passages de la tâche horaire, on ne peut **ni accepter ni contre-proposer** une offre déjà expirée — la tentative force le statut à `expired` et affiche « Cette offre a expiré ». Une offre expirée n'est donc jamais « rattrapable » par hasard.

> Conséquence métier : une offre laissée sans réponse meurt d'elle-même après 48 h. Pour relancer, il faut **refaire une offre** (ce qui crée une nouvelle bulle).

---

### 7.8. De l'offre acceptée au règlement

Le chemin après acceptation **dépend du mode** :

**Mode meetup (mode actif aujourd'hui)** — le règlement se fait **en main propre**, pas dans l'app :
1. Offre `accepted` → une transaction meetup est en place et l'article est réservé.
2. Les deux parties conviennent du rendez-vous (le lieu est dans l'offre ; l'horaire se cale via le chat ou une contre-offre d'horaire).
3. Au rendez-vous, **le vendeur confirme** la rencontre (« Confirmer » / « J'ai rencontré l'acheteur »). Il peut aussi **« Signaler une absence »** (no-show) si l'acheteur ne s'est pas présenté.
4. Une fois le vendeur ayant confirmé, **l'acheteur clôt** la transaction (« Confirmer » / « J'ai bien reçu l'article »). La transaction passe alors **« Terminée »** et la bulle affiche un badge **« Transaction terminée »**.
5. Le paiement étant **de la main à la main**, l'app **ne prélève aucun frais de service** sur une vente meetup (rappel affiché dès le récap : « Aucun frais de service — paiement en main propre lors du meetup »).

Cette double confirmation (vendeur puis acheteur) sert de **garde-fou anti-litige** : la transaction n'est réputée terminée que lorsque les deux parties ont agi, et le « signalement d'absence » alimente la fiabilité des comptes.

**Mode livraison (prévu mais inactif)** — quand une offre acceptée n'est **pas** un meetup, la bulle affiche un bouton **« Payer maintenant »** :
- si une transaction existe déjà, redirection vers l'écran de **paiement** correspondant ;
- sinon, démarrage du **tunnel de paiement (checkout)** avec calcul des frais de livraison qui s'ajoutent au montant de l'offre.
Ce parcours n'est **pas proposé en pratique** tant que la livraison est désactivée : le bouton « Payer » est conditionné au drapeau `SHIPPING_ENABLED`, et toutes les nouvelles offres sont forcées en meetup.

---

### 7.9. Données clés d'une offre (langage métier)

Chaque offre, stockée comme une bulle dans la conversation, porte notamment :

- **Montant** proposé (CAD) et, le cas échéant, **montant total** (montant + livraison, pour les offres livraison historiques).
- **Statut** (cf. 7.5).
- **Message** optionnel de l'auteur.
- **Détails meetup** : lieu choisi (nom, catégorie, quartier, adresse éventuelle), qui a proposé le lieu (acheteur ou vendeur), et les jalons de suivi : **date de confirmation** par le vendeur, **date de complétion** par l'acheteur, **signalement d'absence** (qui, quand, motif).
- **Date d'expiration** (création + 48 h).
- **Historique de négociation** : la suite des actions (création, contre-prix, contre-lieu, contre-horaire) avec l'auteur, l'horodatage, l'ancienne et la nouvelle valeur, et le message associé. C'est la **traçabilité du marchandage**.
- Des **identifiants de chaînage** reliant une contre-offre à l'offre dont elle découle.

L'app maintient aussi, en arrière-plan, un **score de fiabilité meetup** par utilisateur (meetups réalisés, complétés, no-shows, annulations) destiné à objectiver la fiabilité d'un membre.

---

### 7.10. Spécificités Canada

- **Devise** : tous les montants sont en **dollars canadiens**, affichés avec le suffixe « $ » et formatés selon la locale FR-CA.
- **Géographie** : la sélection de lieu de meetup est aujourd'hui centrée sur les **quartiers de Montréal** (avec lieux publics typiques : cafés, stations de métro, bibliothèques, centres communautaires).
- **Dates** : les contre-offres d'horaire utilisent le format **« AAAA-MM-JJ HH:MM »** et l'affichage des dates suit la convention FR-CA.
- **Loi 25 / transparence** : en meetup, l'annulation automatique liée au cycle de vie de la transaction (ex. annulation automatique d'un meetup) est encadrée par un bloc de **transparence sur les décisions automatisées + droit de contestation** affiché dans le suivi de la conversation. L'expiration automatique des offres à 48 h relève de cette même logique de décisions automatisées communiquées à l'utilisateur.

---

### 7.11. Différences iOS / Android (impact produit)

Le système d'offres est **identique en fonctionnalités** sur iOS et Android ; les différences sont surtout d'ergonomie de saisie :

- **Clavier et fenêtre coulissante** : le formulaire d'offre gère le clavier différemment selon la plateforme (sur Android, le contenu est redimensionné quand le clavier s'ouvre). L'objectif produit est que le champ « montant » et le bouton « Continuer » restent atteignables clavier ouvert sur les deux plateformes.
- **Retours haptiques** : les confirmations (offre envoyée, acceptée, refusée) déclenchent des **vibrations** ; le rendu est plus riche/nuancé sur iOS, plus basique sur Android (caractéristique matérielle, sans impact sur le déroulé).
- **Alertes de confirmation** : les confirmations d'accepter/refuser/contre-offre passent par les **boîtes de dialogue natives** de chaque OS, dont la présentation visuelle diffère légèrement (ordre/style des boutons), mais le contenu et la logique sont les mêmes.

> Limite connue à signaler : il n'y a **pas, à ce stade, de notification « push » dédiée** déclenchée spécifiquement par une nouvelle offre ou une réponse documentée dans ce périmètre de fichiers. Concrètement, la partie destinataire découvre l'offre/contre-offre **en ouvrant la conversation** (le compte à rebours d'expiration de 48 h rend d'autant plus important de ne pas trop tarder). Toute fiabilité de notification push (et ses contraintes iOS) relève d'un autre module que celui des offres décrit ici.

---

### 7.12. Résumé des règles de gestion

- Offre = montant (CAD) + message optionnel (+ lieu en meetup) ; pas un achat tant que non acceptée.
- Pas d'offre sur article vendu/retiré, pas d'offre sur son propre article, **une seule offre en attente** par acheteur et par article.
- Garde-fou « offre trop basse » sous 30 % du prix affiché (avertissement, non bloquant) ; avertissement visuel au-delà de 50 % de réduction.
- Réponses possibles : **accepter / refuser / contre-proposer** (prix, lieu, horaire) ; aller-retours de négociation **illimités**.
- Toute offre **expire à 48 h** ; expiration affichée en direct et appliquée côté serveur toutes les heures ; offre expirée ni acceptable ni contrable.
- Meetup : règlement **en main propre, zéro frais de service** ; double confirmation vendeur → acheteur pour clôturer ; possibilité de signaler un no-show ; refus = annulation transaction + remise en vente.
- Livraison/paiement in-app : **prévu mais désactivé** ; toutes les offres sont en meetup tant que le drapeau livraison est à false.
