# Audit #09 — Profil utilisateur/vendeur et settings

**Date** : 2026-05-26 | **Incohérences** : 19 (2C, 5H, 7M, 5B)

## Résumé

Infrastructure profil/settings bien structurée (re-auth multi-provider, suppression PIPEDA, propagation trigger). Critiques : export données PIPEDA incomplet (5 collections vs 15+ dans la suppression), préférence "masquer photo" jamais respectée côté serveur.

## Incohérences

### CRITIQUES

1. **Export PIPEDA incomplet** — `userService.ts:349-448` couvre 5 collections. `deleteUserAccount` nettoie 15+. Manquent : `avis`, `transactions`, `swaps`, `seller_balances`, `withdrawal_requests`, `drafts`, `savedSearches`, `searchHistory`, `swapPartyParticipants/Items`.
2. **Préférence "masquer photo" non respectée** — `preferences.privacy.showProfilePhoto` stocké mais `getUserPublicProfile` (`reviews.ts:307`) renvoie `profileImage` inconditionnellement.

### HAUTES

3. Champ image inconsistant chat (`userImage` vs `profileImage` selon format array/map).
4. Pas de pré-remplissage adresse au checkout depuis le profil.
5. Email Firestore jamais synchronisé après changement via `verifyBeforeUpdateEmail`.
6. Suppression compte ne nettoie pas les reviews reçues (`vendeurId == uid`).
7. Fichier `helcim.ts` restant dans les CF.

### MOYENNES

8. Préférence `allowSearchEngines` jamais consommée.
9. Adresse mono-adresse (pas de multi-adresses).
10. Checkout hardcode "Montreal"/"QC".
11. Locale `fr-FR` utilisée partout au lieu de `fr-CA`.
12. Aucune validation format displayName.
13. Téléphone non vérifié (wording "vérifié" trompeur).
14. Profil propre vs public — données différentes affichées.

### BASSES

15. Vouvoiement globalement cohérent (RAS).
16. Bouton "Enregistrer" sans guard ref.
17. Export client-side — risque timeout gros comptes.
18. Écran `payments.tsx` accessible par URL mais commenté dans le menu.
19. `getUserPublicProfile` retourne tout mais le client fait 4 requêtes séparées.

## Points positifs

- Re-authentification multi-provider excellente (5 cas gérés)
- Suppression de compte exhaustive (17 catégories, bulkWriter)
- Propagation displayName/profileImage via trigger
- Format téléphone canadien correct (+1, 10 chiffres)
- Adresse restreinte au Canada (Google Places)

## Fichiers clés

- `app/settings/` (profile-details, email, phone, address, privacy, delete-account, export-data)
- `services/userService.ts`, `services/authService.ts`
- `store/authStore.ts`, `functions/src/callable/users.ts`
- `functions/src/triggers/users.ts`, `functions/src/callable/reviews.ts`
- `types/index.ts`, `firestore.rules`
