# Roadmap Seconde — Draft de travail

> État initial corrigé : app iOS déjà soumise/publiée sur l'App Store, Android Play Store à faire, 0 utilisateur, aucun financement. Victorine aurait 50% des parts sans rôle dirigeant et pilote la communication. Lancement **sans shipping** tant que le flux livraison n'est pas parfait.

## 1. État des lieux — 2026-06-30

### Business / lancement

- **iOS** : app présente sur l'App Store.
- **Android** : publication Play Store à faire.
- **Utilisateurs** : 0 utilisateur à date.
- **Financement** : aucun financement à date.
- **Société** : à créer / structurer, notamment parce que Stripe demande une entité claire pour les paiements / Connect / KYC.
- **Équipe** : Aurélien côté produit/tech ; Victorine côté communication, avec 50% des parts envisagées mais sans rôle dirigeant opérationnel.
- **Shipping** : exclu du lancement public initial. Il doit être activé seulement après validation complète : tarifs, labels, tracking, litiges, remboursements, coûts réels.

### Code / produit

- Repo : `Aurelienrouchy/Second`, cloné en local dans `/root/repos/Second`.
- Stack : Expo / React Native / TypeScript / Firebase / Cloud Functions Node 20 / Stripe Connect Custom / ShipEngine.
- Paiement/livraison : rail Stripe + ShipEngine très avancé côté code, mais livraison désactivée côté UI via `config/featureFlags.ts` (`SHIPPING_ENABLED = false`).
- Boutiques : modèle de données, vitrine publique, modération admin et rail d'achat de forfait existent partiellement. Les forfaits restent à calibrer produit/business.
- Tests exécutés : `npm run test` OK (78 tests Vitest), `npm --prefix functions run build` OK.
- Problèmes techniques connus : `npm run typecheck:tests` échoue sur des types de mocks dans `tests/jest/chatService.send.test.ts`; audit npm avec vulnérabilités à trier.

---

## 2. Priorité immédiate — checklist pré-lancement Android / base saine

Objectif : sortir Android proprement et ne pas bloquer Stripe / Play Store / App Store pour des raisons administratives.

### P0 — Play Store

- Créer / finaliser le compte Google Play Console si pas déjà fait.
- Vérifier nom, bundle id, icônes, screenshots, description courte/longue, catégorie, politique de confidentialité.
- Remplir Data Safety Google Play : données collectées, partage, chiffrement, suppression de compte.
- Déclarer fonctionnalités sensibles : localisation, caméra/photos, notifications, paiement si applicable.
- Produire build Android EAS compatible Play Store.
- Tester build Android réel avant soumission.
- Soumettre en internal testing, puis production quand stable.

### P0 — Société / Stripe / conformité

- Décider structure juridique : probablement incorporation Canada/Québec à valider.
- Clarifier rôles : Victorine 50% parts mais non dirigeante opérationnelle.
- Créer / mettre à jour compte Stripe avec entité légale correcte.
- Vérifier exigences Stripe Connect Custom : business profile, beneficial owners, représentants, compte bancaire, KYC.
- Aligner CGU / politique confidentialité / mentions légales avec l'entité.
- Valider point immigration / visa fermé de Victorine avant officialisation de toute fonction dirigeante.

### P0 — Version publique sans shipping

- Assumer le positionnement initial : marketplace locale / remise en main propre.
- Masquer tout wording qui promet livraison si `SHIPPING_ENABLED = false`.
- S'assurer que les écrans shipping ne sont pas accessibles par deep link.
- Mettre la promesse utilisateur au clair : vendre/acheter localement, discuter, se rencontrer, 0% commission vendeur.

---

## 3. Roadmap produit recommandée

### Phase 1 — Lancement local sans shipping

**Objectif : obtenir les premiers vrais listings et les premiers vrais utilisateurs.**

Scope produit :

- Inscription / onboarding.
- Création d'article.
- Recherche / feed / favoris.
- Chat et offres.
- Meetup / remise en main propre.
- Profil vendeur.
- Signalement / modération minimale.
- Suppression de compte / conformité de base.

Ce qu'on n'active pas encore :

- Shipping.
- Paiement in-app pour livraison.
- Wallet vendeur.
- Retours / litiges shipping.
- Promesse de frais de protection sur shipping.

### Phase 2 — 1000 premiers utilisateurs

**Owner principal : Victorine côté communication.**

Objectif : atteindre 1000 inscrits ou 1000 utilisateurs qualifiés locaux, mais surtout générer du stock et de l'usage.

#### Cibles prioritaires

1. **Vendeuses/vendeurs individuels Montréal** : étudiants, jeunes actifs, déménagements, gens avec placards à vider.
2. **Micro-communautés mode** : friperie, vintage, streetwear, créateurs locaux.
3. **Friperies pilotes** : 5 à 10 commerces à onboarder manuellement.
4. **Acheteurs locaux** : personnes qui veulent acheter sans frais de livraison et voir la pièce rapidement.

#### Plan d'acquisition zéro budget

| Canal | Action | Objectif |
|---|---|---|
| TikTok / Reels | Vidéos courtes : vider son dressing, looks thriftés, pièces trouvées à Montréal | Awareness locale |
| Instagram | Compte éditorial : pièces de la semaine, vendeurs, friperies, stories sondages | Crédibilité + communauté |
| Friperies | Aller physiquement proposer un profil boutique gratuit/pilote | Stock initial |
| Campus | Concordia / UQAM / McGill : groupes, affiches, ambassadeurs informels | Premiers vendeurs |
| Reddit / Facebook | Groupes Montréal, thrift, marketplace alternatives | Trafic qualifié |
| Ambassadeurs | 10 personnes avec code/parrainage symbolique | Boucle organique |
| PR locale | Pitch médias locaux : app montréalaise de seconde main | Légitimité |

