## 12. Porte-monnaie & paiements vendeur

Cette section décrit comment un vendeur reçoit l'argent de ses ventes, le suit dans l'application, et le transfère vers son compte bancaire. Tout le parcours est intégré dans l'app : le vendeur ne quitte jamais Second et ne voit jamais l'interface de Stripe. C'est le choix « white-label » assumé de la plateforme : c'est Second qui porte la relation, l'identité visuelle et la conformité.

> **⚠️ État réel au moment de cette rédaction — le module est ÉTEINT.** Deux drapeaux du code coupent tout ce qui est décrit ici :
> - `PAYMENTS_ENABLED = false` (`config/featureFlags.ts`) : l'écran « Porte-monnaie » et l'écran « Compte de paiement » **redirigent immédiatement vers les Réglages** ; leurs entrées dans le Profil et dans les Réglages sont **masquées**. Aucun vendeur ne peut ouvrir son porte-monnaie ni configurer un compte de paiement aujourd'hui.
> - `SHIPPING_ENABLED = false` (côté app et côté serveur) : le seul parcours d'achat actif est la **rencontre (meetup)**, qui est un règlement cash en main propre et ne fait transiter **aucun argent** par la plateforme.
>
> Conséquence : **le porte-monnaie ne peut être crédité par aucune vente à ce jour**. Tout ce qui suit décrit un système entièrement écrit, testé et déployé, mais qui n'est pas ouvert aux utilisateurs. Réactiver le module = repasser les deux drapeaux à `true` (plus la variable serveur `SHIPPING_ENABLED`).

### 12.1 Deux briques distinctes : le compte de paiement et le porte-monnaie

Il faut bien séparer deux objets, qui sont souvent confondus mais qui ont des rôles différents.

| Brique | Rôle métier | Où le vendeur la voit |
|--------|-------------|------------------------|
| **Compte de paiement** (Stripe Connect Custom, « tuyau » bancaire) | Rattache l'identité et le compte bancaire du vendeur. C'est le canal par lequel l'argent sort vers la banque. Sans lui, aucun retrait possible. | Écran « Compte de paiement » (`app/settings/stripe-onboarding.tsx`) |
| **Porte-monnaie** (« wallet », registre interne de Second) | Compte virtuel qui suit, en temps réel, ce que le vendeur a gagné, ce qui est en cours, ce qui est bientôt disponible et ce qui est retirable. C'est le « solde Second ». | Écran « Porte-monnaie » (`app/wallet.tsx`) |

Le porte-monnaie est la **source de vérité** des gains du vendeur côté Second. Le compte de paiement n'est que le robinet de sortie vers la banque. Le vendeur ne peut jamais écrire lui-même dans son porte-monnaie : les règles Firestore ne l'autorisent qu'à **lire** son solde, son historique et ses demandes de retrait ; tous les mouvements d'argent sont écrits par le serveur.

### 12.2 Accès et points d'entrée

Quand le module est activé, le porte-monnaie est accessible depuis :
- l'onglet **Profil** (entrée « Porte-monnaie », qui affiche directement le solde disponible en sous-titre) ;
- le menu **Réglages**, section « Paiements ».

Ces deux entrées sont conditionnées au drapeau `PAYMENTS_ENABLED` : **elles n'apparaissent pas aujourd'hui**. Le compte de paiement est accessible depuis la même section des Réglages, depuis le porte-monnaie (bandeau « action requise »), et l'app y redirige le vendeur quand il tente un retrait sans compte configuré.

