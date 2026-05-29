# Second — Analyse de marché et projections de croissance (12 trimestres)

**Document interne d'analyse et de projection · Horizon Q3 2026 → Q2 2029 · Devise : CAD**
*Préparé le 29 mai 2026. Statut projet : MVP déployé, pré-lancement, capital fondateur ~250K CAD.*

> **Avertissement.** Ce document présente des **projections**, pas des garanties. Tous les chiffres sont ancrés sur des benchmarks publics de marketplaces C2C mode comparables (Poshmark, Depop, Vinted) et sur les paramètres de frais réels du code (`functions/src/utils/fees.ts`), mais aucune donnée publique n'isole un lancement C2C mode **mono-métropole francophone** à budget comparable. Les fourchettes (conservateur → optimiste) traduisent l'incertitude réelle. La section 8 détaille les limites et le niveau de confiance par bloc, y compris les corrections issues d'une vérification adverse interne.

---

## 1. Résumé exécutif

Second vise un lancement beta à Montréal en Q3 2026, en régime **cold-start sans notoriété** (acteur inconnu, 250K CAD, une seule métropole, mono-FR). Ce régime est ~3-4x plus lent qu'un lancement financé de type Poshmark Canada. Le modèle est **bottom-up par canal d'acquisition**, plafonné par le budget marketing (~40-90K CAD sur l'horizon) et confronté à un plafond top-down (SAM RMR adressable ~700K personnes).

**Trajectoire utilisateurs (scénario base mis en avant, fourchette conservateur → optimiste) :**

| Jalon | Inscrits cumulés | MAU | Acheteurs actifs |
|---|---|---|---|
| **Fin Y1 — Q4 (Q2 2027)** | **5 500** (3 600 → 12 500) | **~2 100** (1 260 → 5 125) | ~1 300 (782 → 3 181) |
| **Fin Y2 — Q8 (Q2 2028)** | **20 200** (12 700 → 52 500) | **~6 900** (3 937 → 19 425) | ~4 400 (2 540 → 12 532) |
| **Fin Q12 (Q2 2029)** | **53 700** (31 600 → 145 500) | **~16 100** (8 848 → 48 015) | ~10 700 (5 899 → 32 010) |

**Trajectoire de revenu net plateforme (scénario base, fourchette conservateur → optimiste), revenu net trimestriel :**

| Jalon | Revenu net trimestriel (base) | Fourchette | GMV trimestrielle (base) |
|---|---|---|---|
| **Fin Y1 — Q4 (Q2 2027)** | **~1 900 CAD** | 1 145 → 4 659 CAD | ~40 860 CAD |
| **Fin Y2 — Q8 (Q2 2028)** | **~12 500 CAD** | 6 279 → 39 891 CAD | ~171 155 CAD |
| **Fin Q12 (Q2 2029)** | **~40 300 CAD** | 19 495 → 135 823 CAD | ~512 781 CAD |

**Verdict central.** Les cibles top-down du business plan initial (5K MAU à 6 mois → 400K à 36 mois) sont calquées sur un régime « acteur établi financé » et **doivent être révisées à la baisse d'un facteur ~8-25x** pour le scénario auto-financé. Même le scénario optimiste — qui suppose explicitement une **levée de croissance de 1,5-4M CAD entre Q4 et Q6** — reste ~8x sous la cible 400K. Le revenu net par transaction est mince (~1,40 CAD à AOV 30) : la **rentabilité dépend du volume de transactions**, donc de la liquidité atteinte à Montréal, pas du nombre d'inscrits. La rentabilité opérationnelle n'est **pas atteinte** sur l'horizon de 12 trimestres sans volume très supérieur ou monétisation additionnelle.

---

## 2. Le marché et le besoin

**Un gap structurel francophone.** Il n'existe **aucune marketplace C2C mode seconde main nativement francophone et mobile-first** au Québec. Le paysage concurrentiel laisse un vide clair :

- **Vinted a quitté le Canada en février 2024** (relancé aux US en janvier 2026) — le seul acteur au modèle 0% vendeur identique à Second n'est pas présent.
- **Poshmark** est le leader canadien mais prélève **20% de commission vendeur** et n'a pas d'interface nativement française.
- **Depop** (10% + frais) est anglophone et orienté Gen Z anglo.
- **Facebook Marketplace / Kijiji** sont génériques (classifieds, pas de protection ni de logistique intégrée).
- **Vestiaire Collective** cible le luxe (minimum ~34 CAD).

**Une demande réelle, mais à calibrer prudemment.**

- **56% des Québécois** ont acheté de la seconde main dans les 12 derniers mois (étude population QC, achat seconde main 12 mois — à ré-attribuer formellement, voir §8). C'est le **seul taux réellement provincial** utilisé dans le modèle (filtre de propension du SAM).
- ⚠️ **Correction méthodologique (vérification adverse) :** les chiffres « Gen Z 86% / millennials 83% » initialement présentés comme québécois sont en réalité une **statistique globale ThredUp** (« bought OR sold a pre-loved item », monde entier, toutes générations), avec biais commercial. Ils sont **retirés du narratif**. La fourchette prudente Gen Z/Millennials Amérique du Nord est **51-68%** (ThredUp, biais signalé). Le Québec (56% toutes générations) est **sous la moyenne nationale canadienne** (~77%) — signal à creuser, pas à gonfler.
- **Marché resale apparel Canada : ~4,2 Md CAD (2023), +13% YoY, +15% prévu 2024** (Trendex via Retail-Insider). L'e-commerce resale ≈ 1/8 du volume brick-and-mortar → online ~525M CAD. ⚠️ Une source secondaire (Future Market Insights) avance ~1,9 Md USD pour le Canada — écart ~60% non réconcilié ; **Trendex est retenu comme référence canadienne primaire**, FMI comme borne basse de faible autorité.
- **Vent arrière 2026 :** au Canada, 95,2% des consommateurs disent que la hausse du coût de la vie a affecté leurs finances, 49% ont réduit leurs dépenses (Harris & Partners, mai 2026) — favorable à la valeur/seconde main, mais peut aussi **compresser le panier moyen**.
- **Réservoir d'amorçage :** ~180-200K étudiants universitaires sur l'île (McGill, UdeM, Concordia, UQAM) — beachhead Gen Z dense et géographiquement concentré (« réseau atomique » au sens a16z).

**Différenciateurs produit (codebase vérifié) :** 0% commission vendeur, protection acheteur `max(2$ ; prix×5%+1,50$)`, paiement Stripe Connect white-label 100% in-app, Swap Zone (troc), recherche visuelle / pricing assisté IA, flow de vente photo→IA, mono-FR.

---

## 3. Méthodologie

Le modèle est **bottom-up trimestriel** sur 12 trimestres (Q1 = Q3 2026 → Q12 = Q2 2029), construit en couches puis **confronté à un plafond top-down**.

**Construction de l'acquisition par canal, bornée par le budget :**
- **Paid social** plafonné par le budget : ~7,5K CAD/trim ÷ ~20 CAD CAC par inscrit actif ≈ **375 inscrits/trim** (CPI Amérique du Nord ~7 CAD, Business of Apps 2025). Le paid est **borné par le budget, pas par le marché**.
- **Micro-influenceurs FR Montréal :** 4-6 collabs × ~400 CAD → 400-900 inscrits/trim (vivier réel : Emy Lalune, Maaguie, Shnims, etc.).
- **Organique / ASO / bouche-à-oreille :** croît avec la base installée (multiplicateur ~1,5x le payé, Branch.io), de 150-600/trim early à 1500-3500/trim late.
- **Parrainage :** quasi-nul au lancement, 5-12% de la base active dès Q5-Q6 (médiane 3-5%, ReferralCandy).
- **PR / campus / friperies :** 2000-5000 inscrits sur les 2 premiers trimestres.

**Conversions appliquées :**
- `newDownloads = newRegistered ÷ 0,38` (taux install→inscription ~38%, AppTweak/UXCam).
- `MAU = inscrits cumulés × ratio d'activité` décroissant de 42-45% (early) vers 30-33% (late), reflétant la dilution par inscrits dormants (drop J3 75-77%).
- `acheteurs + vendeurs actifs` répartis selon un ratio **1,5:1 → 2:1** (Poshmark 1,46:1, Depop 2:1→2,3:1). La cible interne 3:1 est **rejetée** (aucun comparable C2C mode ne l'atteint).

**Régime de croissance.** Second relève du régime **cold-start sans notoriété** (Poshmark US 2011 = 15 mois pour 300K, ~4x plus lent que Poshmark Canada financé = 300K en 4 mois). Les benchmarks de lancement financés (Poshmark Canada, Vinted US 2,6M DL en 4 mois) servent de **plafonds théoriques**, jamais de cibles.

**Sources clés :** Poshmark Newsroom (300K CAN en 4 mois ; 15 mois US 2011), Clark Square Capital (filings Poshmark : AOV ~33 USD, ~6 commandes/an, ratio 1,46:1, churn 13-15%/an), Vinted Financial Results 2025 (GMV 10,8 Md€, take rate effectif ~10%), Business of Apps / eBay IR (Depop 789M→1,1 Md USD, ratio 2:1→2,3:1), a16z GMV Retention, Business of Apps CPI/UA 2025, code `functions/src/utils/fees.ts` (modèle de frais vérifié).

---

## 4. Hypothèses clés

| Paramètre | Valeur | Source / benchmark |
|---|---|---|
| Régime de croissance | Cold-start sans notoriété, ~3-4x plus lent que Poshmark Canada | Marketing Scoop (Poshmark US 15 mois/300K) + Poshmark Newsroom (CAN 4 mois) |
| Capital / budget marketing | ~250K CAD capital ; marketing 25-50K (18 mois), 60-90K (36 mois) | Above A — Growth Marketing Budgets Seed 2025 (10-20% du capital) |
| CAC par inscrit actif (paid) | 18-30 CAD (central 20) | Business of Apps UA Costs 2025 (CPI NA ~5-5,32 USD ≈ 7 CAD) |
| Taux install → inscription | ~38% (sert à dériver `newDownloads`) | AppTweak (CVR store ~8,6%) + UXCam onboarding |
| Ratio MAU / inscrits cumulés | 42-45% early → 30-33% late | Dilution dormants + drop J3 75-77% (UXCam/Sendbird) |
| Ratio acheteurs : vendeurs actifs | 1,5:1 → 2:1 (PAS 3:1) | Clark Square (Poshmark 1,46:1) + Depop 2:1→2,3:1 |
| Rétention / churn acheteurs | M1 35-45%, M3 20-30%, M6 12-20% ; churn 12-18%/mois → 8-10% | a16z GMV Retention + Clark Square (Poshmark 13-15%/an = plancher mature) |
| AOV | 30 CAD au lancement, +3%/an (31,83 en Y3) | Triangulation Vinted ~20-25 USD / Poshmark ~33 USD |
| Frais acheteur (code) | `max(2$ ; prix×5%+1,50$)` ; 0% vendeur ; à AOV 30 = 3,00 CAD | `functions/src/utils/fees.ts` (vérifié ligne par ligne) |
| Coût Stripe absorbé | 2,9% + 0,30$ sur le total encaissé (article+frais+livraison ~12$) | Standard Stripe ; choix conservateur (livraison dans l'assiette) |
| Take rate net / transaction | ~1,40 CAD à AOV 30 = 4,65% du GMV (monte à 7-9% en Y3 avec abos) | Code fees.ts + recalcul indépendant |
| SAM RMR adressable (plafond) | ~700K (±15-20%, voir §8) ; SAM Québec ~1,30M | Profil RMR Montréal (Statcan 2011 projeté) × FR 93% × smartphone 95% × seconde main 56% |
| Tendance YoY de marché | +13-15%/an online resale | Trendex / Capital One Shopping / ThredUp (biais signalé) |
| Forfaits boutique | Lancement Q5 (Q3 2027) ; adoption 1,5%→5% des vendeurs (base) ; ARPU pondéré 22$/mois | Conçus non codés ; conversion freemium→paid 2-5% bornée bas |

> ⚠️ **Sur la saisonnalité.** Les multiplicateurs (rentrée 1,20 / fêtes 1,30 / hiver 0,85 / printemps 1,05) sont **documentés et bien sourcés** (Poshmark Q4 +27% GMV record ; Voolist back-to-school prix 2-3x). **Mais la vérification adverse a établi qu'ils ne sont PAS appliqués dans les chiffres** des tableaux ci-dessous : les nouveaux inscrits sont monotones croissants, sans dent de scie hiver/fêtes. La saisonnalité est donc **lissée dans la tendance de fond**, non modélisée trimestre par trimestre. Elle reste un **atout de timing qualitatif** (lancement Q3 2026 en plein back-to-school) mais ne doit pas être lue comme une couche active du modèle.

---

## 5. Estimation utilisateurs par trimestre

### 5.1 Scénario base (12 trimestres)

| Q | Calendrier | Nouv. inscrits | Cumul inscrits | MAU | Acheteurs actifs | Vendeurs actifs |
|---|---|---|---|---|---|---|
| Q1 | Q3 2026 | 800 | 800 | 336 | 202 | 134 |
| Q2 | Q4 2026 | 1 200 | 2 000 | 800 | 486 | 314 |
| Q3 | Q1 2027 | 1 500 | 3 500 | 1 330 | 817 | 513 |
| **Q4** | **Q2 2027 (fin Y1)** | **2 000** | **5 500** | **2 090** | **1 297** | **793** |
| Q5 | Q3 2027 | 2 500 | 8 000 | 2 960 | 1 856 | 1 104 |
| Q6 | Q4 2027 | 3 200 | 11 200 | 4 032 | 2 554 | 1 478 |
| Q7 | Q1 2028 | 4 000 | 15 200 | 5 320 | 3 401 | 1 919 |
| **Q8** | **Q2 2028 (fin Y2)** | **5 000** | **20 200** | **6 868** | **4 431** | **2 437** |
| Q9 | Q3 2028 | 6 000 | 26 200 | 8 646 | 5 627 | 3 019 |
| Q10 | Q4 2028 | 7 500 | 33 700 | 10 784 | 7 077 | 3 707 |
| Q11 | Q1 2029 | 9 000 | 42 700 | 13 237 | 8 757 | 4 480 |
| **Q12** | **Q2 2029 (fin Y3)** | **11 000** | **53 700** | **16 110** | **10 740** | **5 370** |

### 5.2 Fourchette sur les lignes-jalons (cumul inscrits / MAU)

| Jalon | Conservateur | Base | Optimiste |
|---|---|---|---|
| **Q4 (fin Y1)** — cumul | 3 600 | 5 500 | 12 500 |
| Q4 — MAU | 1 260 | 2 090 | 5 125 |
| **Q8 (fin Y2)** — cumul | 12 700 | 20 200 | 52 500 |
| Q8 — MAU | 3 937 | 6 868 | 19 425 |
| **Q12 (fin Y3)** — cumul | 31 600 | 53 700 | 145 500 |
| Q12 — MAU | 8 848 | 16 110 | 48 015 |

> Le scénario **optimiste suppose explicitement une levée Series A de 1,5-4M CAD entre Q4 et Q6** ; il n'est **pas atteignable** avec les seuls 250K CAD. Sans levée, la trajectoire plafonne au scénario base.

### 5.3 Vérification top-down (pénétration du SAM)

SAM RMR adressable ≈ **700K** (±15-20%) ; SAM Québec ≈ 1,30M. Pénétration en fin d'horizon (Q12), **sur cumul d'inscrits** :

| Scénario | Cumul Q12 | % SAM RMR (cumul) | % SAM RMR (**MAU actif**) |
|---|---|---|---|
| Conservateur | 31 600 | 4,5% | 1,3% |
| Base | 53 700 | 7,7% | **2,3%** |
| Optimiste | 145 500 | 20,8% | 6,9% |

La métrique la plus pertinente — **MAU actif / SAM** — reste **très basse** (base 2,3%, optimiste 6,9%), ce qui renforce la crédibilité : aucune marketplace n'atteint une pénétration MAU à deux chiffres élevés en 3 ans sans capital massif.

**Confrontation aux cibles top-down du BP initial (MAU) :**

| Jalon | Cible BP | Base modèle | Facteur d'écart |
|---|---|---|---|
| Mois 6 | 5 000 | ~1 330 | ~4x (5K = borne haute optimiste) |
| Mois 12 | 25 000 | ~2 090 | ~12x |
| Mois 24 | 150 000 | ~6 868 | ~22x |
| Mois 36 | 400 000 | ~16 110 | ~25x (400K = 57% de TOUT le SAM RMR) |

**Verdict :** les cibles BP sont à réviser à la baisse d'un facteur **~8-25x** pour le scénario auto-financé. Elles ne deviennent approchables qu'avec levée de croissance + effet réseau précoce ; 400K à 36 mois reste hors d'atteinte sans expansion pan-canadienne agressive.

---

## 6. Estimation de revenu par trimestre

### 6.1 Unit economics

- **AOV** : 30 CAD (+3%/an).
- **Frais acheteur** à AOV 30 : `max(2$ ; 30×5%+1,50$)` = **3,00 CAD** (take rate brut 10%).
- **Assiette Stripe** = article + frais + livraison ≈ 30+3+12 = 45 CAD → Stripe = 45×2,9%+0,30 = **1,605 CAD**.
- **Revenu net / transaction** = 3,00 − 1,605 ≈ **1,40 CAD** = **take rate net 4,65% du GMV** (avant abos).
- **Transactions / acheteur actif / trimestre** : ⚠️ rampe **par paliers** (correction de libellé : non « linéaire ») — **plat à 1,00 sur Q1-Q3, puis +0,05/trim de Q4 (1,05) à Q12 (1,50)**.
- Take rate net effectif en Q12 : 6,9% (cons) / **7,9% (base)** / 8,9% (opt) — hausse via abos + dilution des composantes fixes par l'AOV.

### 6.2 Scénario base (12 trimestres, CAD)

| Q | Calendrier | GMV | Transactions | Frais bruts | Coût Stripe | Net transac. | Abos boutique | **Total net** |
|---|---|---|---|---|---|---|---|---|
| Q1 | Q3 2026 | 6 060 | 202 | 606 | 324 | 282 | 0 | **282** |
| Q2 | Q4 2026 | 14 580 | 486 | 1 458 | 780 | 678 | 0 | **678** |
| Q3 | Q1 2027 | 24 510 | 817 | 2 451 | 1 311 | 1 140 | 0 | **1 140** |
| **Q4** | **Q2 2027 (fin Y1)** | **40 860** | **1 362** | **4 086** | **2 186** | **1 900** | **0** | **1 900** |
| Q5 | Q3 2027 | 63 098 | 2 042 | 6 208 | 3 333 | 2 851 | 1 122 | **3 973** |
| Q6 | Q4 2027 | 90 753 | 2 937 | 8 928 | 4 794 | 4 093 | 1 980 | **6 073** |
| Q7 | Q1 2028 | 126 103 | 4 081 | 12 406 | 6 661 | 5 679 | 3 168 | **8 847** |
| **Q8** | **Q2 2028 (fin Y2)** | **171 155** | **5 539** | **16 839** | **9 041** | **7 698** | **4 818** | **12 516** |
| Q9 | Q3 2028 | 232 836 | 7 315 | 22 603 | 12 148 | 10 308 | 6 996 | **17 304** |
| Q10 | Q4 2028 | 304 104 | 9 554 | 29 522 | 15 866 | 13 450 | 9 768 | **23 218** |
| Q11 | Q1 2029 | 390 236 | 12 260 | 37 883 | 20 360 | 17 243 | 13 332 | **30 575** |
| **Q12** | **Q2 2029 (fin Y3)** | **512 781** | **16 110** | **49 780** | **26 754** | **22 654** | **17 688** | **40 342** |

### 6.3 Fourchette sur les lignes-jalons (total net trimestriel, CAD)

| Jalon | Conservateur | Base | Optimiste |
|---|---|---|---|
| **Q4 (fin Y1)** | 1 145 | 1 900 | 4 659 |
| **Q8 (fin Y2)** | 6 279 | 12 516 | 39 891 |
| **Q12 (fin Y3)** | 19 495 | 40 342 | 135 823 |

> Même en optimiste avec levée, le total net Q12 (~136K CAD/trim ≈ **544K CAD annualisés**) reste modeste face aux coûts d'exploitation d'une marketplace (équipe, infra, modération, conformité KYC). **La rentabilité opérationnelle n'est pas atteinte sur l'horizon** sans volume très supérieur ou monétisation additionnelle (markup livraison, publicité, boost payant — `otherRevenue` fixé à 0 ici, fidèle à ce qui est codé/décidé).

---

## 7. Sensibilité & risques

**Leviers les plus sensibles (par ordre d'impact) :**

1. **Atteinte de la liquidité locale (déclencheur d'inflexion).** Le passage amorçage → accélération (Q4-Q5) est **conditionnel** à une densité montréalaise suffisante (ratio acheteurs:vendeurs sain, fill rate >25%). Seul ~40% des startups seed atteignent ce tipping point (Qubit). Le scénario conservateur modélise précisément **l'absence d'inflexion**.
2. **AOV** (paramètre revenu le plus sensible). À take rate constant, GMV et revenu sont linéaires en AOV, mais le revenu **net croît plus vite** (dilution des composantes fixes 1,50$ frais + 0,30$ Stripe). À AOV 100, net/tx passe de 1,40 à ~3,10 CAD. Un mix plus cher (manteaux, sacs) améliorerait la marge unitaire — mais le contexte coût de la vie 2026 pousse plutôt à la **compression du panier**.
3. **Conversion / activation** (`inscrit → transacteur ≤7j`) et **sell-through** (`listing → vente`) : **aucun benchmark public canonique** (Poshmark/Vinted ne publient pas ces données). À calibrer empiriquement dès la beta.
4. **CAC et structure budgétaire.** Le paid plafonne à ~375 inscrits/trim ; >85% de la croissance doit venir de l'organique/communautaire. Un échec du seeding supply-first (friperies, ambassadeurs campus) décalerait toute la courbe.

**Risques structurels :**

- **Retour de Vinted au Canada.** Vinted partage le modèle 0% vendeur exact de Second et dispose d'un effet réseau européen massif + budget. Un re-lancement canadien (après son retour US jan. 2026) serait la **menace concurrentielle n°1**.
- **Cold-start non résolu.** Si la liquidité n'est jamais atteinte, l'acquisition plafonne à la capacité des canaux bornés → stagnation (scénario conservateur).
- **Marché FR étroit.** Le mono-FR n'exclut que ~7% d'unilingues anglophones de la RMR (frein faible), mais le **déclin lent du français à Montréal** (francophones à domicile 48,3% sur l'île en 2021) est un point d'attention de positionnement à long terme. La pénétration smartphone Québec (~79% des ménages, la plus basse des provinces) est un léger frein, atténué pour la cible Gen Z urbaine.
- **Revenu unitaire mince.** Rentabilité = fonction du **volume**, donc de la liquidité. La north star à suivre est **GMV / nombre de transactions complétées**, pas les MAU.

---

## 8. Limites & fiabilité

### Corrections issues de la vérification adverse

**Niveau « majeur » (corrigées ou explicitement signalées) :**

1. **Saisonnalité non appliquée.** Revendiquée comme couche active, elle n'apparaît PAS dans les chiffres (inscrits monotones croissants). **Corrigé** : reclassée en tendance lissée + atout de timing qualitatif (§4). Ne pas la lire comme une dent de scie trimestrielle.
2. **MAU = 100% transactants.** Dans toutes les cellules, `acheteurs + vendeurs actifs = MAU` exactement, ce qui élimine tout MAU « navigateur » (browse/like/chat sans transaction). **Conséquence à retenir : le MAU affiché est un plancher de transacteurs** ; le vrai MAU (navigateurs inclus) serait vraisemblablement **1,7-3x plus élevé**. Toute conversion MAU→GMV en aval doit être lue avec cette définition stricte.
3. **« S-curve cold-start décalée » imprécise.** Le narratif annonce un amorçage quasi-plat Q1-Q3, mais le cumul fait ×6,9 en Y1 sans plateau réel — la courbe est en pratique **quasi-linéaire/composée**, pas une logistique décalée. Label à lire avec prudence.
4. **QoQ d'amorçage plus mou que le benchmark.** Le QoQ Q1→Q2 (+50% base) est **sous** la fourchette benchmark interne (+120-200% sur micro-base). Le modèle est donc **plus prudent que son propre benchmark** au démarrage — ce qui va dans le sens conservateur, mais l'étiquette de fourchette QoQ ne doit pas être affichée comme respectée.
5. **« Gen Z 86% / millennials 83% » mal attribués** (stat globale ThredUp, pas QC) → **retirés** (§2).
6. **Seuil de liquidité « 500 transactions/cellule » (FORKOFF)** scopé ride-share/SaaS, **non transposable** à une marketplace mode expédiée → dégradé en **heuristique non sourcée à calibrer en beta**, pas un déclencheur chiffré dur.
7. **Taux 56% QC mal attribué à Trendex** (URL vide) → le chiffre est **réel mais provient du CQCD 2024** (à ré-attribuer formellement). Le SAM hérite de cette correction de traçabilité.

**Niveau « mineur » (signalés, sans impact matériel) :**

- Conservateur Q12 (×63 sur le cumul) trop élevé pour un scénario « sans effet réseau » : note à requalifier en « inflexion faible/tardive ».
- Incohérence d'arrondi AOV (31,83 vs 31,827) en Q9-Q12 : écart <0,01% du GMV.
- Hypothèse « La Maison = 9 ventes/trim » implausiblement basse pour un abonné à 79$/mois : effet <1% du total net.
- Libellé « rampe linéaire » du ratio tx/acheteur → en réalité par paliers (corrigé §6.1).

### Limites méthodologiques de fond (non masquées)

- **Aucun comparable direct** : aucun lancement C2C mode mono-métropole **francophone** à budget comparable n'est documenté publiquement. Tous les benchmarks sont nationaux, fortement financés, ou dopés COVID (Poshmark CAN an 1 = printemps 2020). Ils servent de **plafonds, pas de cibles**.
- **SAM ~700K incertain** : cohortes d'âge RMR basées sur le **recensement 2011 projeté** (×1,146) faute d'accès aux tableaux Statcan 2021 / ISQ par âge. Incertitude **±15-20%** à confirmer.
- **Deux paramètres sans benchmark canonique** (activation inscrit→transacteur, sell-through listing→vente) à calibrer empiriquement dès la beta Q3 2026.
- **Biais ThredUp** (intérêt à gonfler le resale) recoupé avec Capital One Shopping, Trendex et OQLF, mais chiffres en haut de fourchette.

### Niveau de confiance par bloc

| Bloc | Confiance | Justification |
|---|---|---|
| Modèle de frais / unit economics | **Élevée** | Vérifié ligne par ligne dans `fees.ts` ; recalcul indépendant exact au centime (Q1-Q4) |
| Arithmétique des tableaux (cumuls, ratios, revenu) | **Élevée** | Cumuls exacts, ratios nd/nr ~2,63, acheteurs:vendeurs 1,5→2:1 conformes aux benchmarks |
| Benchmarks structurants (Poshmark, Depop, Vinted, CPI) | **Élevée** | Confirmés par recherche web, biais signalés |
| Plafond top-down (pénétration SAM) | **Moyenne-élevée** | Logique solide ; dénominateur SAM ±15-20% (base 2011) |
| Forme de courbe / phase d'amorçage / saisonnalité | **Faible** | Couche cosmétique : labellisée mais non implémentée fidèlement |
| Définition du MAU | **Moyenne** | MAU = plancher transacteurs, pas MAU « réel » navigateurs inclus |
| Adoption forfaits boutique | **Faible** | Aucun comparable direct (forfait finançant une réduction de frais acheteur à 0% commission) |
| Cibles BP initiales (5K→400K) | **Rejetées** | ~8-25x trop hautes en auto-financé ; calquées sur régime financé |

---

## 9. Sources

- Poshmark Newsroom / Blog — 300K utilisateurs CAN en 4 mois (2019), Canada Turns One/Two/Five : https://newsroom.poshmark.com/2019/09/25/poshmark-pays-out-over-2-billion-to-its-community-of-seller-stylists/
- Marketing Scoop — Poshmark US 15+ mois pour 300K (cold-start 2011) : https://www.marketingscoop.com/small-business/poshmark-users/
- Clark Square Capital — analyse filings Poshmark (AOV ~33$, ~6 commandes/an, ratio 1,46:1, churn 13-15%/an) : https://www.clarksquarecapital.com/p/posh-investing-in-poshmark
- Business of Apps / eBay Investor Relations — Depop (789M→1,1 Md USD, ratio 2:1→2,3:1) : https://www.businessofapps.com/data/depop-statistics/
- Vinted Financial Results 2025 — GMV 10,8 Md€ (+47%), revenu 1,1 Md€, take rate ~10% : https://company.vinted.com/newsroom/financial-results-2025
- Appfigures — Vinted US relaunch 2,6M DL en 4 mois (2026) : https://appfigures.com/resources/insights/vinted-comes-to-the-us
- Trendex via Retail-Insider — marché resale apparel Canada 4,2 Md CAD (2023), +13% YoY : https://retail-insider.com/retail-insider/2024/10/the-2023-canadian-resale-apparel-market-trendex/
- ThredUp Resale Report 2025 (GlobalData) — online resale +13-19%/an (biais signalé) : https://newsroom.thredup.com/news/thredup-13th-resale-report
- Capital One Shopping — Thrifting Statistics 2026 : https://capitaloneshopping.com/research/thrifting-statistics/
- Harris & Partners via Retail-Insider — coût de la vie Canada mai 2026 : https://retail-insider.com/retail-insider/2026/05/survey-finds-most-canadians-changing-spending-habits-amid-rising-living-costs-harris-partners/
- Business of Apps — CPI Rates 2025 & User Acquisition Costs 2025 : https://www.businessofapps.com/ads/cpi/research/cost-per-install/
- a16z — GMV Retention : https://a16z.com/gmv-retention-the-marketplace-metric-most-ignore/ ; The Cold Start Problem : https://a16z.com/books/the-cold-start-problem/
- Lenny's Newsletter — How to Kickstart and Scale a Marketplace (supply-first 14/17, liquidité=match rate) : https://www.lennysnewsletter.com/p/how-to-kickstart-and-scale-a-marketplace-9ee
- Qubit Capital — Series A Marketplace Startups (15-20% MoM, ~40% seed→Series A) : https://qubit.capital/blog/preparing-for-series-a-funding-marketplace-startups
- Above A — Growth Marketing Budgets Seed vs Series A 2025 (10-20% du capital) : https://abovea.tech/growth-marketing-budgets-seed-vs-series-a-2025/
- Voolist — Seasonal Reselling Calendar 2026 (back-to-school prix 2-3x) : https://www.voolist.com/blog/seasonal-reselling-calendar
- FashionNetwork — Poshmark Q4 record (+27% GMV) : https://us.fashionnetwork.com/news/Poshmark-posts-record-fourth-quarter-gmv-revenues,1390096.html
- OQLF — Caractéristiques linguistiques population Québec 2021 : https://www.oqlf.gouv.qc.ca/ressources/sociolinguistique/2022/Feuillet_Car-ling-pop-Quebec-2021.pdf
- Ville de Montréal — Profil sociodémographique RMR (Statcan recensement 2011) : http://ville.montreal.qc.ca/pls/portal/docs/PAGE/MTL_STATS_FR/MEDIA/DOCUMENTS/PROFIL_SOCIODEMO_RMR_DE_MONTREAL.PDF
- AppTweak — Average App Conversion Rate per Category : https://www.apptweak.com/en/aso-blog/average-app-conversion-rate-per-category
- UXCam / Sendbird — Mobile App Retention Benchmarks (drop J3 75-77%) : https://uxcam.com/blog/mobile-app-retention-benchmarks/
- ReferralCandy — Referral Program Benchmarks 2025/2026 : https://www.referralcandy.com/blog/referral-program-benchmarks-whats-a-good-conversion-rate-in-2025
- Code Second — modèle de frais vérifié : `/Users/aurelien/dev/Second/functions/src/utils/fees.ts`
- À ré-attribuer formellement : taux 56% achat seconde main QC → **CQCD 2024** (et non Trendex).