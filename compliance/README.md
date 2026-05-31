# Conformité — Loi 25 (Québec)

> **AVERTISSEMENT — TEMPLATES NON VALIDÉS JURIDIQUEMENT**
> Les documents de ce dossier sont des **modèles de gouvernance** rédigés pour structurer la mise en conformité de Second à la *Loi modernisant des dispositions législatives en matière de protection des renseignements personnels* (Loi 25, Québec). Ils contiennent des sections marquées `[À COMPLÉTER]` et doivent être **revus, complétés et validés par un·e conseiller·ère juridique** avant toute utilisation officielle ou dépôt auprès de la Commission d'accès à l'information (CAI). En l'état, ils n'ont **aucune valeur juridique**.

---

## Contexte

**Second** est une marketplace de seconde main (mode), exploitée pour le marché canadien (Québec inclus). Les renseignements personnels (RP) des utilisateur·rice·s sont hébergés sur Google Firebase (projet `seconde-b47a6`), avec les Cloud Functions en région `northamerica-northeast1` (Montréal). Plusieurs tiers situés **hors Québec** participent au traitement (Stripe, ShipEngine/Auctane, Google Cloud Vertex AI/Gemini), ce qui déclenche les obligations d'évaluation des facteurs relatifs à la vie privée (EFVP) prévues à l'art. 17 de la Loi.

## Index des documents

| Fichier | Article(s) Loi 25 | Objet | Statut |
|---|---|---|---|
| [`EFVP-transferts-hors-quebec.md`](./EFVP-transferts-hors-quebec.md) | art. 3.3, art. 17 | Évaluation des facteurs relatifs à la vie privée pour chaque transfert de RP hors Québec | Template — validation juridique requise |
| [`DPA-checklist-tiers.md`](./DPA-checklist-tiers.md) | art. 17 | Checklist des ententes écrites / Data Processing Agreements par tiers | Template — ententes à obtenir/archiver |
| [`politique-gouvernance-RP.md`](./politique-gouvernance-RP.md) | art. 3.2 | Politique de gouvernance des renseignements personnels | Template — approbation direction requise |
| [`procedure-incident-CAI.md`](./procedure-incident-CAI.md) | art. 3.5 à 3.8 | Procédure d'escalade des incidents de confidentialité (notification CAI + personnes concernées) | Template — validation juridique requise |

## Prochaines actions

- [ ] **Désigner formellement le·la responsable de la protection des RP** (par défaut : `privacy@seconde.app` — nom de la personne à confirmer par le fondateur).
- [ ] **Faire valider l'ensemble des documents par un·e conseiller·ère juridique** spécialisé·e en protection des RP au Québec.
- [ ] **Obtenir et archiver les ententes écrites (DPA)** avec Stripe, ShipEngine/Auctane et Google Cloud (voir `DPA-checklist-tiers.md`).
- [ ] **Compléter chaque `[À COMPLÉTER]`** avec les informations factuelles (dates, noms, références contractuelles, conclusions d'évaluation).
- [ ] **Faire approuver et signer** la politique de gouvernance par la direction.
- [ ] **Publier la politique de confidentialité** destinée au public (document distinct, hors de ce dossier de gouvernance interne).
- [ ] **Planifier la révision annuelle** de l'ensemble du dossier (voir échéancier dans la politique de gouvernance).

## Ancrage technique (déjà implémenté côté produit)

Ces documents de gouvernance s'appuient sur des mécanismes déjà présents dans le code :

- **Purge automatique des RP périmés** : `functions/src/scheduled/retentionPurge.ts` (purge quotidienne, fuseau `America/Toronto`).
- **Registre des incidents de confidentialité** : collection Firestore `privacy_incidents` + callables `reportPrivacyIncident`, `getPrivacyIncidentsLog`, `escalatePrivacyIncidentToCAI`, `notifyAffectedUsers` (`functions/src/callable/privacyIncidents.ts`).
- **Notification in-app dédiée** : type `privacy_incident` (`functions/src/utils/notifications.ts`).

---

*Dernière mise à jour du template : `[À COMPLÉTER — date]` · Préparé par : `[À COMPLÉTER]` · Validé par (juriste) : `[À COMPLÉTER]`*
