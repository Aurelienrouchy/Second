# Évaluation des facteurs relatifs à la vie privée (EFVP) — Transferts de RP hors Québec

> **TEMPLATE NON VALIDÉ JURIDIQUEMENT.** À compléter et faire valider par un·e conseiller·ère juridique. Voir [`README.md`](./README.md).

**Fondement légal :** Loi 25 (Québec), art. 17 (communication de RP à l'extérieur du Québec) et art. 3.3 (EFVP pour tout projet d'acquisition, de développement ou de refonte de système d'information impliquant des RP).

**Entreprise :** Second · **Projet/produit :** Marketplace seconde main (`seconde-b47a6`)
**Responsable de la protection des RP :** `[À COMPLÉTER — nom]` · privacy@seconde.app
**Date de l'évaluation :** `[À COMPLÉTER]` · **Version :** `[À COMPLÉTER]`

---

## Cadre de l'évaluation

Conformément à l'art. 17, avant de communiquer un renseignement personnel à l'extérieur du Québec, Second doit procéder à une évaluation des facteurs relatifs à la vie privée tenant compte notamment :

- de la **sensibilité** du renseignement ;
- de la **finalité** de son utilisation ;
- des **mesures de protection** dont le renseignement bénéficierait, y compris contractuelles ;
- du **régime juridique** applicable dans l'État destinataire, notamment des principes de protection des RP qui y sont applicables.

Le renseignement ne peut être communiqué que si l'évaluation démontre qu'il bénéficierait d'une **protection adéquate**, au regard notamment des principes de protection des RP généralement reconnus, et que la communication fait l'objet d'une **entente écrite** (voir [`DPA-checklist-tiers.md`](./DPA-checklist-tiers.md)).

**Échelle d'évaluation du risque (résiduel, après mesures) :** `Faible` · `Modéré` · `Élevé` · `Inacceptable`

---

## Tiers 1 — Stripe Inc. (paiement, KYC)

| Champ | Contenu |
|---|---|
| **Fournisseur** | Stripe Inc. |
| **Rôle** | Sous-traitant / fournisseur de services de paiement et de vérification d'identité (KYC). Modèle Stripe Connect Custom (white-label). |
| **Lieu de traitement** | États-Unis `[À COMPLÉTER — confirmer régions/sous-traitants ultérieurs déclarés par Stripe]` |

### Nature et sensibilité des RP transférés

- **Identité du·de la vendeur·euse** : nom légal, date de naissance.
- **Coordonnées** : adresse postale.
- **Données financières** : informations de compte bancaire (pour le versement des fonds).
- **Données de transaction** : montants en `$ CAD`, historique de paiement.

**Sensibilité :** Élevée (données financières + identité + date de naissance = données pouvant servir à l'usurpation d'identité et exposées à un risque de préjudice sérieux).

### Finalité

Traitement des paiements acheteur·euse → vendeur·euse, vérification d'identité réglementaire (KYC/AML) des vendeur·euse·s, versement des soldes, conformité financière. La plateforme porte le KYC/la conformité (modèle Custom).

### Cadre juridique du pays destinataire

`[À COMPLÉTER — analyse du régime de protection des RP applicable aux États-Unis : absence de loi fédérale générale équivalente, encadrement sectoriel (GLBA pour les données financières), engagements contractuels de Stripe, certifications (ex. PCI-DSS, SOC 2). Évaluer l'adéquation au regard des principes généralement reconnus.]`

### Mesures de protection / contractuelles

- Entente écrite : `[À COMPLÉTER — référence au Stripe Services Agreement + DPA Stripe, voir DPA-checklist]`
- Chiffrement en transit et au repos `[À COMPLÉTER — confirmer]`
- Certification PCI-DSS de Stripe `[À COMPLÉTER — niveau, attestation]`
- Données financières détenues par Stripe (tokenisation) — Second ne stocke jamais les numéros de carte.
- Clés API hébergées dans Firebase Secret Manager (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) ; signature du webhook vérifiée.

### Évaluation du risque

`[À COMPLÉTER — risque résiduel après mesures : Faible / Modéré / Élevé / Inacceptable + justification]`

### Conclusion

`[À COMPLÉTER — la communication est-elle autorisée ? conditions ? réserves du·de la juriste ?]`

---

## Tiers 2 — ShipEngine / Auctane (expédition)

| Champ | Contenu |
|---|---|
| **Fournisseur** | ShipEngine (Auctane) |
| **Rôle** | Sous-traitant / fournisseur de services d'expédition (génération d'étiquettes, suivi). |
| **Lieu de traitement** | États-Unis `[À COMPLÉTER — confirmer]` |

### Nature et sensibilité des RP transférés

- **Adresses** : adresse d'expédition (vendeur·euse) et de livraison (acheteur·euse).
- **Coordonnées** : nom, numéro de téléphone, adresse courriel.

**Sensibilité :** Modérée (coordonnées + adresses physiques ; risque lié à la localisation des personnes).

### Finalité

Génération des étiquettes d'expédition, suivi des colis, gestion des retours/remboursements liés à la livraison.

### Cadre juridique du pays destinataire

`[À COMPLÉTER — analyse du régime de protection des RP aux États-Unis applicable aux données de logistique/coordonnées ; engagements contractuels d'Auctane ; sous-traitants transporteurs.]`

### Mesures de protection / contractuelles

