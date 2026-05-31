# Procédure d'escalade des incidents de confidentialité

> **TEMPLATE NON VALIDÉ JURIDIQUEMENT.** À compléter et faire valider par un·e conseiller·ère juridique. Voir [`README.md`](./README.md).

**Fondement légal :** Loi 25 (Québec), art. 3.5 à 3.8 — obligation de tenir un **registre des incidents de confidentialité**, d'aviser la **Commission d'accès à l'information (CAI)** et les **personnes concernées** lorsqu'un incident présente un **risque de préjudice sérieux**, et de prendre des mesures pour diminuer le risque.

**Responsable de la procédure :** `[À COMPLÉTER — nom]` · privacy@seconde.app
**Version :** `[À COMPLÉTER]` · **Date d'entrée en vigueur :** `[À COMPLÉTER]`

---

## 1. Définitions

- **Incident de confidentialité** : accès, utilisation ou communication non autorisés d'un RP, ou perte d'un RP, ou toute autre atteinte à sa protection.
- **Risque de préjudice sérieux** : évalué selon la sensibilité du RP, les conséquences appréhendées de son utilisation et la probabilité qu'il soit utilisé à des fins préjudiciables.
- **CAI** : Commission d'accès à l'information du Québec.
- **Personne concernée** : utilisateur·rice dont les RP sont visés par l'incident.

## 2. Classification de gravité et seuils d'escalade

La gravité est encodée dans le registre technique (`privacy_incidents`) sur quatre niveaux. Les seuils ci-dessous sont **ancrés dans le code** (`functions/src/callable/privacyIncidents.ts`, en-tête du fichier) :

| Gravité (`severity`) | Notification CAI | Notification personnes concernées |
|---|---|---|
| `critical` | **Obligatoire** | **Obligatoire** |
| `high` | **Obligatoire** | **Obligatoire** |
| `medium` | À la discrétion du·de la responsable (évaluation au cas par cas du risque de préjudice sérieux) | À la discrétion du·de la responsable |
| `low` | Registre seulement — aucune notification externe | Aucune |

> La gravité est une **aide à la décision technique**. La décision finale d'aviser repose sur l'évaluation juridique du **risque de préjudice sérieux**, qui prime. `[À COMPLÉTER — critères concrets de classification : nombre de personnes touchées, type de données (financières, identité), exposition publique, etc.]`

## 3. Délais cibles

L'avis à la CAI et aux personnes concernées doit être donné **avec diligence**, sans délai injustifié. **Cible interne : 72 heures à compter de la détection.**

Les moments clés sont horodatés dans le registre pour rendre le délai **auditable a posteriori** :

