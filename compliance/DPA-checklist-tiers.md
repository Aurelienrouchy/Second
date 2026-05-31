# Checklist des ententes écrites / Data Processing Agreements (DPA) par tiers

> **TEMPLATE NON VALIDÉ JURIDIQUEMENT.** À compléter et faire valider par un·e conseiller·ère juridique. Voir [`README.md`](./README.md).

**Fondement légal :** Loi 25 (Québec), art. 17 — toute communication de RP hors Québec doit faire l'objet d'une **entente écrite** encadrant la protection des renseignements. Cette checklist complète l'EFVP ([`EFVP-transferts-hors-quebec.md`](./EFVP-transferts-hors-quebec.md)) : l'EFVP évalue le risque, la présente checklist documente le contrat qui couvre ce risque.

**Responsable du suivi :** `[À COMPLÉTER — nom]` · privacy@seconde.app
**Date de revue :** `[À COMPLÉTER]`

---

## Légende des statuts

- `À obtenir` — entente identifiée mais pas encore signée/acceptée ni archivée.
- `Acceptée` — conditions/DPA acceptés en ligne, preuve d'acceptation à archiver.
- `Archivé` — copie de l'entente/DPA conservée dans le registre interne `[À COMPLÉTER — emplacement, ex. coffre documentaire]`.

## Clauses requises (à cocher pour chaque tiers)

Une entente conforme doit couvrir au minimum :

