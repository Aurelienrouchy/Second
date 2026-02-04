# UX Documentation - Création de Produit (Seconde)

**Date**: 2026-01-10
**Statut**: Audit et recommandations
**Scope**: Flow de création d'article vendeur

---

## 1. Vue d'ensemble

### Architecture actuelle
Le flow de création de produit est un **formulaire mono-écran scrollable** composé de 6 sections distinctes. Les sélections complexes (catégories, couleurs, tailles, quartiers) sont déléguées à des **bottom sheets modaux**.

### Parcours utilisateur simplifié
```
[Onglet Vendre] → [Formulaire unique] → [Publication] → [Mes articles]
```

### Points forts identifiés
- Tout sur un seul écran = pas de perte de contexte
- Defaults intelligents (condition, taille du colis auto-suggérée)
- Localisation pré-remplie depuis le profil
- Compression d'images automatique

### Points faibles identifiés
- Formulaire très long (scroll important)
- Aucun indicateur de progression
- Pas de sauvegarde brouillon
- Sections conditionnelles peuvent désorienter

---

## 2. Cartographie du parcours actuel

### Section 1: Photos
| Élément | Détail |
|---------|--------|
| **Titre** | "Photos *" |
| **Sous-titre** | "Ajoutez jusqu'à 5 photos" |
| **Composant** | ScrollView horizontal avec vignettes 100x100px |
| **Action** | ImagePicker (sélection multiple) |
| **Limite** | 5 images max, qualité 0.6 |
| **Requis** | Non (mais fortement recommandé) |

**UX actuelle**: L'utilisateur voit un bouton "+" en pointillés. Les photos s'ajoutent horizontalement avec un "×" pour supprimer.

---

### Section 2: Informations de base

| Champ | Type | Requis | Validation |
|-------|------|--------|------------|
| **Titre** | TextInput | Oui | Non vide |
| **Description** | TextArea (4 lignes) | Oui | Non vide |
| **Prix (€)** | TextInput numérique | Oui | > 0, format valide |

**UX actuelle**: Champs empilés verticalement, pas de limite de caractères affichée, pas de compteur.

---

### Section 3: Modes de livraison

| Option | Type | Condition |
|--------|------|-----------|
| **Remise en main propre** | Checkbox | Si coché → affiche sélecteur de quartier |
| **Livraison** | Checkbox | Si coché → affiche sélection taille colis |

**Composants conditionnels**:
- `NeighborhoodBottomSheet` - Liste des quartiers de Montréal par arrondissement
- Section "Taille du colis" (3 cartes: Petit/Moyen/Grand)

**Validation**: Au moins un mode doit être sélectionné.

---

### Section 4: Taille du colis (conditionnelle)
*Visible uniquement si "Livraison" est cochée*

| Taille | Poids | Exemples |
|--------|-------|----------|
| **Petit** | < 500g | T-shirt, écharpe, accessoires |
| **Moyen** | < 1kg | Pull, jean, robe |
| **Grand** | < 2kg | Manteau, bottes, lots |

**Auto-suggestion**: La taille est suggérée automatiquement selon la catégorie choisie.

---

### Section 5: Détails

| Champ | Type | Requis | Composant |
|-------|------|--------|-----------|
| **Marque** | TextInput | Non | Texte libre |
| **Taille** | Selector | Non | `SelectionBottomSheet` (type: size) |
| **Catégorie** | Selector | Oui* | `CategoryBottomSheet` |
| **Couleur** | Selector | Non | `SelectionBottomSheet` (type: color) |
| **Matière** | Selector | Non | `SelectionBottomSheet` (type: default) |
| **État** | Radio cards | Oui | 4 options avec descriptions |

---

### Section 6: Action

| Bouton | État normal | État loading |
|--------|-------------|--------------|
| **Publier l'article** | Orange (#F79F24) | Gris + spinner |

---

## 3. Inventaire des composants UI

### Bottom Sheets

| Composant | Fichier | Hauteur | Usage |
|-----------|---------|---------|-------|
| `CategoryBottomSheet` | `/components/CategoryBottomSheet.tsx` | 80% | Navigation hiérarchique catégories |
| `SelectionBottomSheet` | `/components/SelectionBottomSheet.tsx` | 65% | Couleurs, matières, tailles |
| `NeighborhoodBottomSheet` | `/components/NeighborhoodBottomSheet.tsx` | 75-90% | Quartiers avec recherche |

### Données statiques

| Fichier | Contenu |
|---------|---------|
| `/data/categories-v2.ts` | Arbre hiérarchique des catégories |
| `/data/colors.ts` | 18 couleurs prédéfinies |
| `/data/materials.ts` | 25 matières |
| `/data/sizes.ts` | Tailles par type de catégorie |
| `/data/neighborhoods.ts` | ~80 quartiers de Montréal |

