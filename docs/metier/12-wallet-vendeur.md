## 12. Porte-monnaie & paiements vendeur

Cette section décrit comment un vendeur reçoit l'argent de ses ventes, le suit dans l'application, et le transfère vers son compte bancaire. Tout le parcours est intégré dans l'app : le vendeur ne quitte jamais Second et ne voit jamais l'interface de Stripe. C'est le choix « white-label » assumé de la plateforme : c'est Second qui porte la relation, l'identité visuelle et la conformité.

### 12.1 Deux briques distinctes : le compte de paiement et le porte-monnaie

Il faut bien séparer deux objets, qui sont souvent confondus mais qui ont des rôles différents.

| Brique | Rôle métier | Où le vendeur la voit |
|--------|-------------|------------------------|
| **Compte de paiement** (Stripe Connect Custom, « tuyau » bancaire) | Rattache l'identité et le compte bancaire du vendeur. C'est le canal par lequel l'argent sort vers la banque. Sans lui, aucun retrait possible. | Écran « Compte de paiement » (`settings/stripe-onboarding`) |
| **Porte-monnaie** (« wallet », registre interne de Second) | Compte virtuel qui suit, en temps réel, ce que le vendeur a gagné, ce qui est en cours, ce qui est bientôt disponible et ce qui est retirable. C'est le « solde Second ». | Écran « Porte-monnaie » (`wallet`) |

Le porte-monnaie est la **source de vérité** des gains du vendeur côté Second. Le compte de paiement n'est que le robinet de sortie vers la banque.

### 12.2 Accès et points d'entrée

Le porte-monnaie est accessible depuis :
- l'onglet **Profil** (entrée « Porte-monnaie ») ;
- le menu **Réglages** (`settings/index`).

Le compte de paiement est accessible depuis les réglages de paiement, et l'app y redirige automatiquement le vendeur quand il tente un retrait sans compte configuré.

---

### 12.3 Le compte de paiement vendeur (Stripe Connect Custom, in-app)

#### Parcours d'onboarding (écran « Compte de paiement »)

Le vendeur remplit **un seul formulaire**, dans l'app, qui collecte tout ce qu'il faut pour activer le compte d'un coup :

1. **Informations personnelles** : prénom, nom, date de naissance (jour/mois/année).
2. **Adresse légale au Canada** : rue, ville, province (parmi les 13 provinces/territoires), code postal canadien (format `A1A 1A1`).
3. **Coordonnées bancaires canadiennes** :
   - numéro de **transit** (exactement 5 chiffres),
   - numéro d'**institution** (exactement 3 chiffres),
   - numéro de **compte** (7 à 12 chiffres).

À la validation, l'app crée le compte de paiement et y rattache le compte bancaire en une opération. Le vendeur ne voit jamais d'écran Stripe, pas de redirection, pas de lien hébergé.

**Pré-remplissage** : le prénom/nom est déduit du nom affiché du profil et l'adresse est pré-remplie depuis le profil si elle existe, pour réduire la saisie.

#### Règles de gestion à l'onboarding

- **Âge minimum 18 ans** : l'écran bloque l'accès si la date de naissance du profil indique moins de 18 ans (cohérent avec l'exigence d'un compte de versement). La date de naissance saisie dans le formulaire est elle aussi contrôlée (minimum 18 ans, année ≥ 1900, date réelle valide).
- **Code postal canadien strict** : format `A1A 1A1` obligatoire.
- **Champs bancaires stricts** : longueurs exactes (transit 5, institution 3, compte 7–12). Le numéro de transit (5) + institution (3) forme le routing canadien à 8 chiffres attendu par le système de versement.
- **Pays figé sur le Canada** : le compte est créé en `CA`, devise `CAD`, profil « individu ». Aucune autre nationalité de compte n'est prise en charge.
- **Acceptation des conditions** : l'acceptation est horodatée et l'adresse IP de l'appelant est enregistrée (preuve d'acceptation), sans intervention de l'utilisateur.
- **Idempotent** : si le vendeur a déjà un compte, l'app ne le recrée pas ; elle relit et resynchronise simplement son statut.

#### Statuts du compte de paiement

L'écran affiche un état clair, dérivé de trois indicateurs (paiements activés, versements activés, dossier soumis) :

