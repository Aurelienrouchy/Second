# Politique de gouvernance des renseignements personnels

> **TEMPLATE NON VALIDÉ JURIDIQUEMENT.** À compléter, faire valider par un·e conseiller·ère juridique, puis faire approuver et signer par la direction. Voir [`README.md`](./README.md).

**Fondement légal :** Loi 25 (Québec), art. 3.2 — toute entreprise doit établir et mettre en œuvre des **politiques et pratiques encadrant sa gouvernance des renseignements personnels** (conservation et destruction, rôles et responsabilités, traitement des plaintes), proportionnées à la nature et à l'importance de ses activités.

**Entreprise :** Second · **Version :** `[À COMPLÉTER]` · **Date d'entrée en vigueur :** `[À COMPLÉTER]`

---

## 1. Objet et portée

La présente politique encadre la gouvernance des renseignements personnels (RP) collectés, utilisés, communiqués et conservés par Second dans le cadre de l'exploitation de sa marketplace. Elle s'applique à l'ensemble du personnel, des contractuel·le·s et des prestataires ayant accès aux RP.

**Catégories de RP traitées :** `[À COMPLÉTER — ex. identité, coordonnées, données de compte, données financières (via Stripe), adresses d'expédition, contenus (images d'articles, messages), données d'usage/recommandation.]`

## 2. Rôles et responsabilités

| Rôle | Titulaire | Responsabilités |
|---|---|---|
| **Responsable de la protection des RP** (par défaut : la personne ayant la plus haute autorité, art. 3.1) | `[À COMPLÉTER — nom]` · privacy@seconde.app | Veille au respect de la Loi 25 ; approuve les EFVP ; pilote les incidents ; point de contact CAI et personnes concernées ; tient le registre des incidents. |
| **Direction** | `[À COMPLÉTER]` | Approuve la politique ; alloue les ressources ; arbitre les décisions à risque élevé. |
| **Équipe technique / développement** | `[À COMPLÉTER]` | Met en œuvre les mesures de sécurité ; maintient la purge automatique et le registre d'incidents ; applique la confidentialité par défaut. |
| **Support / opérations** | `[À COMPLÉTER]` | Traite les demandes d'accès, de rectification et de retrait ; remonte les incidents. |

> Le·la responsable peut déléguer tout ou partie de ses fonctions par écrit (art. 3.1). Toute délégation doit être documentée ici.

## 3. Cycle de vie des RP

1. **Collecte** — uniquement les RP nécessaires aux fins déterminées ; information transparente de la personne au moment de la collecte (fins, droits, communication hors Québec, caractère obligatoire ou facultatif).
2. **Consentement** — libre, éclairé, donné à des fins spécifiques ; consentement **distinct** pour les fins secondaires (ex. analyse IA Vertex AI/Gemini en **opt-in**) ; retrait possible à tout moment.
3. **Utilisation** — limitée aux fins pour lesquelles les RP ont été recueillis.
4. **Communication à des tiers** — encadrée par une EFVP et une entente écrite pour tout transfert hors Québec (voir [`EFVP-transferts-hors-quebec.md`](./EFVP-transferts-hors-quebec.md) et [`DPA-checklist-tiers.md`](./DPA-checklist-tiers.md)).
5. **Conservation** — pour la durée nécessaire aux fins, sous réserve des obligations légales de conservation.
6. **Destruction / anonymisation** — à l'expiration de la durée de conservation (voir section 4).

## 4. Conservation et destruction

La destruction des RP périmés est **automatisée** via la fonction planifiée `retentionPurge` (`functions/src/scheduled/retentionPurge.ts`), exécutée quotidiennement (fuseau `America/Toronto`).

