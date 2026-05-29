# AUDIT REPORT -- SwapZone / Swap Party Feature

## Resume executif

| Severite | Nombre |
|----------|--------|
| CRITIQUE | 3 |
| HAUTE | 5 |
| MOYENNE | 7 |
| BASSE | 4 |
| **Total** | **19** |

Les findings critiques sont (1) le cash top-up UI expose une feature que le backend rejette systematiquement, (2) les articles vendus via vente normale restent visibles dans les swap parties comme articles disponibles, et (3) une race condition TOCTOU entre le check des swaps actifs et la transaction de depart.

---

## CRITIQUE

### [CRITIQUE] Cash top-up UI entierement interactive mais backend rejette systematiquement

**Scenario** : L'utilisateur ouvre l'ecran propose-swap, voit "Ajouter un complement en argent", saisit 50$, selectionne un payeur, soumet. Le backend rejette avec "Le complement monetaire n'est pas encore disponible."

**Code** :
- `features/propose-swap/components/ValueComparisonBox.tsx:71-135` -- Section cash top-up entierement interactive avec input montant, toggle payeur, bouton de suggestion
- `app/propose-swap.tsx:208-214` -- Envoie `cashTopUp` payload a proposeSwap
- `functions/src/callable/swaps.ts:106-110` -- Rejette toute requete avec `cashTopUp` :
  ```typescript
  if (cashTopUp) {
    throw new HttpsError('unimplemented', 'Le complement monetaire n\'est pas encore disponible.');
  }
  ```

**Impact** : L'utilisateur remplit un formulaire detaille qui echoue toujours. Deception UX directe.

**Recommandation** : Soit cacher la section cash top-up, soit l'afficher en disabled/greyed avec "Bientot disponible".

---

### [CRITIQUE] Article vendu via vente normale reste visible et swappable dans les swap parties

**Scenario** : User A liste un article, l'ajoute a une swap party. User B achete l'article via le flow normal (Stripe). L'article passe `isSold: true`. Mais l'entree `swapPartyItems` reste avec `isSwapped: false`, donc l'article apparait toujours comme disponible dans la swap party.

**Code** :
- `functions/src/triggers/products.ts` -- Le trigger `onArticleWritten` ne nettoie **jamais** `swapPartyItems` quand `isSold` passe a `true`
- `services/swapService.ts:294-308` -- `getPartyItems` filtre seulement par `isSwapped: false`, jamais par `isSold` de l'article sous-jacent
- `services/swapService.ts:314-347` -- `getPartyItemsExtended` fetch les articles mais ne filtre pas les vendus

**Impact** : Les utilisateurs voient des articles vendus dans les swap parties et peuvent initier des swaps pour eux. Le swap echouera a la soumission (`validateArticlesAvailable` check `isSold`), mais apres un effort de selection inutile.

**Recommandation** : Ajouter un trigger ou Cloud Function qui, quand un article passe `isSold: true`, marque automatiquement tous les `swapPartyItems` correspondants comme `isSwapped: true` et decremente `itemsCount`.

---

### [CRITIQUE] leaveSwapPartySecure a une race condition TOCTOU sur le check des swaps actifs

**Scenario** : L'utilisateur n'a pas de swaps actifs au temps T1 (pre-check). Entre T1 et T2 (transaction), un autre utilisateur propose un swap impliquant les items de cet utilisateur. La transaction supprime les items pendant qu'un swap les reference.

**Code** :
- `functions/src/callable/swaps.ts:546-563` -- Le check des swaps actifs tourne HORS de la transaction (query avec `in` operator, read-only)
- `functions/src/callable/swaps.ts:569-615` -- La transaction de suppression tourne separement

**Impact** : L'utilisateur quitte la party, ses items sont supprimes, mais un swap concurrent referant ces items est dans un etat inconsistant.

**Recommandation** : Deplacer le check dans la transaction, ou verifier `isPending` sur les `swapPartyItems` de l'utilisateur dans la transaction. Si un item est `isPending`, rejeter le depart.

---

## HAUTE

### [HAUTE] swap_proposed notification sans deep link routing au tap

**Code** :
- `functions/src/triggers/swaps.ts:81` -- Type notification `'swap_proposed'`
- `hooks/useNotificationSetup.ts:65-138` -- Switch statement sans `case 'swap_proposed':`
- `functions/src/utils/notifications.ts:41-49` -- `buildDeepLink` sans `swap_proposed`

