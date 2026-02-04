# Design Thinking Session: Seconde

**Date:** 2026-01-10
**Facilitator:** Aurelienrouchy
**Design Challenge:** Homepage Redesign + Search Page UX Review

---

## 🎯 Design Challenge

### Contexte
**Seconde** est une marketplace de vêtements et objets de seconde main ciblant deux audiences distinctes:
- **Gen Z** - Digital natives, sensibles aux tendances, habitués aux expériences app premium (TikTok, Instagram, Depop)
- **Casual Sellers** - Vendeurs occasionnels cherchant simplicité et efficacité pour vider leur garde-robe

### Problème Identifié
La Homepage actuelle est perçue comme **fade et générique**: une simple liste de catégories + articles + barre de recherche. Elle ne se différencie pas de Vinted ou autres marketplaces. Il manque le "WOW factor" qui crée de l'engagement et de la rétention.

### Périmètre
- ✅ Homepage: Refonte complète possible
- ✅ Search Page: UX à revoir
- ⚠️ Contrainte: Conserver la barre de recherche avec overlay existante
- ⚠️ Contrainte: S'intégrer à l'app React Native/Expo existante

### Challenge Statement
**"Comment pouvons-nous transformer la Homepage de Seconde en une expérience distinctive et engageante qui donne envie aux Gen Z et Casual Sellers d'ouvrir l'app quotidiennement - pas seulement pour acheter/vendre, mais pour le PLAISIR de l'expérience?"**

---

## 👥 EMPATHIZE: Understanding Users

### User Insights

{{user_insights}}

### Key Observations

{{key_observations}}

### Empathy Map Summary

{{empathy_map}}

---

## 🎨 DEFINE: Frame the Problem

### Point of View Statement

{{pov_statement}}

### How Might We Questions

{{hmw_questions}}

### Key Insights

{{problem_insights}}

---

## 💡 IDEATE: Generate Solutions

### Selected Methods

Brainstorming libre avec facilitateur, exploration de concepts différenciants vs Vinted.

### Generated Ideas

**Ideas explorées:**
- Look Inspiration Engine (Vogue/Insta → IA match) → **V2**
- Boutiques & Créateurs physiques → **V2**
- Gamification (Devine le Prix, Style Duel, Mystery Drop)
- Shopping par Vibe/Mood
- Style DNA / Aesthetic Tribes
- Social features (Fit Check, Before/After, Live Drops)
- FOMO (Flash Zone, Price Drop Live)
- Nostalgie (Time Machine, Capsule Génération)
- Local (Spot Mode, Swap Party)
- **SWAP comme différenciateur majeur**

### Top Concepts Retenus

#### 🏠 HOMEPAGE VISION

```
┌─────────────────────────────────────────────────┐
│  🔍 [Recherche...]                    👤 🔔    │
├─────────────────────────────────────────────────┤
│                                                 │
│  ❄️ WINTER PICKS (Saison)          [See All →] │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐              │
│  │     │ │     │ │     │ │     │  ← ACHETER   │
│  └─────┘ └─────┘ └─────┘ └─────┘              │
│                                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  🔄 SWAP ZONE                      [Explore →] │
│  ┌─────────────────────────────────────────┐   │
│  │ 🎉 Swap Party ce samedi │ 3 match dispo │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  🕰️ TIME MACHINE                              │
│  ◄ 70s ── 80s ── 90s ── Y2K ── 2010s ►        │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐              │
│  │     │ │     │ │     │ │     │  ← ACHETER   │
│  └─────┘ └─────┘ └─────┘ └─────┘              │
│                                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  🎯 POUR TOI                       [See All →] │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐              │
│  │     │ │     │ │     │ │     │  ← ACHETER   │
│  └─────┘ └─────┘ └─────┘ └─────┘              │
│                                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  🔥 FRESH DROPS (Nouveautés)                   │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐              │
│  │     │ │     │ │     │ │     │              │
│  └─────┘ └─────┘ └─────┘ └─────┘              │
│                                                 │
└─────────────────────────────────────────────────┘
```