---

## 4. Analyse des points de friction

### Friction haute

| Problème | Impact | Sévérité |
|----------|--------|----------|
| **Formulaire trop long** | Scroll fatiguant, perte de vue d'ensemble | 🔴 Haute |
| **Pas de sauvegarde brouillon** | Perte de travail si interruption | 🔴 Haute |
| **Catégorie obligatoire mais en bas** | Champ critique mal positionné | 🔴 Haute |

### Friction moyenne

| Problème | Impact | Sévérité |
|----------|--------|----------|
| **Aucun indicateur de progression** | L'utilisateur ne sait pas où il en est | 🟠 Moyenne |
| **Photos non obligatoires** | Articles sans photos = mauvaise expérience acheteur | 🟠 Moyenne |
| **Validation seulement à la soumission** | Feedback tardif | 🟠 Moyenne |
| **Pas de preview avant publication** | Surprises possibles | 🟠 Moyenne |

### Friction basse

| Problème | Impact | Sévérité |
|----------|--------|----------|
| **Pas de limite caractères visible** | Incertitude utilisateur | 🟡 Basse |
| **Marque en texte libre** | Pas d'autocomplétion, typos possibles | 🟡 Basse |

---

## 5. Recommandations UX

### Option A: Formulaire multi-étapes (recommandé)
Diviser le formulaire en 4-5 écrans avec progression visuelle.

```
[Photos] → [Infos de base] → [Catégorie & Détails] → [Livraison] → [Preview & Publier]
```

**Avantages**:
- Moins intimidant
- Focus sur une tâche à la fois
- Possibilité de sauvegarde entre étapes
- Indicateur de progression clair

**Inconvénients**:
- Plus de navigation
- Nécessite refonte importante

---

### Option B: Formulaire accordéon optimisé
Garder le formulaire unique mais avec sections collapsibles et validation progressive.

**Améliorations**:
1. Sections en accordéon (une ouverte à la fois)
2. Indicateurs de complétion par section (✓)
3. Validation en temps réel
4. Bouton "Preview" avant publication
5. Sauvegarde brouillon automatique

**Avantages**:
- Moins de refonte
- Vue d'ensemble conservée
- Amélioration incrémentale

---

### Option C: Wizard intelligent
Formulaire adaptatif qui montre uniquement les champs pertinents selon la catégorie.

**Exemple**: Si catégorie = "Livres", ne pas demander taille/couleur/matière.

---

## 6. Spécifications techniques pour développement

### Priorité 1: Quick wins

| Amélioration | Fichier concerné | Effort |
|--------------|------------------|--------|
| Rendre les photos obligatoires (min 1) | `sell.tsx` | Faible |
| Ajouter compteur caractères titre/description | `sell.tsx` | Faible |
| Déplacer catégorie en haut de la section Détails | `sell.tsx` | Faible |
| Validation temps réel (bordure rouge si erreur) | `sell.tsx` | Moyen |

### Priorité 2: Améliorations moyennes

| Amélioration | Fichiers concernés | Effort |
|--------------|-------------------|--------|
| Écran de preview avant publication | Nouveau composant | Moyen |
| Sauvegarde brouillon (AsyncStorage) | `sell.tsx` + nouveau service | Moyen |
| Autocomplétion marques | `sell.tsx` + `/data/brands.ts` | Moyen |
| Indicateurs de complétion par section | `sell.tsx` | Moyen |

### Priorité 3: Refonte majeure

| Amélioration | Fichiers concernés | Effort |
|--------------|-------------------|--------|
| Wizard multi-étapes | Nouveau flow complet | Élevé |
| Champs dynamiques selon catégorie | Logic + data restructure | Élevé |

---

## 7. Wireframes textuels

### Flow multi-étapes proposé

#### Étape 1/5 - Photos
```
┌─────────────────────────────────────┐
│  ← Retour          Étape 1/5        │
│  ━━━━━○○○○○                         │
├─────────────────────────────────────┤
│                                     │
│   Ajoutez vos photos                │
│   Minimum 1, maximum 5              │
│                                     │
│   ┌─────┐ ┌─────┐ ┌─────┐           │
│   │  +  │ │     │ │     │  ...      │
│   └─────┘ └─────┘ └─────┘           │
│                                     │
│   💡 La première photo sera         │
│   la photo principale               │
│                                     │
├─────────────────────────────────────┤
│   [        Continuer        ]       │
└─────────────────────────────────────┘
```