**Impact** : Au tap de la notification, le deep link in-app est vide. Le fallback fonctionne partiellement via `data.swapId`, mais le comportement est non-deterministe.

**Recommandation** : Ajouter `case 'swap_proposed':` aux deux endroits, routant vers `/swap/{swapId}`.

---

### [HAUTE] FlashList sans estimatedItemSize dans swap-party et my-swaps

**Code** :
- `app/swap-party/[id].tsx:414-421` -- FlashList sans `estimatedItemSize`
- `app/my-swaps.tsx:170-204` -- FlashList sans `estimatedItemSize`

**Impact** : FlashList log un warning et utilise un estimate pauvre, causant du jank et une consommation memoire accrue.

**Recommandation** : Ajouter `estimatedItemSize={200}` aux deux FlashList.

---

### [HAUTE] Tutoiement/vouvoiement inconsistant dans la feature swap

**Code** :
- `app/swap-party/[id].tsx:191` -- "Es-tu sur de vouloir quitter" (tu)
- `features/swap/components/SwapActions.tsx:191-192` -- "Retrouvez-vous pour echanger" (vous)
- `features/propose-swap/components/ValueComparisonBox.tsx:41` -- "Vos articles" (vous)
- `functions/src/triggers/swaps.ts:203` -- "N'oublie pas d'envoyer les photos de ton article" (tu)

**Impact** : L'app semble inconsistante. Pour une marketplace Gen Z/millennials, le tutoiement est plus adapte.

**Recommandation** : Standardiser sur "tu" dans toute la feature swap.

---

### [HAUTE] getPartyItemsExtended fait N+1 lectures Firestore

**Code** : `services/swapService.ts:314-347` -- Pour N items dans une party, fait 1 + N lectures (Promise.all sur chaque article).

**Impact** : Pour une party de 200 items, 201 lectures Firestore. Latence et cout significatifs.

**Recommandation** : Denormaliser les champs pertinents dans `swapPartyItems` ou batch les lectures avec `documentId()` in queries (max 30 par query).

---

### [HAUTE] isPending non filtre dans getPartyItems -- items en swap pending visibles comme disponibles

**Code** :
- `services/swapService.ts:294-308` -- `getPartyItems` filtre par `isSwapped: false` mais PAS par `isPending`
- `services/swapService.ts:619-637` -- `getUserAvailablePartyItems` filtre `isPending` client-side mais pas la grid principale

**Impact** : La grille principale de la party montre des items qui sont dans des swaps pending. Les utilisateurs peuvent essayer de swapper des items deja en cours de negotiation.

**Recommandation** : Ajouter `where('isPending', '!=', true)` a la query `getPartyItems`, ou filtrer client-side.

---

## MOYENNE

### [MOYENNE] SwapPartyItem type manque le champ isPending

**Code** :
- `types/index.ts:674-686` -- `SwapPartyItem` n'inclut pas `isPending`
- `services/swapService.ts:636` -- Type assertion hack : `(item as SwapPartyItem & { isPending?: boolean }).isPending`
- `firestore-schema.md:661` -- Schema documente `isPending?: boolean`

**Recommandation** : Ajouter `isPending?: boolean;` a l'interface `SwapPartyItem`.

---

### [MOYENNE] Notification "declined" affiche toujours receiverName comme declineur

**Code** :
- `functions/src/triggers/swaps.ts:186-189` -- `body = '${after.receiverName} a refuse...'`
- `functions/src/callable/swaps.ts:972-974` -- Les deux parties (initiator et receiver) peuvent decliner

**Impact** : Quand l'initiateur decline, la notification dit "ReceiverName a refuse" -- ce qui est faux.

**Recommandation** : Utiliser le champ `declinedBy` pour determiner qui a decline.

---

### [MOYENNE] useSwapZone hook a un dual-path de data fetching redondant

**Code** : `hooks/useSwapZone.ts:39-107` -- Appelle un CF, puis fallback sur lectures Firestore directes. `features/home/swap-zone/useSwapParties.ts:50-57` appelle le meme CF sans fallback.

**Impact** : Deux hooks pour les memes donnees avec des strategies d'erreur differentes.

**Recommandation** : Consolider vers un seul hook.

---

### [MOYENNE] Article dans swap party peut aussi etre en vente normale simultanement