#### 📋 SECTIONS À DÉVELOPPER

| # | Section | Priorité | Status |
|---|---------|----------|--------|
| 1 | **🔄 SWAP ZONE** | 🥇 | 🔄 EN COURS |
| 2 | ❄️ Saison | 🥇 | ⏳ À faire |
| 3 | 🕰️ Time Machine | 🥈 | ⏳ À faire |
| 4 | 🎯 Pour Toi | 🥇 | ⏳ À faire |
| 5 | 🔥 Fresh Drops | 🥈 | ⏳ À faire |
| 6 | 👀 Look Inspiration | V2 | 📅 Plus tard |

#### 🎯 HIÉRARCHIE APP

- **CORE** = Acheter / Vendre (comme Vinted)
- **DIFFÉRENCIATEUR** = SWAP (grosse feature, pas le centre)
- **SECTIONS COOL** = Time Machine, Saison, Looks (V2)

---

## 🛠️ PROTOTYPE: Make Ideas Tangible

### Prototype Approach

Design détaillé des features homepage, en commençant par SWAP ZONE.

### 🔄 FEATURE: SWAP ZONE (Complet)

#### Concept
Système d'échange d'items entre utilisateurs, organisé autour de Swap Parties thématiques.

#### Modèle Business
- **Tout item listé** = disponible en vente ET en swap automatiquement
- **Valeur swap** = prix de vente défini par l'utilisateur
- **Matching suggéré** = ±20% de la valeur (suggestion, pas obligation)
- **Cash top-up** = possible si l'utilisateur le propose
- **Liberté totale** = n'importe quel swap peut être proposé, l'autre accepte ou refuse

#### Swap Parties
- **Fréquence:** 1 par semaine
- **Durée:** 48h
- **Taille:** Scalable (pas de limite stricte)
- **Thèmes:** Alternance thématique/généraliste
- **Calendrier:** Visible plusieurs mois à l'avance
- **Organisateur:** Seconde uniquement
- **Inscription:** Gratuite, sans obligation d'ajouter des items
- **Items/personne:** Illimité
- **Après party:** Items non swappés retournent au shop normal

#### Calendrier Type (Exemple)
| Date | Thème | Description |
|------|-------|-------------|
| 10-12 Jan | ❄️ Winter Essentials | Manteaux, pulls |
| 17-19 Jan | 🎉 Généraliste | Tout accepté |
| 24-26 Jan | 👟 Sneakers Exchange | Baskets only |
| 31 Jan-2 Fév | 🎉 Généraliste | Tout accepté |
| 7-9 Fév | 💕 Date Night | Tenues soirée |

#### Logistique Échange
- **Facilitation:** Seconde matche, users gèrent l'échange
- **Modes:** Rencontre IRL ou envoi personnel
- **Pas de shipping intégré**
- **Photos obligatoires** avant envoi
- **Envoi simultané** requis des deux côtés

#### Flow Utilisateur
1. **Découverte** → Voit calendrier sur Home
2. **Inscription** → S'inscrit à une party
3. **Préparation** → Ajoute ses items au pool
4. **Swap Time (48h)** → Browse, propose, accepte/refuse
5. **Match!** → Discussion chat pour organiser
6. **Choix mode** → IRL ou envoi
7. **Si envoi** → Photos obligatoires des deux
8. **Envoi simultané** → Les deux confirment
9. **Réception** → Validation ou litige
10. **Done!** → Rating + badges

#### Écrans Clés
- Liste des Swap Parties (à venir, en cours)
- Calendrier complet
- Inside une Party (browse items, filtres, mes matchs)
- Proposition de swap
- Confirmation swap
- Gestion échange (chat, photos, status)
- Fin de swap (rating, impact CO2)

### Key Features to Test

- Flow de proposition de swap
- Système de matching par valeur
- Expérience Swap Party
- Gestion post-acceptation (photos, envoi)

---

