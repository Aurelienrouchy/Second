3# Second — Synthèse métier

_Version 2026-06-02 · condensé du `DOCUMENT-METIER-Second.md` (1738 lignes → l'essentiel). Marketplace mode seconde main, Canada (FR), iOS + Android._

---

## En bref

**Second** est une **marketplace mobile de mode et d'objets de seconde main** (iOS + Android, Expo/React Native), pensée pour le **Canada francophone**. On y **achète, vend et échange (troc)** entre particuliers et boutiques pros. Tout est en **français** et en **dollars canadiens (CAD)**, calibré Canada (adresses, provinces, banque, **conformité Loi 25**).

- **Pour qui** : Gen Z / millennials sensibles à la durabilité et au pouvoir d'achat. Pas de statut « vendeur » distinct — **tout compte est acheteur ET vendeur**. Une couche **boutiques pro** est prévue par-dessus le C2C.
- **Ce qu'on peut faire** : naviguer sans compte (feed perso, recherche texte/filtres, **recherche visuelle par photo**) ; créer un compte (email/Google/Apple) ; **mettre en vente en quelques minutes via analyse IA des photos** ; **acheter** (Stripe) ou convenir d'une **remise en main propre** ; **faire une offre** et négocier en messagerie ; **proposer un échange** d'articles avec complément en argent ; suivre commandes/ventes, **porte-monnaie**, avis et réputation.
- **Promesse** : le **vendeur garde 100 % du prix (0 % de commission vendeur)**. La plateforme se rémunère côté **acheteur**.

---

## Modèle de revenu

| Levier | Détail | État |
|---|---|---|
| **Frais de protection acheteur** (principal) | `max(2,00 $ ; 5 % du prix + 1,50 $)`, prélevés en `application_fee_amount` sur un paiement Stripe Connect Custom. **0 % vendeur.** | **En place** |
| **Meetup (main propre)** | **Aucun frais**, aucun argent ne transite par la plateforme (règlement cash). | En place |
| **Forfaits boutique** (3 paliers : L'Atelier ~9 $ / Le Comptoir ~29 $ / La Maison ~79 $ par mois) | Monétisation **inversée** : on ne prélève pas le vendeur, on **réduit les frais acheteur** par palier (jusqu'à 0 % au palier max). | **Décidé, non implémenté** |
| **Porte-monnaie** | Moyen de paiement interne + réceptacle de remboursements (fluidifie la rétention, pas un revenu direct). | En place |

Exemples de frais acheteur : 5 $ → 2,00 $ · 30 $ → 3,00 $ · 100 $ → 6,50 $. Barème réglable sans redéploiement.

---

## Le produit (5 onglets + parcours dédiés)

**Accueil · Favoris · Vendre · Messages · Profil.**

- **Découverte / feed** : 7 sections (tendances marques, nouveautés, *Pour toi*, SwapZone, baisses de prix, vendeurs en vedette, explorer), chargement progressif, isolation des erreurs par section.
- **Recherche** : moteur **maison Firestore** (`search_index`, pas de moteur tiers), filtres (tri, catégorie, couleur, taille `{valeur,système}`, matière, marque, état, prix), **recherche visuelle** (embeddings Vertex AI, seuil ~45 %), **recherches sauvegardées + alertes** (toutes les 15 min), historique.
- **Mise en vente** : tunnel 5 écrans (capture ≤ 5 photos → **analyse IA** Gemini qui pré-remplit titre/marque/catégorie/couleurs/matières/taille/état/prix → détails → prix & livraison → aperçu → publication serveur). Brouillon unique reprenable (expire 14 j). Quota IA 10/h.
- **Messagerie** temps réel (offres, contre-offres, meetup, photos, messages système) + **modération** (signalement, blocage appliqué **côté serveur**).
- **Profil & réputation** : profil public/privé, @username **unique et immuable**, avis bidirectionnels notés 1-5, abonnement entre vendeurs.

---

## Comment ça marche (cycles de vie)

**Vente avec livraison** (réactivable, voir limites) :
`pending_payment → paid → label_created → shipped → delivered → (séquestre 7 j) → completed`. ShipEngine pour tarif/étiquette/suivi ; **« le scan livré fait foi »**. Branches : `return_requested`, `delivery_failed`, `lost`, `disputed`, `refund_in_progress`, `refunded`, `cancelled`.

**Remise en main propre (meetup)** — *seul mode actif aujourd'hui* :
`meetup_pending → meetup_confirmed (vendeur) → meetup_completed (acheteur ou vendeur)`. Cash hors plateforme, **0 frais**. Anti-blocage : expiration auto (48 h non confirmé / 7 j confirmé non finalisé) ; no-show → litige.

**Achat / paiement** : verrou **anti double-vente** atomique ; prix négocié borné à une **offre acceptée** ; **destination charge** Stripe Connect Custom (vendeur jamais sur Stripe) ; Apple Pay / Google Pay si configurés ; confirmation **par webhook serveur** (jamais le client) ; idempotence (`pi_{txId}`).

**Offres** : montant (+ message, + lieu meetup), bulle interactive, accepter/refuser/contre-proposer (aller-retours illimités), **expiration 48 h** (serveur horaire). Pas un achat tant que non accepté.

**Swap (troc)** : `proposed → payment_pending (si complément) → accepted → photos_pending → shipping → completed`. **Complément en argent (top-up)** plafonné 5 000 $, payé via Stripe (mêmes frais acheteur, 0 % bénéficiaire). **SwapZone** = zone d'échange **permanente, généraliste, univers visuel sombre** (a remplacé les swap-parties éphémères ; objectif liquidité).

---

## Confiance, sécurité & conformité

- **Séquestre 7 jours** : 3 poches de porte-monnaie — `balance` (retirable), `pendingBalance` (payé non livré), `heldBalance` (livré, fenêtre litige). `sellerDebt` bloque les retraits après litige perdu.
- **Anti-fraude, jamais sur parole** : remboursement auto seulement sur signal **objectif** du transporteur (perdu/échec, ou retour réceptionné). Sinon → réclamation, fonds gelés, **revue humaine admin**. 3 recours acheteur : remboursement auto · signaler un problème · demander un retour (frais de retour à sa charge).
- **Filet financier** : file de re-jeu (`failed_operations`, backoff, 6 essais) + réconciliation (toutes les 6 h). **Principe d'or** : toute mutation argent/statut via Cloud Function + `runTransaction` idempotent ; **jamais côté client**.
- **Loi 25 (Québec) + PIPEDA + LCAP** : consentement horodaté/versionné append-only ; **âge ≥ 16** (achat) / **≥ 18** (vente) ; vie privée **OFF par défaut** ; **export** JSON ; **suppression** avec garde-fous financiers serveur ; **décisions automatisées** (libération J+7, annulations) journalisées, expliquées et **contestables** ; registre d'incidents (escalade **CAI**) ; purge de rétention (transactions conservées **7 ans**). Données serveur à **Montréal** (`northamerica-northeast1`).

---

## Différenciateurs

**0 % commission vendeur** · frais 100 % acheteur transparents · **paiement white-label** (Stripe Connect Custom) · **troc structuré** avec complément en argent · **recherche visuelle** · **mise en vente assistée IA** · **SwapZone** · **meetup local gratuit + livraison nationale** · **conformité Loi 25 native**. Positionnement : modèle de frais « façon **Vinted** » (vendeur gratuit) ; différenciation frontale vs **Poshmark** (qui prélève le vendeur).

---

## Spécificités Canada

CAD partout (`45,00 $`) · livraison **Canada uniquement** (13 provinces, code postal `A1A 1A1`, validés serveur) · transporteurs Intelcom/Postes Canada/UPS via ShipEngine · banque canadienne (transit 5 + institution 3 + compte 7-12) · identité fiscale boutique **NEQ/TPS/TVQ** · téléphone `+1` · âge calculé en **America/Toronto** · hébergement & traitements à **Montréal**.

---

## iOS vs Android (impacts produit)

App ~95 % identique. Différences clés : **push** (Android FCM **opérationnel** / **iOS non opérationnel** — voir limites) ; **Apple Sign-In** obligatoire iOS, absent Android ; **ré-auth Apple impossible sur Android** (ajouter un mot de passe d'abord) ; bottom sheets montés à l'ouverture (anti-voile Android) ; channels de notification Android obligatoires.

---

## Limites & chantiers connus (cadrés, pas des inconnues)

- **Push iOS non opérationnel** : jeton APNs brut non routable via FCM (détecté/ignoré). In-app + badge complets sur iOS ; correctif = Expo Push ou Firebase Messaging natif.
- **Universal/App Links non finalisés** : placeholders Team ID / SHA256 → un lien partagé ouvre le navigateur.
- **Migration de l'index de recherche à faire avant prod** : articles anciens invisibles tant que `moderationStatus` + tailles `{valeur,système}` + reconstruction `search_index` ne sont pas faits (ordre impératif).
- **Expédition désactivée par drapeau** (`SHIPPING_ENABLED = false`) : seul le **meetup** est actif ; tout le moteur Stripe/ShipEngine reste intégré et réactivable.
- **Boutiques payantes** : vitrine + modération admin livrées ; **création self-service, forfaits et frais modulés non implémentés** (fondations de sécurité déjà posées).
- **Divers** : Apple Pay/Google Pay à activer · carte Google Maps sans clé iOS · export Loi 25 calculé client (swaps/wallet non inclus) · affichage de complément swap en cents bruts dans certaines vues.

---

> **Mise à jour post-audit (2026-06-02).** Ce condensé reflète le `DOCUMENT-METIER` daté du 2026-06-01. Depuis, une campagne de correction a **fermé en prod** 3 limites qui y figurent encore : le **no-show meetup** déclenche désormais la vraie Cloud Function (gel + libération article + litige) et la **complétion meetup** est ouverte au vendeur ; le **litige swap post-réception** est devenu effectif (fenêtre de protection 7 j via `heldBalance`) ; le **blocage messagerie** est durci côté serveur (contre-participant dérivé du chat, chats préexistants couverts). Restent ouverts : push iOS, universal links, migration `search_index`, build de l'offre boutiques.