#### KPI 1000 users à suivre

- Nombre d'inscrits.
- Nombre d'articles publiés.
- Ratio utilisateurs avec ≥1 article publié.
- Nombre de conversations créées.
- Nombre d'offres / demandes meetup.
- Nombre de vendeurs actifs 7 jours.
- Nombre de boutiques/friperies contactées, intéressées, onboardées.

### Phase 3 — Livraison : recherche partenaire + proof-of-cost

**Objectif : trouver le partenaire de livraison le moins cher et fiable pour les utilisateurs, avant activation.**

Hypothèse actuelle : ShipEngine est intégré comme agrégateur, mais il faut valider le meilleur rail réel au Canada/Québec.

À comparer :

- Canada Post / Postes Canada.
- Chit Chats.
- Stallion Express.
- NetParcel.
- Freightcom / ClickShip.
- Sendle Canada si pertinent.
- ShipEngine comme couche d'agrégation.
- Options locales Montréal si elles existent pour petit colis.

Critères de choix :

| Critère | Pourquoi |
|---|---|
| Prix petit colis Canada | Cas principal vêtements/accessoires |
| Couverture Québec/Canada | Montréal d'abord, puis Canada |
| Tracking fiable | Nécessaire pour séquestre / litiges |
| Achat label API | Indispensable pour automatisation |
| Retours | Important avant shipping public |
| Assurance | Pour articles plus chers |
| Dépôt / pickup | Friction vendeur |
| Support litiges | Expérience utilisateur |
| Coût plateforme vs coût utilisateur | Éviter marge négative |

Décision recommandée : ne pas activer shipping tant qu'on n'a pas un tableau de coûts réel sur 10 scénarios : Montréal→Montréal, Montréal→Toronto, Montréal→Vancouver, petit colis, moyen colis, avec/sans tracking, retour.

### Phase 4 — Paiement / shipping public

Activer seulement quand :

- Société + Stripe OK.
- Webhooks Stripe platform + Connect OK.
- Webhook tracking livraison OK.
- Tests device iOS/Android OK.
- Parcours remboursement / annulation / litige compris.
- Coût réel label vs coût facturé testé.
- Support utilisateur prêt.

### Phase 5 — Boutiques / friperies payantes

Objectif : créer une offre B2B utile, pas juste une vitrine payante.

Forfaits à définir ensemble :

| Palier | Cible | Prix indicatif à discuter | Promesse |
|---|---|---:|---|
| Basic | vendeur / boutique test | 0$ | présence minimale, frais acheteur standards |
| Pro | petite friperie / power seller | à définir | quota stock, vitrine locale, réduction frais acheteur, outils stock simples |
| Premium | dépôt-vente / boutique volume | à définir | consignation, équipe, analytics/export, priorité locale |

Features à prioriser pour commerces physiques :

1. Quotas d'articles par forfait.
2. Badge Commerce vérifié NEQ.
3. Itinéraire + ouvert/fermé sur page boutique.
4. Saisie de masse photo + IA ou CSV.
5. Stock magasin ↔ en ligne / vendu en boutique.
6. Click & Collect.
7. Consignation : déposants + ledger interne + relevés.
8. Dashboard boutique + export comptable.

---

## 4. Stratégie bêta / feature flags

Deux options possibles :

### Option A — Une seule app avec feature flags

Recommandée pour maintenant.

Avantages :

- Une seule base App Store / Play Store.
- Moins de complexité de review.
- Possibilité d'activer shipping, boutiques, paiement, bêta par utilisateur / rôle / remote config.
- Cohérent avec le code actuel (`SHIPPING_ENABLED`) mais à rendre plus flexible.

À faire :

- Transformer les flags statiques en flags distants ou server-driven.
- Ajouter des gates par rôle : admin, beta tester, shop pilot, public.
- Garder shipping désactivé pour public mais activable pour comptes test.

### Option B — Deux apps : production + bêta

Pertinent plus tard si besoin.

Avantages :

- Une app publique stable.
- Une app bêta pour shipping, boutiques, paiements risqués.

Inconvénients :

- Plus lourd App Store / Play Store.
- Plus de builds, configs, bundle ids, Firebase apps, Stripe redirect schemes.
- Risque de dilution.

Décision recommandée : **feature flags d'abord**, app bêta séparée seulement si les tests shipping / paiement deviennent trop risqués pour l'app publique.

---

## 5. Décisions ouvertes

- Structure juridique exacte : incorporation fédérale ou Québec ?
- Statut officiel de Victorine : actionnaire 50%, mais quel rôle contractuel sans problème visa ?
- Play Store : viser internal testing rapide ou production directe après build ?
- Lancement public : Montréal uniquement ou Canada dès le départ ?
- Shipping : ShipEngine reste-t-il le choix final ou seulement l'agrégateur de test ?
- Forfaits : vend-on d'abord aux particuliers/power sellers ou directement aux friperies ?
- Beta : flags distants suffisants ou besoin d'une app séparée ?

---

## 6. Ordre recommandé des 10 prochains chantiers

1. Finaliser Play Store.
2. Créer / structurer la société pour Stripe.
3. Nettoyer wording public : pas de promesse shipping.
4. Corriger typecheck tests + vulnérabilités critiques.
5. Mettre en place un vrai système de feature flags / bêta testers.
6. Préparer plan com Victorine pour 1000 premiers utilisateurs.
7. Construire liste de 50 friperies / vendeurs pilotes Montréal.
8. Comparer partenaires livraison avec scénarios de coûts réels.
9. Tester shipping en bêta fermée seulement.
10. Définir forfaits boutiques avec 5 friperies pilotes avant de figer les prix.