#### Étape 2/5 - Informations
```
┌─────────────────────────────────────┐
│  ← Retour          Étape 2/5        │
│  ━━━━━━━━━━○○○○○                    │
├─────────────────────────────────────┤
│                                     │
│   Décrivez votre article            │
│                                     │
│   Titre *                           │
│   ┌─────────────────────────────┐   │
│   │                             │   │
│   └─────────────────────────────┘   │
│                           0/80 car  │
│                                     │
│   Description *                     │
│   ┌─────────────────────────────┐   │
│   │                             │   │
│   │                             │   │
│   └─────────────────────────────┘   │
│                          0/500 car  │
│                                     │
│   Prix *                            │
│   ┌────────────┐                    │
│   │          € │                    │
│   └────────────┘                    │
│                                     │
├─────────────────────────────────────┤
│   [        Continuer        ]       │
└─────────────────────────────────────┘
```

#### Étape 3/5 - Catégorie & Détails
```
┌─────────────────────────────────────┐
│  ← Retour          Étape 3/5        │
│  ━━━━━━━━━━━━━━━━○○○○               │
├─────────────────────────────────────┤
│                                     │
│   Catégorisez votre article         │
│                                     │
│   Catégorie *                       │
│   ┌─────────────────────────────┐   │
│   │ Femmes > Vêtements > Robes  │ › │
│   └─────────────────────────────┘   │
│                                     │
│   État *                            │
│   ○ Neuf avec étiquettes            │
│   ● Très bon état                   │
│   ○ Bon état                        │
│   ○ Satisfaisant                    │
│                                     │
│   ─────── Optionnel ───────         │
│                                     │
│   Marque          Taille            │
│   ┌──────────┐    ┌──────────┐      │
│   │          │    │ Choisir  │ ›    │
│   └──────────┘    └──────────┘      │
│                                     │
│   Couleur         Matière           │
│   ┌──────────┐    ┌──────────┐      │
│   │ Choisir  │ ›  │ Choisir  │ ›    │
│   └──────────┘    └──────────┘      │
│                                     │
├─────────────────────────────────────┤
│   [        Continuer        ]       │
└─────────────────────────────────────┘
```

#### Étape 4/5 - Livraison
```
┌─────────────────────────────────────┐
│  ← Retour          Étape 4/5        │
│  ━━━━━━━━━━━━━━━━━━━━━━○○           │
├─────────────────────────────────────┤
│                                     │
│   Comment souhaitez-vous vendre?    │
│                                     │
│   ☑ Remise en main propre           │
│     Rencontrez l'acheteur           │
│     ┌───────────────────────┐       │
│     │ 📍 Quartier Latin     │ ›     │
│     └───────────────────────┘       │
│                                     │
│   ☑ Livraison                       │
│     Mondial Relay, Colissimo...     │
│                                     │
│     Taille du colis                 │
│     ┌─────┐ ┌─────┐ ┌─────┐         │
│     │Petit│ │Moyen│ │Grand│         │
│     │<500g│ │ <1kg│ │ <2kg│         │
│     └─────┘ └─────┘ └─────┘         │
│     ✓ suggéré                       │
│                                     │
├─────────────────────────────────────┤
│   [        Continuer        ]       │
└─────────────────────────────────────┘
```

#### Étape 5/5 - Preview & Publication
```
┌─────────────────────────────────────┐
│  ← Retour          Étape 5/5        │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━       │
├─────────────────────────────────────┤
│                                     │
│   Vérifiez votre annonce            │
│                                     │
│   ┌─────────────────────────────┐   │
│   │  [Photo principale]         │   │
│   │                             │   │
│   │  Robe d'été fleurie         │   │
│   │  25,00 €                    │   │
│   │                             │   │
│   │  Femmes > Robes             │   │
│   │  Taille M · Très bon état   │   │
│   │  🚚 Livraison · 🤝 Meetup    │   │
│   └─────────────────────────────┘   │
│                                     │
│   ✏️ Modifier                        │
│                                     │
├─────────────────────────────────────┤
│   [    Publier l'article    ]       │
└─────────────────────────────────────┘
```

---

## 8. Métriques de succès

| Métrique | Objectif |
|----------|----------|
| Taux de complétion du formulaire | > 70% |
| Temps moyen de création | < 3 minutes |
| Articles avec photos | 100% |
| Articles avec description > 50 car | > 80% |

---

## 9. Prochaines étapes

1. **Validation** - Revoir ce document avec stakeholders
2. **Choix de l'option** - A (multi-étapes), B (accordéon), ou C (adaptatif)
3. **Prototypage** - Créer maquettes Figma/Excalidraw
4. **Tech spec** - Spécifications techniques détaillées
5. **Développement** - Implémentation par stories

---

*Document généré par l'analyse du code existant - Mary, Business Analyst*
