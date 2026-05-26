# Audit #06 — Création et mise en vente d'un produit

**Date** : 2026-05-26 | **Incohérences** : 18 (3C, 5H, 8M, 2B)

## Résumé

Flow vente (photos→IA→details→prix→preview→publication) globalement fonctionnel. L'analyse IA auto-remplissant les champs est une force. Problèmes critiques : régression couleurs/matières multi→single entre création et édition, absence de gate auth sur Android, images draft dans un path Storage non-scopé.

## Incohérences

### CRITIQUES

1. **Édition dégrade couleurs/matières** — création multi-select (`details.tsx:80-83` `colors: string[]`), édition single-select (`edit/[id].tsx:53-54` `color: string`). Perte de données silencieuse.
2. **Absence gate auth dans le flow sell sur Android** — aucun `useAuthRequired` dans `capture.tsx`, `details.tsx`, `pricing.tsx`. Auth vérifiée seulement à `preview.tsx:141`.
3. **Images draft path non-scopé** — `storage.rules:51-55` : `drafts/{draftId}/` sans vérification userId.

### HAUTES

4. Édition permet de modifier un article vendu sans avertissement.
5. Édition ne permet pas de modifier les photos.
6. Édition ne permet pas de modifier les options de livraison.
7. Suppression ne vérifie pas les transactions actives côté client.
8. Aucune vérification `emailVerified` avant publication.

### MOYENNES

9. Prix minimum inconsistant client (>0) vs serveur (>=0.01).
10. Max images client (5) vs serveur (20).
11. Description non requise à la création mais requise à l'édition.
12. StepProgressBar existe mais jamais intégré au flow.
13. Bouton "Publier" sans guard ref anti-double-tap.
14. Accents français manquants (Matière, Expédition, sauvegardées, publiée, Montréal).
15. Auto-navigation après analyse IA prive l'utilisateur de revoir ses photos.
16. Aucune détection de doublons d'articles.

### BASSES

17. Aucune gestion du mode hors ligne.
18. Message succès hardcode "Montréal".

## Fichiers clés

- `app/sell/` (capture, photos-review, details, pricing, preview)
- `app/article/edit/[id].tsx`
- `services/draftService.ts`, `services/articlesService.ts`, `services/aiService.ts`
- `functions/src/callable/products.ts`
- `storage.rules`, `firestore.rules`
- `components/sell/SuccessModal.tsx`, `components/sell/StepProgressBar.tsx`