- `detectedAt` — détection (création de l'incident).
- `notifiedCAIAt` — avis à la CAI (`escalatePrivacyIncidentToCAI`).
- `notifiedUsersAt` — avis aux personnes concernées (`notifyAffectedUsers`).

## 4. Organigramme de décision

```
[Détection]
    │  reportPrivacyIncident → crée privacy_incidents/{id} (detectedAt, severity, status='open')
    ▼
[Évaluation]
    │  Le·la responsable évalue le risque de préjudice sérieux.
    │  Confinement immédiat (mesures techniques) en parallèle.
    ▼
[Risque de préjudice sérieux ?]
    │
    ├── NON  → Consigner au registre. Documenter les mesures (`measures`). Clore (`status='resolved'`).
    │
    └── OUI  → ┌─ Aviser la CAI         → escalatePrivacyIncidentToCAI  (notifiedCAI=true, notifiedCAIAt)
               ├─ Aviser les personnes   → notifyAffectedUsers          (notifiedUsersAt, notif. in-app 'privacy_incident')
               └─ Mesures pour diminuer le risque et prévenir la récidive
                  ▼
              [Suivi & clôture]  status: open → investigating → contained → resolved
```

## 5. Renvois techniques

| Callable (admin uniquement) | Effet |
|---|---|
| `reportPrivacyIncident` | Crée l'incident dans `privacy_incidents` (horodatage serveur `detectedAt`). |
| `getPrivacyIncidentsLog` | Retourne le registre trié par `detectedAt` décroissant. |
| `escalatePrivacyIncidentToCAI` | Marque `notifiedCAI=true`, horodate `notifiedCAIAt`, enregistre `caiReference`, fait passer `open → investigating`. |
| `notifyAffectedUsers` | Envoie un avis in-app (type `privacy_incident`) à chaque `affectedUserId`, horodate `notifiedUsersAt`. |

**Statuts (`status`) :** `open` → `investigating` → `contained` → `resolved` (jamais régressé vers un statut moins avancé).

**Registre :** collection Firestore `privacy_incidents`, écrite exclusivement côté serveur (Admin SDK), lisible par les admins uniquement. Chaque incident conserve : `type`, `severity`, `description`, `affectedUserIds`, `affectedDataFields`, `measures`, `notifiedCAI`, `notifiedCAIAt`, `caiReference`, `notifiedUsersAt`, `status`, `detectedAt`.

`[À COMPLÉTER — confirmer la durée de conservation des incidents au registre : la Loi exige 5 ans à compter de la connaissance de l'incident. Vérifier que retentionPurge ne purge PAS privacy_incidents.]`

---

## 6. Modèle — Avis à la Commission d'accès à l'information (CAI)

> *À transmettre selon les modalités en vigueur de la CAI. Vérifier le formulaire officiel à jour.*

```
OBJET : Avis d'incident de confidentialité — risque de préjudice sérieux

À : Commission d'accès à l'information du Québec
De : Second — [À COMPLÉTER : raison sociale, adresse]
Responsable de la protection des RP : [À COMPLÉTER : nom] — privacy@seconde.app
Date de l'avis : [À COMPLÉTER]
Référence interne de l'incident : [À COMPLÉTER : privacy_incidents/{id}]

1. Description de l'incident
   [À COMPLÉTER : nature de l'incident, date/période de survenance, date de détection]

2. Renseignements personnels visés
   [À COMPLÉTER : catégories de RP — affectedDataFields ; sensibilité]

3. Nombre de personnes concernées
   [À COMPLÉTER : nombre — longueur de affectedUserIds]

4. Circonstances et cause
   [À COMPLÉTER]

5. Mesures prises ou envisagées pour diminuer les risques et prévenir la récidive
   [À COMPLÉTER : measures]

6. Mesures offertes aux personnes concernées
   [À COMPLÉTER]

7. Coordonnées de la personne pouvant fournir des renseignements additionnels
   [À COMPLÉTER]
```

## 7. Modèle — Avis aux personnes concernées

> *Texte poussé via la notification in-app `privacy_incident` (`notifyAffectedUsers`) et/ou par courriel. Ton clair, factuel, non alarmiste, en français.*

```
OBJET : Information importante concernant la sécurité de vos renseignements

Bonjour,

Nous vous informons qu'un incident de confidentialité est survenu et qu'il
pourrait concerner certains de vos renseignements personnels.

Ce qui s'est passé :
[À COMPLÉTER : description simple et factuelle]

Renseignements potentiellement touchés :
[À COMPLÉTER : catégories concernées]

Ce que nous avons fait :
[À COMPLÉTER : mesures de confinement et de correction]

Ce que vous pouvez faire :
[À COMPLÉTER : recommandations concrètes — ex. changer votre mot de passe,
surveiller vos relevés]

Pour toute question, écrivez-nous à privacy@seconde.app.

Nous prenons la protection de vos renseignements très au sérieux et vous
présentons nos excuses pour cette situation.

L'équipe Second
```

---

## 8. Validation

| Rôle | Nom | Signature | Date |
|---|---|---|---|
| Responsable de la protection des RP | `[À COMPLÉTER]` | `__________________` | `__________` |
| Conseiller·ère juridique | `[À COMPLÉTER]` | `__________________` | `__________` |
| Direction | `[À COMPLÉTER]` | `__________________` | `__________` |

*Prochaine révision prévue : `[À COMPLÉTER]`*