> Trou constaté : l'écran « Compte bancaire » (`app/settings/bank-account.tsx`) est le seul des trois écrans à **ne pas** porter la garde de drapeau. Il n'est atteignable par aucun menu (ses deux points d'entrée sont eux-mêmes coupés), mais la route reste techniquement ouverte. À aligner si le drapeau doit être une garde étanche.

---

### 12.3 Le compte de paiement vendeur (Stripe Connect Custom, in-app)

#### Parcours d'onboarding (écran « Compte de paiement »)

Le vendeur remplit **un seul formulaire**, dans l'app, qui collecte tout ce qu'il faut pour activer le compte d'un coup :

1. **Informations personnelles** : prénom, nom, date de naissance (jour/mois/année).
2. **Adresse légale au Canada** : rue, ville, province (2 lettres), code postal canadien (format `A1A 1A1`).
3. **Coordonnées bancaires canadiennes** :
   - numéro de **transit** (exactement 5 chiffres),
   - numéro d'**institution** (exactement 3 chiffres),
   - numéro de **compte** (7 à 12 chiffres).

À la validation, l'app crée le compte de paiement et y rattache le compte bancaire en une opération. Le vendeur ne voit jamais d'écran Stripe, pas de redirection, pas de lien hébergé.

**Pré-remplissage** : le prénom/nom est déduit du nom affiché du profil et l'adresse est pré-remplie depuis le profil si elle existe, pour réduire la saisie. La province est pré-remplie à `QC` par défaut.

#### Règles de gestion à l'onboarding

- **Âge minimum 18 ans** : l'écran bloque l'accès si la date de naissance du profil indique moins de 18 ans. La date de naissance saisie dans le formulaire est elle aussi contrôlée côté serveur, **au jour près** (pas seulement à l'année), année ≥ 1900, date réelle valide.
- **Code postal canadien strict** : format `A1A 1A1` obligatoire (avec ou sans espace).
- **Champs bancaires stricts** : longueurs exactes (transit 5, institution 3, compte 7–12). Le numéro de transit (5) + institution (3) forme le routing canadien à 8 chiffres attendu par le système de versement.
- **Pays figé sur le Canada** : le compte est créé en `CA`, devise `CAD`, profil « individu ». Aucune autre nationalité de compte n'est prise en charge.
- **Province NON contrôlée** : le champ n'est ni une liste déroulante ni une valeur validée. C'est une saisie libre de 2 lettres majuscules, et **ni l'app ni le serveur ne vérifient qu'elle fait partie des 13 provinces/territoires canadiens**. Un vendeur peut saisir `ZZ` ; c'est Stripe qui refusera (ou pas) en aval. Trou produit à corriger si l'on veut un message d'erreur clair côté app.
- **Acceptation des conditions** : l'acceptation est horodatée et l'adresse IP réelle de l'appelant est enregistrée (preuve d'acceptation), sans intervention de l'utilisateur.
- **Idempotent + verrou** : si le vendeur a déjà un compte, l'app ne le recrée pas ; elle relit et resynchronise son statut. Deux appels simultanés ne peuvent pas créer deux comptes (verrou de création de 2 minutes, plus une clé d'idempotence côté Stripe).
- **Anti-abus** : 3 tentatives de création par minute et par vendeur.

#### Statuts du compte de paiement

Le serveur dérive un statut unique à partir des indicateurs Stripe (encaissements activés, versements activés, dossier soumis, exigences en retard, motif de blocage). L'écran affiche cinq états :

| Statut affiché | Signification métier |
|----------------|----------------------|
| **Aucun compte configuré** | Le formulaire de configuration est proposé. |
| **Votre compte est actif** | Le vendeur peut encaisser des ventes par livraison ET demander des retraits. |
| **Retraits indisponibles : action requise** | Les encaissements fonctionnent, mais les versements sont bloqués : il manque des informations. |
| **Compte restreint : action requise** | Stripe a posé un motif de blocage ou une exigence en retard. Le compte est traité comme restreint même si les encaissements marchent encore. |
| **Configuration en cours** | Compte créé, vérification d'identité en cours. |

Dans tous les cas où un compte existe, un bouton **« Actualiser le statut »** permet de revérifier à la demande, et la liste des **informations à fournir** est affichée en français lisible (traduction des exigences Stripe).

#### Régularisation d'identité (KYC) sans quitter l'app

Quand Stripe réclame une pièce d'identité, l'écran ouvre un bloc « Vérification d'identité » : le vendeur choisit une photo du **recto** (et du **verso** si demandé), l'image est compressée puis envoyée directement au prestataire de paiement (limite ~8 Mo par image, 5 envois par minute). Le statut du compte est rafraîchi dans la foulée. C'est ce qui permet de tenir la promesse white-label : le vendeur ne va jamais sur un site externe, même pour la vérification.

#### Notification quand le compte change d'état