### 🗓️ FEATURE: MOMENTS (Saisonnier/Événementiel) - COMPLET

#### Concept
Section contextuelle basée sur les moments clés de l'année (pas la météo). Chaque moment = une sélection curatée qui apparaît au bon timing, utilisant la recherche sémantique par vectors.

#### Technologie
- **Matching:** Vector similarity via embeddings Gemini (text-embedding-004)
- **Stockage:** Collection Firestore `moments` avec embeddings 1408 dimensions
- **Scoring:** Cosine similarity, seuil minimum 0.5 (50%)

#### Calendrier des Moments
| Période | Moment | Emoji | Description |
|---------|--------|-------|-------------|
| 20 Déc - 7 Jan | Nouvel An | 🎆 | Paillettes, sequins, glamour |
| 20 Jan - 10 Fév | Nouvel An Chinois | 🧧 | Rouge, doré, oriental |
| 1-14 Fév | Saint Valentin | 💕 | Romantique, rouge, sexy |
| 15 Mars - 15 Mai | Hello Spring | 🌸 | Pastel, floral, léger |
| 15 Mai - 15 Juil | Festival Season | 🎪 | Bohème, hippie, festival |
| 1 Mai - 30 Sept | Wedding Season | 👔 | Cocktail, habillé, cérémonie |
| 15 Juin - 31 Août | Summer Vibes | ☀️ | Plage, vacances, léger |
| 25 Août - 30 Sept | Back to Work | 📚 | Bureau, rentrée, smart casual |
| 1-31 Oct | Halloween | 🎃 | Gothic, dark, costume |
| 15 Oct - 30 Nov | Cozy Season | 🍂 | Maille, confort, automne |
| 1-25 Déc | Holidays | 🎄 | Noël, festif, ugly sweater |
| 1 Déc - 28 Fév | Grand Froid | ❄️ | Chaud, doudoune, layering |

#### Architecture
```
┌─────────────────────────────────────────────────────────────┐
│  CRÉATION MOMENT (Script seed-moments.js)                  │
│  Description sémantique → generateEmbedding() → Firestore  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  HOMEPAGE                                                   │
│  getActiveMoments() → moments actifs selon date            │
│  getMomentProducts(momentId) → cosine similarity           │
│  → Top articles matchant le moment                         │
└─────────────────────────────────────────────────────────────┘
```

#### Fichiers Créés
| Fichier | Description |
|---------|-------------|
| `scripts/seed-moments.js` | Script pour créer les moments avec embeddings |
| `services/momentsService.ts` | Service client pour récupérer les moments |
| `functions/src/index.ts` | Cloud Functions getActiveMoments & getMomentProducts |
| `firestore.rules` | Règles pour collection moments |

#### Affichage Homepage
```
┌─────────────────────────────────────────────────┐
│  💕 SAINT VALENTIN              [See All →]    │
│  "Trouve ta tenue pour le 14 février"          │
│                                                 │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐              │
│  │     │ │     │ │     │ │     │              │
│  │ 85% │ │ 78% │ │ 72% │ │ 68% │ ← similarity │
│  └─────┘ └─────┘ └─────┘ └─────┘              │
└─────────────────────────────────────────────────┘
```

#### Usage
```bash
# 1. Créer les moments (une seule fois)
node scripts/seed-moments.js

# 2. Déployer les Cloud Functions
cd functions && npm run deploy

# 3. Dans l'app, utiliser le service
import { getActiveMoments, getMomentProducts } from '@/services/momentsService';

const moments = await getActiveMoments();
const products = await getMomentProducts('saint-valentin', 10);
```

---

## ✅ TEST: Validate with Users

### Testing Plan

{{testing_plan}}

### User Feedback

{{user_feedback}}

### Key Learnings

{{key_learnings}}

---

## 🚀 Next Steps

### Refinements Needed

{{refinements}}

### Action Items

{{action_items}}

### Success Metrics

{{success_metrics}}

---

_Generated using BMAD Creative Intelligence Suite - Design Thinking Workflow_
