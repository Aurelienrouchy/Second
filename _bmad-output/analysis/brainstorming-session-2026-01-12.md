---
stepsCompleted: [1, 2]
inputDocuments: []
session_topic: 'Repenser le parcours onboarding complet pour Seconde'
session_goals: 'Réduire la friction, personnalisation progressive'
selected_approach: 'ai-recommended'
techniques_used: ['Reverse Brainstorming', 'First Principles Thinking', 'SCAMPER Method']
ideas_generated: []
context_file: ''
---

# Brainstorming Session Results

**Facilitator:** Sally (UX Designer)
**Participant:** Aurelienrouchy
**Date:** 2026-01-12

## Session Overview

**Topic:** Repenser le parcours onboarding complet pour Seconde
**Goals:** Réduire la friction + Personnalisation progressive

### Context

- App type: Marketplace vêtements (style Vinted)
- Onboarding actuel: Tailles → Marques (min 3) → Localisation
- Authentification: Email, Google, Apple
- Problème identifié: Users revoient l'onboarding à la reconnexion

### Session Setup

Approche pragmatique avec focus sur:
1. Réduction du nombre d'étapes
2. Personnalisation progressive (apprendre au fil du temps)
3. Montrer la valeur avant de demander des infos

## Technique Selection

**Approach:** AI-Recommended Techniques (adaptées au participant)

**Recommended Techniques:**

1. **Reverse Brainstorming:** Identifier ce qu'il faut éviter en imaginant le pire onboarding possible
2. **First Principles Thinking:** Questionner les fondamentaux - qu'est-ce qui est vraiment nécessaire?
3. **SCAMPER Method:** Générer des solutions concrètes via 7 lentilles créatives

**AI Rationale:** Séquence choisie pour permettre une exploration créative sans nécessiter d'exercices d'empathie poussés, tout en restant pragmatique et orientée solutions.

---

## Phase 1: Reverse Brainstorming

### Prompt: "Comment créer le PIRE onboarding possible?"

**Horreurs identifiées:**
- Étapes trop longues
- Trop d'infos perso demandées
- Inscription AVANT de voir le contenu
- Géolocalisation sans explication
- Notifications sans explication

**Principes inversés:**
- Étapes ultra-courtes (1 action max par écran)
- Demander le strict minimum
- Montrer le feed AVANT inscription
- Expliquer le "pourquoi" avant chaque permission
- Montrer la valeur des notifications

---

## Phase 2: First Principles Thinking

### Ce qui est VRAIMENT obligatoire:

| Info | Obligatoire? | Quand? |
|------|--------------|--------|
| Email | Oui (compte) | À l'inscription |
| Prénom | Sympa mais peut attendre | Inscription ou après |
| Tailles | Non | Déduit du comportement |
| Marques | Non | Déduit du comportement |
| Localisation | Non | IP + filtre optionnel |
| Adresse | Non | À l'achat uniquement |

### Triggers d'inscription (actions nécessitant un compte):

| Action | Message contextuel |
|--------|-------------------|
| Liker/Favoris | "Crée un compte pour sauvegarder tes coups de coeur" |
| Messagerie | "Inscris-toi pour contacter le vendeur" |
| Acheter | "Crée un compte pour finaliser ton achat" |
| Vendre | "Inscris-toi pour vendre tes articles" |
| Suivre un shop | "Crée un compte pour suivre ce vendeur" |
| Swap Party | "Inscris-toi pour participer à cette Swap Party" |

---

## Phase 3: SCAMPER

### S - Substitute
- Formulaire tailles → Déduction par les likes
- Sélection 3 marques min → Suggestions après scrolls
- Écran géolocalisation → IP + filtre optionnel
- Inscription obligatoire → Browse first + inscription contextuelle

### C - Combine
- Inscription + personnalisation = même étape
- Google/Apple → "Bienvenue Marie! Quel style?" → Feed

### A - Adapt
- TikTok: Feed immédiat, 0 friction
- Spotify: Choix visuels et fun
- Tinder: Swipe = engagement naturel

### M - Modify
- Réduire: étapes (4→1), champs (email+prénom)
- Amplifier: feed, "wow" au premier like

### P - Put to Other Use
- Découverte de features au fil du parcours
- Éducation Swap Party après inscription
- Collecter feedback

### E - Eliminate
- ~~Sélection de tailles~~
- ~~3 marques minimum~~
- ~~Écran localisation~~
- ~~Barre de progression~~
- ~~Bouton "Skip"~~
- ~~Onboarding au retour~~

### R - Reverse
- Feed → Inscription (au lieu de Inscription → Feed)
- On devine et confirme (au lieu de demander)
- Onboarding = exploration (au lieu de formulaire)

---

## Nouveau Flow Proposé

```
1. OUVERTURE APP
   → Feed immédiat (IP géoloc approximative)
   → Pas de popup, pas de login

2. BROWSE LIBRE
   → Scroll, recherche, filtre
   → L'app observe silencieusement

3. ACTION À VALEUR (like, message, achat, swap party)
   → "Crée un compte pour [bénéfice]"
   → [Google] [Apple] [Email]
   → 1 clic = inscrit

4. PERSONNALISATION LÉGÈRE (optionnel)
   → "Bienvenue [Prénom]!"
   → "On a remarqué que tu aimes X, Y - correct?"

5. RETOUR À L'ACTION
   → L'action interrompue se complète
   → Feed personnalisé
```

---

## Décisions Techniques à Implémenter

1. **Supprimer Facebook Auth** - garder Email, Google, Apple
2. **Fix routing** - vérifier `onboardingCompleted` pour users connectés
3. **Browse First** - feed accessible sans compte
4. **Inscription contextuelle** - triggers définis ci-dessus
5. **Personnalisation progressive** - apprendre du comportement