| Statut affiché | Signification métier |
|----------------|----------------------|
| **Actif** | Le vendeur peut encaisser des ventes par livraison ET demander des retraits. |
| **Configuration en cours** | Compte créé, mais en cours de vérification d'identité. Le vendeur sera notifié quand il devient actif. Un bouton « Actualiser le statut » permet de revérifier. |
| **Aucun compte configuré** | Le formulaire de configuration est proposé. |

#### Changer de compte bancaire plus tard

Le compte bancaire est posé dès la création. Le vendeur peut le **remplacer** ensuite (nouveau transit/institution/compte). Les versements restent toujours en mode **manuel** : c'est Second qui déclenche les sorties d'argent (via le retrait demandé par le vendeur), jamais un virement automatique programmé par la banque.

#### Impact produit : pourquoi c'est important avant de vendre

Pour une vente **avec livraison**, l'article ne peut pas être acheté si le vendeur n'a pas de compte de paiement **actif** (paiements activés). Cette vérification a lieu **avant** de verrouiller l'article et de débiter l'acheteur, pour ne jamais marquer « vendu » un article dont le vendeur ne pourrait pas recevoir l'argent. Pour une vente **en rencontre (meetup)**, aucun compte de paiement n'est requis : l'échange se règle en main propre, hors plateforme.

---

### 12.4 Le porte-monnaie : modèle à poches