Le vendeur est notifié automatiquement quand **une nouvelle exigence apparaît** ou quand **le compte devient restreint** (« Action requise sur votre compte vendeur »).

> Trou constaté : l'écran promet au vendeur « Vous recevrez une notification lorsque votre compte sera actif ». **Cette notification-là n'existe pas** : le passage à l'état actif est enregistré (et suivi en analytique) mais n'envoie aucun message au vendeur. Aujourd'hui, il doit revenir sur l'écran et appuyer sur « Actualiser le statut ». Copy à corriger, ou notification à ajouter.

#### Changer de compte bancaire plus tard

Le compte bancaire est posé dès la création. Le vendeur peut le **remplacer** ensuite (nouveau transit/institution/compte) depuis l'écran « Compte bancaire ». Le nouveau compte devient le compte de versement par défaut et les anciens sont supprimés, pour qu'un compte fermé ne puisse plus être choisi. Les versements restent toujours en mode **manuel** : c'est Second qui déclenche les sorties d'argent (via le retrait demandé par le vendeur), jamais un virement automatique programmé par la banque.

#### Impact produit : pourquoi c'est important avant de vendre

Pour une vente **avec livraison**, l'article ne peut pas être acheté si le vendeur n'a pas de compte de paiement avec **encaissements activés**. Cette vérification a lieu **avant** de verrouiller l'article et de débiter l'acheteur, pour ne jamais marquer « vendu » un article dont le vendeur ne pourrait pas recevoir l'argent (`functions/src/callable/payments/checkout.ts`). Pour une vente **en rencontre (meetup)**, aucun compte de paiement n'est requis : l'échange se règle en main propre, hors plateforme.

---

### 12.4 Le porte-monnaie : modèle à poches