- [ ] **Rôles** des parties (responsable / contrôleur vs sous-traitant) clairement définis.
- [ ] **Catégories de RP** visées énumérées.
- [ ] **Finalité(s)** de traitement limitée(s) aux instructions du responsable.
- [ ] **Durée** du traitement et durée de conservation.
- [ ] **Mesures de sécurité** (chiffrement, contrôle d'accès, journalisation) adaptées à la sensibilité.
- [ ] **Sous-traitance ultérieure** (sub-processors) : autorisation, liste, obligation d'imposer les mêmes obligations.
- [ ] **Notification de violation / incident de confidentialité** au responsable, sans délai injustifié.
- [ ] **Droit d'audit** ou attestation de conformité (rapports SOC 2 / ISO 27001 / PCI-DSS, etc.).
- [ ] **Restitution ou destruction** des RP en fin de contrat.
- [ ] **Localisation** du traitement / transferts internationaux ultérieurs encadrés.
- [ ] **Coopération** pour l'exercice des droits des personnes concernées.

---

## Tiers 1 — Stripe Inc.

| Champ | Contenu |
|---|---|
| **Catégorie de service** | Paiement + KYC (Stripe Connect Custom) |
| **Statut de l'entente** | `À obtenir` / `Acceptée` / `Archivé` → `[À COMPLÉTER]` |
| **Documents de référence** | Stripe Services Agreement + Stripe Data Processing Agreement |
| **Lien DPA fournisseur** | `[À COMPLÉTER — URL du DPA Stripe en vigueur]` (réf. publique connue : https://stripe.com/legal/dpa) |
| **Date d'acceptation/signature** | `[À COMPLÉTER]` |
| **Emplacement de la copie archivée** | `[À COMPLÉTER]` |

**Vérification des clauses :**

| Clause | Couverte ? | Référence (article/section du DPA) |
|---|---|---|
| Rôles (contrôleur/sous-traitant) | `[ ]` | `[À COMPLÉTER]` |
| Catégories de RP | `[ ]` | `[À COMPLÉTER]` |
| Finalité limitée aux instructions | `[ ]` | `[À COMPLÉTER]` |
| Durée / conservation | `[ ]` | `[À COMPLÉTER]` |
| Sécurité (chiffrement, PCI-DSS) | `[ ]` | `[À COMPLÉTER]` |
| Sous-traitance ultérieure | `[ ]` | `[À COMPLÉTER]` |
| Notification de violation | `[ ]` | `[À COMPLÉTER]` |
| Droit d'audit / attestation | `[ ]` | `[À COMPLÉTER]` |
| Restitution / destruction | `[ ]` | `[À COMPLÉTER]` |
| Localisation / transferts ultérieurs | `[ ]` | `[À COMPLÉTER]` |
| Coopération droits des personnes | `[ ]` | `[À COMPLÉTER]` |

**Notes / réserves :** `[À COMPLÉTER]`

---

## Tiers 2 — ShipEngine / Auctane

| Champ | Contenu |
|---|---|
| **Catégorie de service** | Expédition (étiquettes, suivi) |
| **Statut de l'entente** | `À obtenir` / `Acceptée` / `Archivé` → `[À COMPLÉTER]` |
| **Documents de référence** | Conditions de service ShipEngine / Auctane + addendum de traitement des données |
| **Lien DPA fournisseur** | `[À COMPLÉTER — URL des conditions/DPA ShipEngine ou Auctane en vigueur]` |
| **Date d'acceptation/signature** | `[À COMPLÉTER]` |
| **Emplacement de la copie archivée** | `[À COMPLÉTER]` |

**Vérification des clauses :**

| Clause | Couverte ? | Référence (article/section du DPA) |
|---|---|---|
| Rôles (contrôleur/sous-traitant) | `[ ]` | `[À COMPLÉTER]` |
| Catégories de RP | `[ ]` | `[À COMPLÉTER]` |
| Finalité limitée aux instructions | `[ ]` | `[À COMPLÉTER]` |
| Durée / conservation | `[ ]` | `[À COMPLÉTER]` |
| Sécurité (chiffrement) | `[ ]` | `[À COMPLÉTER]` |
| Sous-traitance ultérieure (transporteurs) | `[ ]` | `[À COMPLÉTER]` |
| Notification de violation | `[ ]` | `[À COMPLÉTER]` |
| Droit d'audit / attestation | `[ ]` | `[À COMPLÉTER]` |
| Restitution / destruction | `[ ]` | `[À COMPLÉTER]` |
| Localisation / transferts ultérieurs | `[ ]` | `[À COMPLÉTER]` |
| Coopération droits des personnes | `[ ]` | `[À COMPLÉTER]` |

**Notes / réserves :** `[À COMPLÉTER]`

---

## Tiers 3 — Google Cloud (Vertex AI + Gemini, Firebase)

| Champ | Contenu |
|---|---|
| **Catégorie de service** | Hébergement (Firebase) + analyse d'images/recommandations (Vertex AI/Gemini, opt-in) |
| **Statut de l'entente** | `À obtenir` / `Acceptée` / `Archivé` → `[À COMPLÉTER]` |
| **Documents de référence** | Google Cloud / Firebase Data Processing and Security Terms (DPST) |
| **Lien DPA fournisseur** | `[À COMPLÉTER — URL des Google Cloud / Firebase Data Processing Terms en vigueur]` (réf. publique connue : https://cloud.google.com/terms/data-processing-addendum) |
| **Date d'acceptation/signature** | `[À COMPLÉTER]` |
| **Emplacement de la copie archivée** | `[À COMPLÉTER]` |

**Vérification des clauses :**

| Clause | Couverte ? | Référence (article/section du DPA) |
|---|---|---|
| Rôles (contrôleur/sous-traitant) | `[ ]` | `[À COMPLÉTER]` |
| Catégories de RP | `[ ]` | `[À COMPLÉTER]` |
| Finalité limitée aux instructions | `[ ]` | `[À COMPLÉTER]` |
| Non-réutilisation pour l'entraînement de modèles | `[ ]` | `[À COMPLÉTER]` |
| Durée / conservation | `[ ]` | `[À COMPLÉTER]` |
| Sécurité (chiffrement, contrôle d'accès) | `[ ]` | `[À COMPLÉTER]` |
| Sous-traitance ultérieure | `[ ]` | `[À COMPLÉTER]` |
| Notification de violation | `[ ]` | `[À COMPLÉTER]` |
| Droit d'audit / attestation (SOC 2 / ISO 27001) | `[ ]` | `[À COMPLÉTER]` |
| Restitution / destruction | `[ ]` | `[À COMPLÉTER]` |
| Localisation des données / région | `[ ]` | `[À COMPLÉTER — confirmer région Firestore/Storage et région Vertex AI]` |
| Coopération droits des personnes | `[ ]` | `[À COMPLÉTER]` |

**Notes / réserves :** `[À COMPLÉTER — préciser le périmètre exact couvert : Firebase, Vertex AI et Gemini relèvent-ils de la même entente Google Cloud ou de conditions distinctes ?]`

---

## Suivi global

| Tiers | Entente en place | Date de revue | Prochaine échéance |
|---|---|---|---|
| Stripe Inc. | `[ ]` | `[À COMPLÉTER]` | `[À COMPLÉTER]` |
| ShipEngine / Auctane | `[ ]` | `[À COMPLÉTER]` | `[À COMPLÉTER]` |
| Google Cloud | `[ ]` | `[À COMPLÉTER]` | `[À COMPLÉTER]` |

*Revue par : `[À COMPLÉTER]` · Validée (juriste) : `[À COMPLÉTER]` · Date : `[À COMPLÉTER]`*