Tous les montants du porte-monnaie sont gérés en **cents** côté système (pour éviter les erreurs d'arrondi) et affichés en dollars canadiens au format québécois (« 45,00 $ »).

Le porte-monnaie suit l'argent du vendeur à travers **trois poches** (plus une « dette » exceptionnelle) :

| Poche | Libellé app | Sens métier | Retirable ? |
|-------|-------------|-------------|-------------|
| `balance` | **Solde disponible** | Argent libéré, prêt à être retiré ou utilisé pour acheter. | Oui |
| `pendingBalance` | **… en attente** | Vente payée mais **pas encore livrée** (sous séquestre, en transit). | Non |
| `heldBalance` | **… bientôt disponible** | Vente **livrée**, à l'intérieur de la fenêtre de protection acheteur de **7 jours**. | Non |
| `sellerDebt` | (bandeau « Régularisation nécessaire ») | Montant que le vendeur **doit** à la plateforme après un litige perdu / un remboursement alors qu'il avait déjà retiré les fonds. | Bloque tout retrait |

L'écran n'affiche les poches « en attente » et « bientôt disponible » que si elles sont supérieures à zéro. Pour la poche « bientôt disponible », une ligne indique la **date de mise à disposition** (« Disponible le 12 mai 2026 »).

#### Cycle de vie de l'argent d'une vente

Pour une vente en livraison, l'argent voyage ainsi à travers les poches :

1. **Paiement confirmé** (carte ou porte-monnaie de l'acheteur) → le montant vendeur arrive dans **`pendingBalance`** (séquestre, vente en cours).
2. **Livraison confirmée** (scan transporteur) → le montant passe de `pendingBalance` vers **`heldBalance`**, et la date de libération est fixée à **livraison + 7 jours**.
3. **Fenêtre de 7 jours écoulée sans litige** → le montant passe de `heldBalance` vers **`balance`** (devient retirable). La transaction passe au statut « complétée ».

Cette libération automatique est exécutée par une **tâche planifiée qui tourne toutes les heures**. Elle ne libère jamais une transaction en litige, en échec de livraison, perdue ou remboursée. Au moment de la libération, le vendeur reçoit une notification l'informant que la décision était **automatique** et qu'il peut la contester (transparence Loi 25, voir 12.9).

> Note pour les ventes en **rencontre (meetup)** : aucun argent ne transite par la plateforme (paiement cash en main propre). Le porte-monnaie n'est donc **jamais** crédité pour une rencontre, et aucune écriture comptable n'est créée.

#### La « Protection Seconde » (fenêtre de 7 jours), côté vendeur

L'écran affiche un encart « Protection Seconde » qui explique au vendeur, dans un langage clair, pourquoi son argent livré n'est pas immédiatement retirable : après une livraison, le montant est conservé 7 jours avant d'arriver dans le solde, le temps que l'acheteur puisse signaler un éventuel problème. Passé ce délai, les fonds deviennent retirables. Cette fenêtre est le pendant vendeur de la protection acheteur.

---

### 12.5 Création et activation du porte-monnaie

Le porte-monnaie peut exister de deux façons :

- **Activation explicite par l'utilisateur** : depuis l'écran « Porte-monnaie », si aucun porte-monnaie n'existe, un écran d'activation propose « Activer mon porte-monnaie ». Un seul bouton, aucun formulaire, aucune saisie bancaire. Le porte-monnaie est créé avec des soldes à zéro, en devise `CAD`, statut « actif ». L'opération est **idempotente** (rappuyer ne crée pas de doublon).
- **Création automatique à la première vente** : si un vendeur encaisse une vente sans avoir activé son porte-monnaie, le système le crée automatiquement pour pouvoir y déposer les gains. Aucune action manuelle requise côté vendeur.

À noter : ce même porte-monnaie sert aussi côté **acheteur** (le solde peut servir à payer des achats, en totalité ou en complément d'une carte). La présente section se concentre sur le rôle vendeur.

---

### 12.6 Le retrait (payout) vers la banque

#### Parcours pas à pas

Depuis l'écran « Porte-monnaie », le vendeur appuie sur **« Retirer »**. Le système enchaîne plusieurs garde-fous **avant** d'ouvrir le formulaire :

1. **Dette en cours ?** Si le porte-monnaie présente une dette (`sellerDebt > 0`), une alerte « Retrait indisponible » s'affiche avec le montant à régulariser. Le retrait est refusé d'emblée.
2. **Compte de paiement prêt ?** Si le vendeur n'a pas de compte de paiement avec versements activés, une alerte « Compte de paiement requis » propose de le configurer (redirection vers l'écran d'onboarding).
3. Sinon, le formulaire de retrait s'ouvre, **pré-rempli avec la totalité du solde disponible**.

Le vendeur saisit un montant et confirme. Une alerte de confirmation rappelle le montant et la destination (« vers votre compte bancaire »). Après confirmation réussie, un message « Retrait envoyé » indique que le transfert sera traité **sous 2 à 3 jours ouvrés**.

#### Règles de gestion du retrait

- **Montant minimum : 10,00 $** (1000 cents). En dessous, refus.
- **Montant entier positif en cents**, côté serveur (validation stricte).
- **Le retrait ne pioche QUE dans le « Solde disponible »** (`balance`). Les poches « en attente » et « bientôt disponible » ne sont jamais touchées par un retrait.
- **Solde insuffisant** → refus si le montant demandé dépasse le disponible.
- **Porte-monnaie non actif** → refus.
- **Litige actif** : si le vendeur a **au moins une vente en litige** ouvert, tous ses retraits sont **suspendus** jusqu'à résolution, même sur la partie disponible. L'app affiche un message dédié « Retrait momentanément indisponible » plutôt qu'une erreur technique.
- **Dette en cours** (`sellerDebt > 0`) : retraits suspendus tant que la dette n'est pas réglée. Les prochaines ventes du vendeur servent en priorité à régulariser cette dette.
- **Limite anti-abus** : maximum **5 retraits par minute** par vendeur (limite de fréquence côté serveur).

#### Ce qui se passe en coulisses (transfert + versement)

Le retrait est exécuté en deux temps, de façon atomique et traçable :

1. Le porte-monnaie est **débité immédiatement** du montant (le solde diminue tout de suite), une écriture « Retrait vers compte bancaire ****1234 » est inscrite à l'historique, et un **document de suivi de retrait** est créé au statut « en traitement ».
2. L'argent est ensuite transféré vers le compte de paiement du vendeur puis versé vers sa banque.

**Garantie de sécurité financière** : si l'étape bancaire échoue, le débit du porte-monnaie est **annulé automatiquement** (les fonds sont restitués au solde) et une écriture « Retrait échoué — fonds restitués » apparaît dans l'historique. Le cas particulier où le transfert vers le compte de paiement a réussi mais le versement bancaire a échoué est géré : le transfert est inversé pour que le vendeur ne se retrouve jamais avec à la fois son solde restauré ET l'argent coincé sur le compte de paiement. Si une inversion ne peut pas aboutir, l'opération est mise en file de réessai automatique et le vendeur est tout de même recrédité (l'expérience utilisateur prime).

#### Statuts d'un retrait

Le suivi du retrait suit ces états :

| Statut | Signification |
|--------|---------------|
| **en traitement** | Demande enregistrée, transfert/versement en cours. |
| **complété** | Le versement bancaire a réussi (confirmé par notification du système de paiement). |
| **échoué** | Le versement a échoué ; les fonds ont été restitués au porte-monnaie. |

La clôture en « complété » / « échoué » est pilotée par des notifications asynchrones du système de paiement (événements de versement payé / échoué), de façon **idempotente** (un même événement reçu deux fois n'agit qu'une fois).

---

### 12.7 Litiges, remboursements et la « dette vendeur »

Le porte-monnaie protège la plateforme contre le risque qu'un vendeur retire de l'argent qu'il devra finalement rendre.

- **Ouverture d'un litige (rétrofacturation acheteur)** : l'argent de la vente concernée est **gelé**. S'il était déjà dans le « Solde disponible », il est ramené dans la poche « bientôt disponible » (gelée). Tant que le litige est ouvert, le vendeur ne peut plus faire **aucun** retrait.
- **Litige gagné par le vendeur** : le vendeur garde son argent, le cycle normal de libération reprend.
- **Litige perdu** (ou remboursement d'une vente payée 100 % au porte-monnaie) : le vendeur est débité **exactement de ce qui lui avait été crédité** pour cette vente. Le débit cascade dans l'ordre du séquestre : d'abord la poche « en attente », puis « bientôt disponible », puis le « Solde disponible ». Si le vendeur avait déjà retiré ces fonds et qu'il ne reste pas assez, le manque devient une **`sellerDebt`** (dette), qui **bloque les futurs retraits** jusqu'à régularisation.

Côté écran, une dette se matérialise par un **bandeau rouge « Régularisation nécessaire »** précisant le montant dû et expliquant que les prochaines ventes seront affectées en priorité à cette régularisation.

> Précision importante : la dette est **toujours** enregistrée pour le manque réel, jamais masquée. C'est volontaire — le ledger doit refléter la réalité financière.

---

### 12.8 L'historique des transactions (le « ledger »)

L'écran « Porte-monnaie » affiche un historique daté (les 20 dernières écritures), du plus récent au plus ancien, avec une date relative (« Aujourd'hui », « Hier », « 12 mai »). Chaque écriture porte un type, un montant signé (crédit en vert avec +, débit en rouge avec –) et une description.

Types d'écritures visibles par le vendeur (et leur sens) :

| Type | Sens métier |
|------|-------------|
| `sale_credit` | Crédit : produit d'une vente entrée dans la poche « en attente ». |
| `funds_held` | Vente livrée → fonds passés en « bientôt disponible » (fenêtre de litige 7 j). |
| `funds_released` | Fenêtre de litige écoulée → fonds devenus disponibles. |
| `withdrawal` | Retrait envoyé vers la banque. |
| `withdrawal_failed` | Retrait échoué → fonds restitués au solde. |
| `dispute_hold` | Litige ouvert → fonds gelés. |
| `refund_debit` | Débit vendeur suite à un remboursement / litige perdu (peut enregistrer une dette). |
| `refund_credit` | (Côté acheteur) remboursement retourné au porte-monnaie. |
| `purchase_debit` | (Côté acheteur) paiement d'un achat depuis le solde. |

Quand l'historique est vide, l'écran affiche un état vide « Aucune transaction pour le moment ».

---

### 12.9 Monétisation et règle « 0 % vendeur »

Le modèle de frais est aligné sur un fonctionnement type Vinted, **favorable au vendeur** :

- **Le vendeur reçoit 100 % du prix de son article** : aucune commission vendeur n'est prélevée sur le produit de la vente. La poche « en attente » est créditée du prix article intégral.
- **Les frais (« frais de protection Seconde ») sont entièrement à la charge de l'acheteur** : **5 % du prix de l'article + 1,50 $ fixe**, avec un **minimum de 2,00 $**. Exemple : un article à 30 $ → frais acheteur de 3,00 $.
- Ces frais couvrent la protection acheteur (litige/remboursement), le traitement du paiement sécurisé, le support et l'infrastructure.
- Pour une vente en **rencontre (meetup)**, **aucun frais de plateforme** n'est appliqué et aucun argent ne transite : le porte-monnaie n'est pas concerné.

La plateforme se rémunère donc côté acheteur, via les frais de protection prélevés au moment du paiement (la commission de service est captée lors de l'encaissement). Le porte-monnaie vendeur n'enregistre, lui, que des crédits égaux au prix de l'article.

> Le modèle « boutiques payantes » (offre payante en 3 forfaits) monétise par ailleurs via une **réduction des frais acheteur**, tout en conservant la règle 0 % commission vendeur — ce volet est traité dans la section dédiée aux boutiques.

---

### 12.10 Spécificités Canada

- **Devise** : tout est en **dollars canadiens (CAD)**, affiché au format québécois (virgule décimale, symbole « $ » après le montant : « 45,00 $ »).
- **Compte bancaire** : format canadien — numéro de **transit** (5 chiffres) + **institution** (3 chiffres) + **compte** (7–12 chiffres). C'est le standard des banques canadiennes.
- **Adresse** : provinces/territoires limités aux **13 codes canadiens** (AB, BC, MB, NB, NL, NS, NT, NU, ON, PE, QC, SK, YT), code postal au format `A1A 1A1`.
- **Loi 25 (Québec)** : la libération automatique des fonds après 7 jours est une **décision automatisée**. Elle est journalisée (registre des décisions automatisées) et la notification envoyée au vendeur précise explicitement que la décision était **automatique** et qu'elle peut être **contestée** (droit à une révision humaine). De même, lors d'un signalement de rencontre manquée, la partie visée est informée qu'elle peut contester.
- **Confidentialité bancaire** : l'app affiche que les informations bancaires ne sont **jamais stockées** sur les serveurs de Second (elles sont transmises au prestataire de paiement). Seuls les **4 derniers chiffres** du compte sont conservés pour l'affichage (ex. « ****1234 »).

---

### 12.11 Spécificités iOS vs Android

Le porte-monnaie et le compte de paiement fonctionnent de manière identique sur les deux plateformes (mêmes écrans, mêmes règles, mêmes parcours). La seule différence à impact produit concerne les **notifications push** :

- Les notifications de cycle de vie des fonds (ex. « Fonds libérés automatiquement », « Compte en cours de vérification devenu actif », signalement de litige/no-show) sont envoyées en **meilleur effort** (« best-effort ») : leur échec ne bloque jamais le mouvement d'argent, qui reste enregistré dans le porte-monnaie.
- **Limite technique connue sur iOS** : le système n'envoie une notification que si l'appareil possède un jeton compatible avec le service de messagerie utilisé. Les jetons **APNs bruts** (jetons natifs iOS) ne sont pas envoyables tels quels et sont **ignorés** par l'envoi push. Conséquence produit : un vendeur sur iOS dont l'appareil n'expose qu'un jeton natif brut peut **ne pas recevoir** la notification de libération de fonds. Dans tous les cas, l'information reste **fiable et visible dans l'app** : le solde et l'historique du porte-monnaie sont la source de vérité, mis à jour à l'ouverture de l'écran et au « tirer pour rafraîchir ». Le retrait reste possible dès que les fonds sont disponibles, indépendamment de la réception de la notification.

---

### 12.12 Récapitulatif des limites et garde-fous

| Règle | Valeur |
|-------|--------|
| Montant minimum de retrait | 10,00 $ |
| Source d'un retrait | Uniquement le « Solde disponible » |
| Fenêtre de protection (livraison → disponible) | 7 jours |
| Fréquence de libération automatique | Toutes les heures (tâche planifiée) |
| Délai annoncé d'arrivée du retrait en banque | 2 à 3 jours ouvrés |
| Limite de fréquence de retrait | 5 / minute / vendeur |
| Âge minimum pour configurer un compte de paiement | 18 ans |
| Compte de paiement requis pour vendre en livraison | Oui (actif) |
| Compte de paiement requis pour vendre en rencontre | Non |
| Retrait bloqué si litige ouvert | Oui (tous retraits suspendus) |
| Retrait bloqué si dette (`sellerDebt`) | Oui jusqu'à régularisation |
| Commission vendeur | 0 % (le vendeur reçoit 100 % du prix article) |
| Frais (à la charge de l'acheteur) | 5 % + 1,50 $, minimum 2,00 $ |