Tous les montants du porte-monnaie sont gérés en **cents** côté système (pour éviter les erreurs d'arrondi) et affichés en dollars canadiens au format québécois (« 45,00 $ »).

Le porte-monnaie suit l'argent du vendeur à travers **trois poches** (plus une « dette » exceptionnelle) :

| Poche | Libellé app | Sens métier | Retirable ? |
|-------|-------------|-------------|-------------|
| `balance` | **Solde disponible** | Argent libéré, prêt à être retiré ou utilisé pour acheter. | Oui |
| `pendingBalance` | **… en attente** | Vente payée et étiquette d'expédition créée, mais **pas encore livrée** (séquestre, en transit). | Non |
| `heldBalance` | **… bientôt disponible** | Vente **livrée**, à l'intérieur de la fenêtre de protection acheteur de **7 jours**. | Non |
| `sellerDebt` | (bandeau « Régularisation nécessaire ») | Montant que le vendeur **doit** à la plateforme après un litige perdu / un remboursement alors qu'il avait déjà retiré les fonds. | Bloque tout retrait |

L'écran n'affiche les poches « en attente » et « bientôt disponible » que si elles sont supérieures à zéro. Pour la poche « bientôt disponible », une ligne indique la **date de mise à disposition** la plus proche (« Disponible le 12 mai 2026 »), calculée à partir des ventes livrées non encore libérées.

À l'activation, seules les poches `balance` et `pendingBalance` sont écrites ; `heldBalance` et `sellerDebt` n'apparaissent qu'au premier usage et sont lues comme zéro d'ici là. C'est sans effet visible pour le vendeur.

#### Cycle de vie de l'argent d'une vente

Pour une vente en livraison, l'argent voyage ainsi à travers les poches :

1. **Paiement confirmé** (carte ou porte-monnaie de l'acheteur) → **rien n'est encore crédité**. Le crédit vendeur est volontairement **différé jusqu'à la création réussie de l'étiquette d'expédition** : créditer puis échouer l'étiquette reviendrait à payer un vendeur pour un colis qui ne partira jamais.
2. **Étiquette créée** (dans la foulée du paiement, ou par le rattrapage automatique si le premier essai a échoué) → le montant vendeur arrive dans **`pendingBalance`**, écriture « Vente — fonds en attente de livraison ». Le montant exact crédité est mémorisé sur la commande, pour qu'un remboursement ultérieur débite exactement la même somme.
3. **Livraison confirmée** (scan transporteur) → le montant passe de `pendingBalance` vers **`heldBalance`**, et la date de libération est fixée à **livraison + 7 jours**.
4. **Fenêtre de 7 jours écoulée sans litige** → le montant passe de `heldBalance` vers **`balance`** (devient retirable). La commande passe au statut « complétée ».

Cette libération automatique est exécutée par une **tâche planifiée qui tourne toutes les heures** (`functions/src/scheduled/releaseHeldFunds.ts`), par lots de 200 commandes. Elle ne libère jamais une commande en litige, en échec de livraison, perdue ou remboursée, et revérifie ces conditions au moment exact de l'écriture. La même tâche libère aussi, sur la même fenêtre de 7 jours, les **compléments en argent des échanges (swaps)** reçus. Au moment de la libération, le vendeur reçoit une notification l'informant que la décision était **automatique** et qu'il peut la contester (transparence Loi 25, voir 12.10).

**Priorité à la dette** : si le vendeur a un solde dû, les fonds libérés servent d'abord à l'éponger ; seul le reliquat atterrit dans le solde disponible. Une écriture « Fonds libérés — régularisation du solde dû » le trace.

> Note pour les ventes en **rencontre (meetup)** : aucun argent ne transite par la plateforme (paiement cash en main propre). Le porte-monnaie n'est donc **jamais** crédité pour une rencontre, et aucune écriture comptable n'est créée — c'est explicite dans le code de clôture de rencontre.

#### La « Protection Seconde » (fenêtre de 7 jours), côté vendeur

L'écran affiche un encart « Protection Seconde » qui explique au vendeur, dans un langage clair, pourquoi son argent livré n'est pas immédiatement retirable : après une livraison, le montant est conservé 7 jours avant d'arriver dans le solde, le temps que l'acheteur puisse signaler un éventuel problème. Passé ce délai, les fonds deviennent retirables. Cette fenêtre est le pendant vendeur de la protection acheteur.

---

### 12.5 Création et activation du porte-monnaie

Le porte-monnaie peut exister de deux façons :

- **Activation explicite par l'utilisateur** : depuis l'écran « Porte-monnaie », si aucun porte-monnaie n'existe, un écran d'activation propose « Activer mon porte-monnaie ». Un seul bouton, aucun formulaire, aucune saisie bancaire. Le porte-monnaie est créé avec des soldes à zéro, en devise `CAD`, statut « actif ». L'opération est **idempotente** (rappuyer ne crée pas de doublon).
- **Création automatique à la première vente** : si un vendeur encaisse une vente sans avoir activé son porte-monnaie, le système le crée automatiquement pour pouvoir y déposer les gains. Aucune action manuelle requise côté vendeur.

À noter : ce même porte-monnaie sert aussi côté **acheteur** — le solde peut payer un achat en totalité, depuis l'écran de paiement ou le tunnel de commande. Ce paiement au porte-monnaie n'existe toutefois que sur le **rail livraison** (une commande en rencontre n'est jamais mise « en attente de paiement »), donc il est lui aussi inactif aujourd'hui. La présente section se concentre sur le rôle vendeur.

---

### 12.6 Le retrait (payout) vers la banque

#### Parcours pas à pas

Depuis l'écran « Porte-monnaie », le vendeur appuie sur **« Retirer »**. L'app enchaîne plusieurs garde-fous **avant** d'ouvrir le formulaire :

1. **Dette en cours ?** Si le porte-monnaie présente une dette (`sellerDebt > 0`), une alerte « Retrait indisponible » s'affiche avec le montant à régulariser. Le retrait est refusé d'emblée.
2. **Compte de paiement existant ?** Sinon, alerte « Compte de paiement requis » avec un bouton « Configurer » vers l'écran d'onboarding.
3. **Versements activés ?** Si le compte existe mais que les versements sont bloqués (vérification incomplète, compte bancaire fermé), alerte « Retraits indisponibles : action requise » avec un bouton « Résoudre ». Un bandeau rouge permanent le rappelle aussi sur l'écran.
4. Sinon, le formulaire de retrait s'ouvre, **pré-rempli avec la totalité du solde disponible**.

Le vendeur saisit un montant et confirme. Une alerte de confirmation rappelle le montant et la destination (« vers votre compte bancaire »). Après confirmation réussie, un message « Retrait envoyé » indique que le transfert sera traité **sous 2 à 3 jours ouvrés**.

#### Règles de gestion du retrait

- **Montant minimum : 10,00 $** (1000 cents), contrôlé côté app **et** côté serveur.
- **Montant entier positif en cents**, côté serveur (validation stricte).
- **Le retrait ne pioche QUE dans le « Solde disponible »** (`balance`). Les poches « en attente » et « bientôt disponible » ne sont jamais touchées par un retrait.
- **Solde insuffisant** → refus si le montant demandé dépasse le disponible.
- **Porte-monnaie non actif** → refus.
- **Compte de paiement** : il faut un compte existant, encaissements activés **et** versements activés. Un compte que Stripe a marqué **restreint** (motif de blocage, exigence en retard) est refusé même si les indicateurs sont encore à « vrai » — pour ne jamais lancer un virement sur un compte que l'app affiche elle-même comme restreint.
- **Litige actif** : si le vendeur a au moins une vente en litige **avec de l'argent réellement passé par la plateforme**, **tous** ses retraits sont suspendus jusqu'à résolution. Un litige de **rencontre** (signalement de rendez-vous manqué) est explicitement **exclu** de ce blocage : aucun argent n'a transité, et bloquer sur ce motif offrirait à n'importe qui un moyen gratuit de geler le porte-monnaie d'un vendeur.
- **Dette en cours** (`sellerDebt > 0`) : retraits suspendus tant que la dette n'est pas réglée. Les prochaines ventes du vendeur, et les fonds libérés à venir, servent en priorité à régulariser cette dette.
- **Limite anti-abus** : maximum **5 retraits par minute** par vendeur (limite de fréquence côté serveur).

> **Incohérence à trancher (copy vs code).** Le bandeau « Litige en cours » affiché dans le porte-monnaie dit au vendeur : « les fonds concernés sont gelés […] ; **le reste de votre solde reste disponible** ». C'est faux : le serveur refuse **la totalité** des retraits tant qu'un litige financier est ouvert. Le vendeur lit une promesse, puis se heurte à un refus. Il faut soit corriger la copy (« tous les retraits sont suspendus jusqu'à la résolution »), soit restreindre le blocage serveur au seul montant gelé.

#### Ce qui se passe en coulisses (transfert + versement)

Le retrait est exécuté en deux temps, de façon atomique et traçable :

1. Le porte-monnaie est **débité immédiatement** du montant (le solde diminue tout de suite), une écriture « Retrait vers compte bancaire ****1234 » est inscrite à l'historique, et un **document de suivi de retrait** est créé au statut « en traitement ».
2. L'argent est ensuite transféré vers le compte de paiement du vendeur, puis versé vers sa banque. Les deux appels portent une clé déterministe : un réessai ne peut jamais déplacer deux fois le même retrait.

**Garantie de sécurité financière** : si l'étape bancaire échoue, le débit du porte-monnaie est **annulé automatiquement** (les fonds sont restitués au solde) et une écriture « Retrait échoué — fonds restitués » apparaît dans l'historique. Trois raffinements importants :
- Si le versement a seulement **expiré** (erreur réseau) alors qu'il est peut-être bien parti, le système le rejoue avec la même clé : si Stripe le retrouve, le retrait est considéré **valide** et rien n'est annulé — on ne rembourse jamais un vendeur pour un virement qui va arriver.
- Si le transfert vers le compte de paiement a réussi mais que le versement bancaire a échoué, le transfert est **inversé** pour que le vendeur ne se retrouve pas avec à la fois son solde restauré ET l'argent coincé sur son compte de paiement.
- Si une inversion ne peut pas aboutir, l'opération est mise en file de réessai automatique et le vendeur est tout de même recrédité (l'expérience utilisateur prime, la réconciliation suit).

**Filet de sécurité planifié** : une tâche de réconciliation tourne **toutes les 6 heures**. Elle reprend tout retrait resté « en traitement » depuis plus d'une heure, interroge le prestataire, et clôture ou rejoue la récupération selon le cas (versement payé, échoué, annulé, ou identifiant manquant). Elle vérifie aussi l'absence de poche négative ou de dette négative sur les porte-monnaie.

#### Statuts d'un retrait

L'écran affiche une section « RETRAITS EN COURS » listant les 10 derniers retraits avec leur état :

| Statut | Signification |
|--------|---------------|
| **en traitement** | Demande enregistrée, transfert/versement en cours (2 à 3 jours ouvrés). |
| **complété** | Le versement bancaire a réussi (confirmé par notification du système de paiement). |
| **échoué** | Le versement a échoué ou a été annulé ; les fonds ont été restitués au porte-monnaie. Le motif renvoyé par la banque est affiché quand il existe. |

La clôture en « complété » / « échoué » est pilotée par des notifications asynchrones du système de paiement (versement payé / échoué / annulé), de façon **idempotente** (un même événement reçu deux fois n'agit qu'une fois).

---

### 12.7 Litiges, remboursements et la « dette vendeur »

Le porte-monnaie protège la plateforme contre le risque qu'un vendeur retire de l'argent qu'il devra finalement rendre.

- **Ouverture d'un litige (rétrofacturation acheteur)** : l'argent de la vente concernée est **gelé**. S'il était déjà dans le « Solde disponible », il est ramené dans la poche « bientôt disponible » (gelée), et le montant exact gelé est mémorisé sur la commande. Tant que le litige est ouvert, le vendeur ne peut plus faire **aucun** retrait (voir l'incohérence de copy signalée en 12.6).
- **Litige gagné par le vendeur** : le montant gelé lui est **restitué** (retour vers le solde disponible), le statut d'avant-litige est rétabli et le cycle normal de libération reprend.
- **Litige perdu** (ou remboursement d'une vente payée 100 % au porte-monnaie) : le vendeur est débité **exactement de ce qui lui avait été crédité** pour cette vente. Le débit cascade dans l'ordre du séquestre : d'abord la poche « en attente », puis « bientôt disponible », puis le « Solde disponible ». Si le vendeur avait déjà retiré ces fonds et qu'il ne reste pas assez, le manque devient une **dette** (`sellerDebt`), qui **bloque les futurs retraits** jusqu'à régularisation.
- **Vente jamais créditée** : si l'étiquette d'expédition n'a jamais abouti, le vendeur n'a rien reçu — le débit vaut alors zéro et **aucune fausse dette** n'est enregistrée.

Côté écran, une dette se matérialise par un **bandeau rouge « Régularisation nécessaire »** précisant le montant dû et expliquant que les prochaines ventes seront affectées en priorité à cette régularisation — ce que le code fait effectivement, à la fois sur les nouvelles ventes et sur les fonds libérés.

> Précision importante : la dette est **toujours** enregistrée pour le manque réel, jamais masquée. C'est volontaire — le ledger doit refléter la réalité financière.

> Le remboursement d'une vente payée **100 % au porte-monnaie** est réservé à l'**administration** (support). Un acheteur ne peut pas le déclencher lui-même : ce serait un vol pur (se rembourser après livraison tout en gardant l'article, en débitant le vendeur). Les remboursements de paiements par carte passent, eux, par le circuit de remboursement Stripe habituel.

---

### 12.8 L'historique des transactions (le « ledger »)

L'écran « Porte-monnaie » affiche un historique daté (les **20 dernières écritures**), du plus récent au plus ancien, avec une date relative (« Aujourd'hui », « Hier », « 12 mai »). Chaque écriture porte un type, un montant et une description.

Trois tonalités d'affichage : **crédit** (vert, précédé de +), **débit** (rouge, précédé de −), et **neutre** (sans signe) pour les mouvements internes entre les poches du vendeur — un passage en « bientôt disponible » ne doit jamais se lire comme une perte.

| Type | Sens métier | Affichage |
|------|-------------|-----------|
| `sale_credit` | Crédit : produit d'une vente entré dans la poche « en attente ». | Crédit |
| `funds_held` | Vente livrée → fonds passés en « bientôt disponible » (fenêtre 7 j). | Neutre |
| `funds_released` | Fenêtre de litige écoulée → fonds devenus disponibles. | Neutre |
| `debt_repayment` | Part d'une vente ou d'une libération affectée au solde dû. | Neutre |
| `withdrawal` | Retrait envoyé vers la banque. | Débit |
| `withdrawal_failed` | Retrait échoué → fonds restitués au solde. | Crédit |
| `dispute_hold` | Litige ouvert → fonds gelés. | Débit |
| `refund_debit` | Débit vendeur suite à un remboursement / litige perdu (peut enregistrer une dette). | Débit |
| `refund_credit` | (Côté acheteur) remboursement retourné au porte-monnaie. | Crédit |
| `purchase_debit` | (Côté acheteur) paiement d'un achat depuis le solde. | Débit |

Quand l'historique est vide, l'écran affiche un état vide « Aucune transaction pour le moment ».

> Trou constaté : le serveur écrit aussi un type **`dispute_hold_released`** (« Litige gagné — fonds gelés restitués ») que l'app **ne connaît pas**. Résultat concret : après un litige gagné, le vendeur voit dans son historique une ligne avec une icône générique « ? » et un montant affiché **en rouge, précédé d'un moins**, alors qu'il vient d'être **recrédité**. C'est une bonne nouvelle affichée comme une mauvaise. Correctif : ajouter ce type à la liste connue de l'app.

---

### 12.9 Monétisation et règle « 0 % vendeur »

Le modèle de frais est aligné sur un fonctionnement type Vinted, **favorable au vendeur** :

- **Le vendeur reçoit 100 % du prix de son article** : aucune commission vendeur n'est prélevée sur le produit de la vente. La poche « en attente » est créditée du prix article intégral.
- **Les frais (« frais de protection Seconde ») sont entièrement à la charge de l'acheteur** : **5 % du prix de l'article + 1,50 $ fixe**, avec un **minimum de 2,00 $**. Exemple : un article à 30 $ → frais acheteur de 3,00 $ ; à 5 $ → 2,00 $ (le minimum s'applique) ; à 100 $ → 6,50 $. Ces trois paramètres sont réglables par variable d'environnement sans toucher au code.
- Ces frais couvrent la protection acheteur (litige/remboursement), le traitement du paiement sécurisé, le support et l'infrastructure.
- **Taxes** : la TPS/TVQ ne s'applique qu'aux frais de service, et elle est **désactivée** par défaut (`TAX_ENABLED=false`) — le total acheteur est donc aujourd'hui strictement « article + livraison + frais ».
- Pour une vente en **rencontre (meetup)**, **aucun frais de plateforme** n'est appliqué et aucun argent ne transite : le porte-monnaie n'est pas concerné.

La plateforme se rémunère donc côté acheteur, via les frais de protection prélevés au moment du paiement. Le porte-monnaie vendeur n'enregistre, lui, que des crédits égaux au prix de l'article.

> **Conséquence de l'état actuel** : le seul parcours ouvert (rencontre) étant sans frais, **la plateforme n'encaisse rien aujourd'hui**. La monétisation ne démarre qu'à la réouverture du rail livraison.

> Le modèle « boutiques payantes » (offre payante en 3 forfaits) monétise par ailleurs via une **réduction des frais acheteur** appliquée côté serveur, tout en conservant la règle 0 % commission vendeur — ce volet est traité dans la section dédiée aux boutiques.

---

### 12.10 Spécificités Canada

- **Devise** : tout est en **dollars canadiens (CAD)**, affiché au format québécois (virgule décimale, symbole « $ » après le montant : « 45,00 $ »).
- **Compte bancaire** : format canadien — numéro de **transit** (5 chiffres) + **institution** (3 chiffres) + **compte** (7–12 chiffres). C'est le standard des banques canadiennes.
- **Adresse** : code postal au format `A1A 1A1` (contrôlé). La province est saisie en 2 lettres **mais n'est pas validée** contre la liste des 13 provinces/territoires — voir 12.3.
- **Loi 25 (Québec)** : la libération automatique des fonds après 7 jours est une **décision automatisée**. Elle est journalisée dans le registre des décisions automatisées (critères : livraison confirmée, absence de litige, fenêtre de 7 jours) et la notification envoyée au vendeur précise explicitement que la décision était **automatique** et qu'elle peut être **contestée** (droit à une révision humaine).
- **Confidentialité bancaire** : l'app affiche que les informations bancaires ne sont **jamais stockées** sur les serveurs de Second — c'est exact : seuls les **4 derniers chiffres** et le statut de vérification du compte sont conservés pour l'affichage (ex. « ****1234 »). Le numéro complet est transmis au prestataire de paiement et n'est jamais réécrit en base.

---

### 12.11 Spécificités iOS vs Android

Le porte-monnaie et le compte de paiement fonctionnent de manière identique sur les deux plateformes (mêmes écrans, mêmes règles, mêmes parcours). La seule différence à impact produit concerne les **notifications push** :

- Les notifications de cycle de vie des fonds (« Fonds libérés automatiquement », « Action requise sur votre compte vendeur », signalement de litige/no-show) sont envoyées en **meilleur effort** : leur échec ne bloque jamais le mouvement d'argent, qui reste enregistré dans le porte-monnaie.
- **Limite technique connue sur iOS** : le système n'envoie une notification push que si l'appareil possède un jeton compatible avec le service de messagerie utilisé. Les jetons **APNs bruts** (jetons natifs iOS) ne sont pas envoyables tels quels et sont **ignorés** volontairement (les envoyer ferait supprimer des jetons pourtant valides). Conséquence produit : un vendeur sur iOS dont l'appareil n'expose qu'un jeton natif brut peut **ne pas recevoir la push**.
- **Ce qui n'est jamais perdu** : la notification est **aussi écrite dans le centre de notifications de l'app** (soumis aux préférences de l'utilisateur), et le solde comme l'historique du porte-monnaie restent la source de vérité, mis à jour à l'ouverture de l'écran et au « tirer pour rafraîchir ». Le retrait reste possible dès que les fonds sont disponibles, indépendamment de la réception de la push.

---

### 12.12 Récapitulatif des limites et garde-fous

| Règle | Valeur |
|-------|--------|
| Module accessible aujourd'hui | **Non** — `PAYMENTS_ENABLED = false` (écrans redirigés, entrées masquées) |
| Rail d'achat actif aujourd'hui | Rencontre uniquement (`SHIPPING_ENABLED = false`) → porte-monnaie jamais crédité |
| Montant minimum de retrait | 10,00 $ (app + serveur) |
| Source d'un retrait | Uniquement le « Solde disponible » |
| Crédit vendeur (livraison) | À la **création de l'étiquette**, pas au paiement |
| Fenêtre de protection (livraison → disponible) | 7 jours |
| Fréquence de libération automatique | Toutes les heures (lots de 200) |
| Réconciliation des retraits bloqués | Toutes les 6 h, sur les retraits « en traitement » > 1 h |
| Délai annoncé d'arrivée du retrait en banque | 2 à 3 jours ouvrés |
| Limite de fréquence de retrait | 5 / minute / vendeur |
| Limite de création de compte de paiement | 3 / minute / vendeur |
| Âge minimum pour configurer un compte de paiement | 18 ans (contrôlé au jour près) |
| Compte de paiement requis pour vendre en livraison | Oui (encaissements activés) |
| Compte de paiement requis pour vendre en rencontre | Non |
| Retrait bloqué si litige **financier** ouvert | Oui (tous retraits suspendus) |
| Retrait bloqué si litige de **rencontre** | Non (exclusion anti-blocage abusif) |
| Retrait bloqué si compte restreint / versements désactivés | Oui |
| Retrait bloqué si dette (`sellerDebt`) | Oui jusqu'à régularisation |
| Commission vendeur | 0 % (le vendeur reçoit 100 % du prix article) |
| Frais (à la charge de l'acheteur) | 5 % + 1,50 $, minimum 2,00 $ |
| Taxes sur les frais | Désactivées (`TAX_ENABLED=false`) |

**Trous produit ouverts, résumés** : (1) copy « le reste de votre solde reste disponible » contredite par un blocage total des retraits en cas de litige ; (2) notification « compte devenu actif » promise mais inexistante ; (3) type d'écriture « litige gagné — fonds restitués » inconnu de l'app, affiché en rouge comme un débit ; (4) province non validée contre les 13 codes canadiens ; (5) l'écran « Compte bancaire » n'est pas protégé par le drapeau de bêta.