**Code** : `functions/src/callable/swaps.ts:680-694` -- `addItemToPartySecure` ne marque PAS l'article comme reserve. Aucun flag `inSwapParty` sur la collection `articles`.

**Impact** : Un article peut etre achete via Stripe pendant qu'il est dans une swap party.

**Recommandation** : Soit marquer les articles avec `inSwapParty: true` et les exclure de la vente normale, soit s'assurer que le trigger normal-sale nettoie les swap party items.

---

### [MOYENNE] Pas de chemin d'annulation pour les swaps acceptes

**Code** : `functions/src/callable/swaps.ts:1014-1070` -- `cancelSwap` n'autorise l'annulation que quand `status === 'proposed'`. Pas d'abort entre `accepted` et `shipping`.

**Impact** : Les utilisateurs sont coinces dans un swap qu'ils ne veulent plus pendant les phases `accepted` et `photos_pending`.

**Recommandation** : Permettre l'annulation (avec consentement mutuel) pendant `accepted` et `photos_pending`, ou ajouter un timeout.

---

### [MOYENNE] Terminologie inconsistante "party" vs "Swap Zone"

**Code** :
- `features/swap-party/components/PartyActions.tsx:45` -- "Quitter la party"
- `app/swap-parties.tsx:157` -- Header "Swap Zones"
- `app/swap-party/[id].tsx:191` -- Alert "Quitter cette Swap Zone"
- `app/swap-party/[id].tsx:204` -- Erreur "Impossible de quitter la party"

**Impact** : Confusion terminologique.

**Recommandation** : Remplacer toutes les instances user-facing de "party" par "Swap Zone".

---

### [MOYENNE] Pas de storage rules pour les uploads de photos de swap

**Code** : `app/swap/[id].tsx:203-206` -- Upload vers `swaps/${id}/photos/${user.id}_${i}_${Date.now()}.jpg`

**Impact** : A verifier que les storage rules couvrent le path `swaps/` avec des checks d'autorisation.

**Recommandation** : Verifier et ajouter des rules si necessaire.

---

## BASSE

### [BASSE] Countdown affiche "Fin bientot" immediatement quand endDate passe

**Code** : `components/home/SwapZoneSection.tsx:103-108` -- `formatCountdownDisplay` retourne "Fin bientot" quand `days <= 0`. Le scheduled function qui transition le status tourne toutes les 5 minutes.

**Impact** : Fenetre de 5 minutes ou la party est "active" mais affiche "Fin bientot".

**Recommandation** : Override client-side : si `party.status === 'active'` et `endDate < now`, afficher comme terminee.

---

### [BASSE] Filtre de tailles melange des systemes heterogenes sans contexte

**Code** : `components/SwapZoneFilters.tsx:214` -- `[...SIZES.tops, ...SIZES.bottoms.slice(0, 4), ...SIZES.shoes.slice(0, 6)]` dans une liste plate.

**Impact** : "36" apparait pour les pantalons et les chaussures. Confusion.

**Recommandation** : Grouper par categorie ou filtrer contextuellement.

---

### [BASSE] Valeurs de taille dupliquees dans le filtre causent un filtrage incorrect

**Code** : `hooks/useSwapFilters.ts:36-48` -- Match de taille par string direct. "36" matche a la fois pantalons et chaussures.

**Recommandation** : Utiliser des tailles qualifiees par categorie.

---

### [BASSE] Swap detail (real-time) vs party detail (10min stale)

**Code** :
- `app/swap/[id].tsx:58-63` -- Uses `onSnapshot` (real-time)
- `app/swap-party/[id].tsx:60-80` -- React Query avec `staleTime: 10 * 60 * 1000`

**Impact** : Les ajouts d'items par d'autres participants n'apparaissent pas avant refresh.

**Recommandation** : Reduire `staleTime` a 30-60 secondes pour les parties actives.

---

## Points positifs notes

1. **Account deletion gere correctement le cleanup swap** (`functions/src/callable/users.ts:177-226`)
2. **Counter management atomique** avec `FieldValue.increment()` dans les transactions
3. **Party end cleanup complet** (`functions/src/scheduled/swaps.ts:16-83`)
4. **Security rules bloquent la manipulation des compteurs par le client**
5. **Swap proposal utilise runTransaction avec validation de disponibilite des articles**