- Entente écrite : `[À COMPLÉTER — référence aux conditions ShipEngine/Auctane + DPA, voir DPA-checklist]`
- Minimisation : seules les données strictement nécessaires à l'expédition sont transmises.
- Chiffrement en transit `[À COMPLÉTER — confirmer]`

### Évaluation du risque

`[À COMPLÉTER — risque résiduel : Faible / Modéré / Élevé / Inacceptable + justification]`

### Conclusion

`[À COMPLÉTER]`

---

## Tiers 3 — Google Cloud Vertex AI + Gemini (analyse d'images / recommandations)

| Champ | Contenu |
|---|---|
| **Fournisseur** | Google LLC — Vertex AI + Gemini |
| **Rôle** | Sous-traitant / fournisseur de services d'analyse d'images et de recommandations (recherche visuelle, modération assistée). |
| **Lieu de traitement** | États-Unis `[À COMPLÉTER — confirmer la région Vertex AI utilisée ; idéalement une région nord-américaine]` |
| **Base de la communication** | **Opt-in** de l'utilisateur·rice (consentement explicite). |

### Nature et sensibilité des RP transférés

- **Images d'articles** téléversées par les utilisateur·rice·s (peuvent incidemment contenir des éléments identifiants : visage, intérieur du domicile, documents en arrière-plan).
- **Signaux de recommandation** dérivés du comportement (catégories consultées) `[À COMPLÉTER — préciser les attributs exacts envoyés]`

**Sensibilité :** Modérée à élevée selon le contenu incident des images (risque de RP sensibles involontaires).

### Finalité

Recherche visuelle (articles similaires), recommandations personnalisées, modération assistée des annonces. Fonctionnalité **opt-in** : aucun envoi sans consentement explicite.

### Cadre juridique du pays destinataire

`[À COMPLÉTER — régime de protection des RP applicable au traitement Google Cloud aux États-Unis ; engagements de non-réutilisation des données client pour l'entraînement de modèles (à vérifier dans les conditions Vertex AI) ; localisation des données.]`

### Mesures de protection / contractuelles

- **Consentement opt-in** documenté `[À COMPLÉTER — où/comment le consentement est recueilli et conservé]`
- Entente écrite : `[À COMPLÉTER — Google Cloud DPA / Data Processing and Security Terms, voir DPA-checklist]`
- Engagement de non-utilisation des contenus client pour l'entraînement des modèles `[À COMPLÉTER — confirmer la clause applicable]`
- Minimisation et durée de conservation des images transmises `[À COMPLÉTER]`

### Évaluation du risque

`[À COMPLÉTER — risque résiduel : Faible / Modéré / Élevé / Inacceptable + justification ; tenir compte du caractère opt-in.]`

### Conclusion

`[À COMPLÉTER]`

---

## Note — Google Firebase (hébergement)

Google Firebase héberge la base de données et les fonctions. **Les Cloud Functions s'exécutent en région `northamerica-northeast1` (Montréal)** — donc au Canada. `[À COMPLÉTER — confirmer la localisation de stockage des autres services Firebase utilisés (Firestore, Storage, Auth) : région du bucket/instance, et si un transfert hors Québec/Canada a lieu pour ces services. Si toutes les données de RP résident au Canada, le préciser ; sinon, ajouter une section EFVP dédiée.]`

---

## Volet art. 3.3 — Refonte du système d'inscription / consentement (mai 2026)

L'art. 3.3 impose une EFVP pour **tout projet d'acquisition, de développement ou de refonte d'un système d'information** ou de prestation électronique de services impliquant des RP.

**Projet visé :** Refonte du système d'inscription et de gestion du consentement (mai 2026).

| Élément | Contenu |
|---|---|
| **Description du projet** | `[À COMPLÉTER — nature exacte de la refonte : nouveau flux d'inscription, granularité du consentement, retrait du consentement, gestion du opt-in IA, etc.]` |
| **Catégories de RP traitées** | `[À COMPLÉTER]` |
| **Finalités** | `[À COMPLÉTER]` |
| **Nouveaux flux / nouveaux tiers introduits** | `[À COMPLÉTER]` |
| **Mécanisme de consentement** | `[À COMPLÉTER — consentement libre, éclairé, donné à des fins spécifiques ; consentement distinct pour les fins secondaires (IA opt-in) ; possibilité de retrait]` |
| **Paramètres de confidentialité par défaut** | `[À COMPLÉTER — confirmer que les paramètres assurent le plus haut niveau de confidentialité par défaut, sans intervention de la personne (art. 9.1)]` |
| **Transparence** | `[À COMPLÉTER — information fournie à la personne au moment de la collecte : identité du responsable, fins, droits, communication hors Québec]` |
| **Risques identifiés et mesures d'atténuation** | `[À COMPLÉTER]` |
| **Conclusion de l'évaluation** | `[À COMPLÉTER]` |

---

## Validation

| Rôle | Nom | Signature | Date |
|---|---|---|---|
| Responsable de la protection des RP | `[À COMPLÉTER]` | `__________________` | `__________` |
| Conseiller·ère juridique | `[À COMPLÉTER]` | `__________________` | `__________` |
| Direction | `[À COMPLÉTER]` | `__________________` | `__________` |

*Prochaine révision prévue : `[À COMPLÉTER — au plus tard à la date anniversaire ou à tout changement de tiers/finalité]`*