| Donnée | Seuil de conservation | Action |
|---|---|---|
| Articles inactifs (`isActive === false`) | 3 ans après dernière modification | Suppression définitive |
| Préférences invité (`guest_preferences`) | 90 jours | Suppression définitive |
| Notifications | 180 jours | Suppression définitive |
| Historique de recherche (`users/{uid}/searchHistory`) | 12 mois | Suppression définitive |
| Brouillons abandonnés (`drafts`) | 90 jours après dernière modification | Suppression définitive |
| **Transactions** (`transactions`) | **7 ans** (obligation comptable/fiscale) | **Jamais purgées par `retentionPurge`** |

`[À COMPLÉTER — compléter le tableau pour les autres catégories de RP non couvertes par la purge automatique (ex. comptes utilisateurs supprimés, messages de chat, journaux d'accès) : seuil, méthode de destruction, responsable.]`

> Toute modification des seuils de conservation doit être répercutée à la fois dans `retentionPurge.ts` (par l'équipe technique, via `firebase-backend`) **et** dans la présente politique.

## 5. Sécurité

Mesures de protection raisonnables, proportionnées à la sensibilité des RP :

- Contrôle d'accès basé sur les rôles ; accès admin protégé par claim `admin` + vérification serveur (`isAdmin`).
- Règles de sécurité Firestore/Storage (`firestore.rules`, `storage.rules`) — les écritures sur le registre d'incidents sont exclusivement serveur (Admin SDK).
- Secrets (clés Stripe, etc.) stockés dans Firebase Secret Manager, jamais dans le code.
- Mutations financières et statuts sensibles uniquement via Cloud Functions avec transactions atomiques.
- Chiffrement en transit ; chiffrement au repos assuré par l'infrastructure Google Cloud.
- `[À COMPLÉTER — journalisation des accès, MFA du personnel, gestion des appareils, revue d'accès périodique.]`

## 6. Droits des personnes et délais

Second répond aux demandes d'exercice des droits **dans un délai de 30 jours** suivant la réception (art. 33). Les demandes sont adressées à privacy@seconde.app.

| Droit | Mécanisme | Délai |
|---|---|---|
| Accès à ses RP | `[À COMPLÉTER]` | 30 jours |
| Rectification | `[À COMPLÉTER]` | 30 jours |
| Retrait du consentement | `[À COMPLÉTER]` | Sans délai |
| Suppression du compte / désindexation | Suppression de compte (callable existante) | 30 jours |
| Portabilité (RP informatisés) | `[À COMPLÉTER]` | 30 jours |
| Plainte | Adressée au·à la responsable ; à défaut de résolution, recours à la CAI. | 30 jours |

`[À COMPLÉTER — décrire le processus de traitement des plaintes (art. 3.2) : réception, accusé, instruction, réponse motivée, escalade CAI.]`

## 7. Formation et sensibilisation

`[À COMPLÉTER — programme de formation du personnel à la protection des RP : fréquence, contenu, suivi des participations, sensibilisation aux incidents.]`

## 8. Révision

La présente politique est révisée **au moins annuellement**, ou à tout changement significatif (nouveau tiers, nouvelle finalité, refonte de système, incident majeur, évolution législative).

| Élément | Échéance |
|---|---|
| Dernière révision | `[À COMPLÉTER]` |
| Prochaine révision prévue | `[À COMPLÉTER — au plus tard 12 mois]` |

## 9. Documents liés

- [`EFVP-transferts-hors-quebec.md`](./EFVP-transferts-hors-quebec.md) — évaluations des transferts hors Québec.
- [`DPA-checklist-tiers.md`](./DPA-checklist-tiers.md) — ententes écrites avec les tiers.
- [`procedure-incident-CAI.md`](./procedure-incident-CAI.md) — procédure d'incident de confidentialité.

---

## Approbation

| Rôle | Nom | Signature | Date |
|---|---|---|---|
| Responsable de la protection des RP | `[À COMPLÉTER]` | `__________________` | `__________` |
| Conseiller·ère juridique | `[À COMPLÉTER]` | `__________________` | `__________` |
| Direction (approbation) | `[À COMPLÉTER]` | `__________________` | `__________` |
