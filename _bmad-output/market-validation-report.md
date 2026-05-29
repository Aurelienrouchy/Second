# Rapport de Validation de Marche -- Second

> Marketplace mode seconde main C2C, app mobile React Native/Expo, mono-francais, ciblant le Canada (Montreal). MVP construit, pre-lancement.
>
> Date : 25 mai 2026

---

## Table des matieres

1. [Taille du marche](#1-taille-du-marche)
2. [Analyse concurrentielle detaillee](#2-analyse-concurrentielle-detaillee)
3. [Analyse de la demande](#3-analyse-de-la-demande)
4. [Environnement reglementaire](#4-environnement-reglementaire)
5. [SWOT de Second](#5-swot-de-second)
6. [Validation product-market fit](#6-validation-product-market-fit)
7. [Recommandations strategiques](#7-recommandations-strategiques)
8. [Sources](#8-sources)

---

## 1. Taille du marche

### 1.1 Marche mondial de la mode seconde main

Le marche mondial de la mode seconde main connait une croissance exceptionnelle, portee par la Gen Z, la conscience environnementale et les pressions economiques.

| Indicateur | Valeur | Source |
|-----------|--------|--------|
| Taille du marche mondial 2025 | ~227-257 milliards USD (estimations variant selon les cabinets) | GlobeNewsWire, ThredUp 2026 Resale Report |
| Projection 2030 | 393 milliards USD (ThredUp) / 485 milliards USD (Research and Markets) | ThredUp 2026 Resale Report, GlobeNewsWire |
| TCAC (CAGR) 2025-2031 | 14,7-16,1% selon les sources | Multiple sources |
| Part dans l'habillement mondial | ~10% des depenses vestimentaires mondiales en 2025 | ThredUp 2026 Resale Report |
| Croissance vs retail traditionnel | 4x plus rapide que le marche de l'habillement traditionnel | ThredUp 2026 Resale Report |

**Moteurs de croissance :**
- Le marche secondhand croit 3 a 4 fois plus vite que le retail de mode traditionnel
- La Gen Z et les millennials devraient generer plus de 70% de la croissance du marche de la revente d'ici 2030
- 62% de la Gen Z a achete en seconde main en 2025
- 48% des acheteurs utilisent des outils IA durant leur parcours d'achat seconde main
- L'Asie-Pacifique est la region a plus forte croissance (~50% de la croissance incrementale)

**Note methodologique :** Les estimations de taille de marche varient considerablement selon les cabinets d'etudes (de 52 a 260 milliards USD pour 2025). Cette variation s'explique par des definitions de perimetres differentes (inclusion ou non de certains canaux de distribution, categories de produits, etc.). Les chiffres ThredUp et GlobeNewsWire sont les plus frequemment cites dans l'industrie.

### 1.2 Marche canadien specifique

| Indicateur | Valeur | Source |
|-----------|--------|--------|
| Economie de seconde main au Canada | ~27-30 milliards CAD/an (toutes categories) | Kijiji Second-Hand Economy Index |
| Marche USA + Canada secondhand apparel 2025 | 24,8 milliards USD | Future Market Insights |
| TCAC Canada + USA secondhand apparel 2025-2035 | 12,9% | Future Market Insights |
| Marche resale luxe Canada 2025 | ~45,3 milliards USD (projection) | Retail Insider |
| Projection luxe Canada 2031 | >102,8 milliards USD | Retail Insider |
| % Canadiens ayant achete seconde main (12 derniers mois) | 77% des adultes | Sondage 2025, Retail Insider |
| % Canadiens prevoyant acheter seconde main en 2026 | 60% | Habitat for Humanity ReStore (avril 2026) |

**TAM (Total Addressable Market) -- Canada :**
Le marche total de la seconde main au Canada est estime a ~27-30 milliards CAD annuellement (toutes categories confondues, selon le Kijiji Second-Hand Economy Index). Le segment vetements/mode represente la categorie la plus echangee en seconde main au Canada.

**SAM (Serviceable Addressable Market) -- Mode seconde main Canada en ligne :**
Le canal resale en ligne represente ~60% du marche secondhand apparel USA + Canada selon Future Market Insights. En appliquant cette proportion au marche canadien (estimant la part Canada a ~10-12% du combine USA+Canada, soit ~2,5-3 milliards USD), le SAM en ligne se situerait a **~1,5-1,8 milliard USD**.

**SOM (Serviceable Obtainable Market) -- Quebec francophone, mobile-first :**
- Population du Quebec : 9,06 millions (2025)
- Region metropolitaine de Montreal : 4,38 millions (2025)
- Quebec = ~23% de la population canadienne
- En ciblant initialement la grande region de Montreal (francophones, 18-40 ans, utilisateurs d'apps), le SOM realiste a 3-5 ans apres lancement se situerait a **~50-150 millions CAD** de GMV (Gross Merchandise Value), soit une fraction du marche quebecois de la mode seconde main.

### 1.3 Marche quebecois -- habitudes et culture friperies

Le Quebec et Montreal en particulier possedent une culture forte de la seconde main :

- **56% des Quebecois** ont achete des produits de seconde main dans les 12 mois precedents (etude CQCD, 2024)
- La **rue Saint-Denis** a Montreal s'est transformee en hub pour les friperies depuis la pandemie, avec 7 boutiques vintage ouvertes en 4 ans entre la rue Sherbrooke et l'avenue du Mont-Royal
- Friperies notables : Seconde Vintage (Mile-End), Boutique Les Petits Freres (Plateau Mont-Royal), et de nombreuses autres sur les rues Saint-Laurent, Mont-Royal et dans le Plateau
- La ville de Quebec regorge egalement d'adresses seconde main
- 7+ friperies quebecoises en ligne existent deja (La Penderie du Paradis, etc.), mais aucune n'offre un modele C2C pur de type marketplace app mobile
- Le mouvement "thrift proud" est fort a Montreal, alimente par la culture etudiante (universites McGill, UdeM, Concordia, UQAM) et la communaute creative

---

## 2. Analyse concurrentielle detaillee

### 2.1 Concurrents directs -- Plateformes de revente en ligne

| Concurrent | Au Canada | Francais | Commission | Forces | Faiblesses |
|-----------|-----------|----------|------------|--------|------------|
| **Poshmark** | Oui (depuis 2019, 2,5M+ utilisateurs en 2021) | Partiel -- documents legaux en FR, interface principalement en anglais | 20% (>20 CAD) ou 3,95 CAD fixe (<20 CAD) | Leader au Canada, communaute etablie, social commerce, livraison integree | Commission tres elevee (20%), plaintes vendeurs frequentes, interface pas nativement francaise, UX datee |
| **Depop** | Oui (150 pays) | Partiel -- interface disponible en FR | 10% + PayPal 2,9% + 0,30 CAD | Forte audience Gen Z (~90% <26 ans), esthetique unique, mode vintage/streetwear | Frais PayPal en sus au Canada (elimines US/UK), pas d'etiquette livraison integree, UX orientee UK/US |
| **Facebook Marketplace** | Oui (omnipresent) | Oui (interface bilingue) | 0% (ventes locales) | Zero commission, enorme base utilisateurs, geolocalisation, ventes instantanees en personne | Pas specialise mode, pas de protection acheteur, pas d'expedition integree, spam/arnaques, UX generique, pas de curation |
| **Kijiji** | Oui (leader classifieds) | Oui (site bilingue) | 0% classifieds / 7% Shop Kijiji + 0,25 CAD/listing | Enorme audience canadienne (20M pages vues/mois), bien connu, local | Pas specialise mode, UX classifieds vintage, pas de paiement integre (sauf Shop Kijiji), pas de livraison, en declin face a FB Marketplace |
| **ThredUp** | Livraison au Canada, operations US | Non | Consignation : 3-80% selon prix | Enorme inventaire, curation professionnelle, IA, rapport resale annuel, marque forte | Pas de vente C2C classique (modele consignation), focus US, pas de presence physique au Canada, pas de francais, delais de paiement vendeur |
| **Vinted** | **NON** -- sorti du Canada en fevrier 2024 | S/O | 0% vendeur (acheteur : protection ~5%) | 0% commission vendeur, UX excellente, marque forte en Europe, valorisation 8 milliards EUR | **Sorti du Canada** (problemes de plateforme technique), lance aux US en janvier 2026, pourrait revenir au Canada a terme |
| **Vestiaire Collective** | Oui | Oui (origine francaise) | 12% (125-25 000 CAD) + 3% frais paiement. Min listing : 34 CAD | Luxe/premium, authentification, marque francophone, confiance | Niche luxe uniquement, commission elevee (15% total), minimum 34 CAD exclut le mass market, pas de C2C casual |

### 2.2 Concurrents indirects

| Concurrent | Type | Presence Quebec | Notes |
|-----------|------|-----------------|-------|
| **Village des Valeurs / Value Village** | Friperies physiques (300+ magasins CAN+US) | Oui -- plusieurs magasins au Quebec, expansion en cours (nouveau magasin Saint-Bruno-de-Montarville 2025) | Pas de marketplace en ligne C2C, experience physique uniquement, prix bas mais pas curate, partenariats caritatifs (Croix-Rouge) |
| **Renaissance** | Friperies physiques | Oui -- reseau Quebec | Moins cher que Village des Valeurs, mission sociale, pas de presence en ligne significative |
| **Instagram selling** | Vente sociale | Oui -- communautes actives | 39% des jeunes acheteurs ont fait un achat seconde main via social commerce en 2024. Pas de protection, pas de paiement integre, fragmente |
| **Bunz** | App de troc (Toronto) | Limitee (Toronto-centric) | Relaunch mai 2025, modele troc sans argent, niche, communaute petite, echec de la crypto interne BTZ |
| **La Penderie du Paradis** | Friperie en ligne curatee (Quebec) | Oui -- basee au Quebec, livraison Canada | Modele B2C (pas C2C), curation professionnelle, bilingue, pas de marketplace multi-vendeurs |
| **TikTok / live selling** | Vente sociale | Oui | Tendance emergente, plateforme Whatnot attire des vendeurs Poshmark, pas de structure marketplace mode |

### 2.3 Synthese concurrentielle

**Le paysage revele un gap significatif :** il n'existe aucune marketplace C2C de mode seconde main nativement francophone, mobile-first, avec une experience Vinted-like (0% ou faible commission vendeur, livraison integree, protection acheteur) ciblant le Quebec.

- **Poshmark** est le leader au Canada mais sa commission de 20% est critique et son interface n'est pas nativement francaise
- **Vinted** a quitte le Canada en 2024 et se concentre sur les US en 2026 -- laissant un vide
- **FB Marketplace** et **Kijiji** sont generiques, sans specialisation mode ni protection acheteur
- **Vestiaire Collective** est francophone mais cible exclusivement le luxe (min 34 CAD)
- **Depop** est anglophone et oriente Gen Z streetwear

---

## 3. Analyse de la demande

### 3.1 Donnees demographiques Gen Z + Millennials au Canada

| Indicateur | Valeur | Source |
|-----------|--------|--------|
| Population Canada 2026 | 40,47 millions | Worldometer |
| % urbain | 80,2% | Worldometer |
| Age median | 40,8 ans | Worldometer |
| Population Quebec | 9,06 millions (2025) | Statistique Quebec |
| Region metro Montreal | 4,38 millions (2025) | MacroTrends |

**Participation a la seconde main par generation :**
- Gen Z : **86%** ont achete seconde main dans l'annee
- Millennials : **83%** ont achete seconde main dans l'annee
- Ensemble des adultes canadiens : **77%**

### 3.2 Comportements d'achat et motivations

**Motivations principales des Canadiens pour le thrifting :**
1. **Economiser de l'argent** : 68% des Canadiens
2. **Reduire les dechets** : motivation secondaire importante
3. **Le frisson de la trouvaille** ("treasure hunt") : motivation emotionnelle
4. **83%** des Canadiens s'accordent a dire que le thrifting fait sens economiquement vu le cout de la vie actuel
5. **66%** des Canadiens voient le thrifting comme partie integrante de la culture d'achat mainstream

**Comportements cles (ThredUp 2026 Resale Report) :**
- 62% de la Gen Z a achete seconde main en 2025
- Evolution du comportement : passage des "hauls" a volume vers la chasse au "holy grail" (pieces specifiques de marques)
- 60% des clients disent que la valeur de revente est un facteur cle lors de l'achat neuf
- 57% des acheteurs revendent desormais des articles pour generer un revenu (2x par rapport a l'annee precedente)

**Fierete de l'achat seconde main :**
- **60%** des Canadiens se disent fiers de montrer leurs achats seconde main
- Le stigma associe a la seconde main a largement disparu, surtout chez les jeunes

### 3.3 Tendances mode circulaire

- **62%** des acheteurs Gen Z preferent acheter aupres de marques durables
- **75%** de la Gen Z disent que la durabilite est plus importante que le nom de marque
- **73%** des millennials sont prets a payer plus pour des marques durables
- **83%** de la Gen Z estime que l'industrie de la mode a la responsabilite de reduire son impact environnemental
- 50% ont reduit leurs achats et 45% ont cesse d'acheter aupres de certaines marques par souci de durabilite

### 3.4 Contexte economique favorable

Le cout de la vie au Canada renforce l'attrait de la seconde main :
- Inflation a 2,8% en avril 2026 (plus haut en 2 ans)
- Prix alimentaires en hausse de 4-6% en 2026 (~1 000 CAD/an supplementaire par famille)
- Les couts de logement restent eleves dans les grandes villes
- L'ecart entre les revenus les plus hauts et les plus bas a atteint un record en 2025
- **91%** des Canadiens ont vendu ou donne des articles dans l'annee ecoulee
- **24%** disent le faire plus souvent qu'avant

### 3.5 Facteur environnemental -- dechets textiles au Canada

- Les Canadiens jettent **pres de 500 millions de kg** de vetements et textiles par an
- En 2021, plus de **1,3 million de tonnes** de vetements usages ont ete eliminees au Canada
- **12 kg** de dechets textiles par personne par an
- Les textiles representent **5 a 10%** du contenu des decharges
- **65%** des dechets textiles pourraient etre reutilises, 21% recycles
- **Initiative 2026** : interdiction d'enfouissement des textiles visant a detourner ~1 million de tonnes, evaluees a 7 milliards CAD, des decharges. Nouvelles obligations de reporting pour les producteurs des septembre 2025

---

## 4. Environnement reglementaire

### 4.1 Taxes sur les ventes C2C au Canada (TPS/TVQ)

**Principe general :**
- Les ventes de biens d'occasion sont taxables a **5% (TPS) + 9,975% (TVQ)** au Quebec
- **Exception critique pour le C2C :** ces biens ne sont **pas taxables** si vendus par une personne qui ne se livre pas a une activite commerciale (ex : vente d'effets personnels entre particuliers)
- L'inscription aux taxes devient obligatoire au-dela de **30 000 CAD de ventes sur 4 trimestres consecutifs**
- Implication pour Second : les vendeurs occasionnels (la majorite des utilisateurs C2C) n'ont pas a percevoir la TPS/TVQ. La plateforme devrait neanmoins informer les vendeurs de leurs obligations en cas de volume important

**Pour la plateforme elle-meme :**
- Si Second percoit des commissions, ces commissions sont des services taxables (TPS/TVQ applicables)
- La frequence de declaration depend du volume de ventes

### 4.2 Loi sur la protection du consommateur -- Quebec

Quebec possede un cadre regulatoire strict et en evolution :

- **Contrats a distance** : tout contrat conclu en ligne doit etre ecrit, contenir le nom et l'adresse du marchand, la date de la transaction. Le consommateur doit avoir l'opportunite explicite d'accepter ou de refuser et de corriger les erreurs
- **Bill 10 (decembre 2025)** : renforce les droits des consommateurs en matiere de restitution, modifie les regles sur les abonnements en ligne et les reventes de billets
- **Penalites augmentees (janvier 2025)** : amendes max de 15 000 CAD (personne physique) ou 30 000 CAD (autres) pour les infractions de type 1

### 4.3 Protection des donnees -- Loi 25

Quebec possede le regime de protection des donnees **le plus strict au Canada**, aligne sur le RGPD europeen :
- Droit a la portabilite des donnees (en vigueur depuis septembre 2024)
- Les demandes de portabilite doivent etre remplies sous 30 jours
- S'applique a toute organisation traitant des donnees de residents du Quebec, **peu importe sa localisation**
- **Penalites** : amendes administratives jusqu'a **10 millions CAD** ou 2% du chiffre d'affaires mondial ; infractions graves jusqu'a **25 millions CAD** ou 4% du CA mondial
- Implication pour Second : la conformite Loi 25 est deja partiellement adressee (export de donnees, suppression de compte fonctionnelles dans le MVP)

### 4.4 Loi 101 et Bill 109 -- Langue francaise

- **Bill 109 (adopte decembre 2025)** : exige des plateformes numeriques qu'elles fournissent une interface en francais par defaut. Principalement cible les plateformes de contenu audiovisuel/audio, mais cree un precedent fort
- Implication pour Second : en etant nativement francophone, Second est **naturellement conforme** et meme avantage par cette legislation

### 4.5 Shipping interprovincial

- Pas de barrieres douanieres interprovinciaux au sens strict, mais des **barrieres reglementaires implicites** qui ajoutent l'equivalent d'un tarif de 6,9% sur les biens et services
- Canada Postes offre des outils de calcul et APIs pour l'integration e-commerce
- Les tarifs varient selon le poids, la taille, la destination (zones par code postal) et la vitesse de service
- Implication pour Second : l'integration ShipEngine presente dans le MVP adresse ce point. Les couts d'expedition restent un frein important pour les ventes interprovinciales de vetements (souvent faible valeur unitaire)

---

## 5. SWOT de Second

### Forces (Strengths)

- **Nativement francophone** : seule marketplace C2C mode seconde main 100% francaise au Canada. Conformite naturelle avec les lois linguistiques du Quebec
- **Mobile-first** : app native React Native/Expo avec UX moderne (photo IA, recherche visuelle, onboarding style)
- **Vinted-like feature set** : chat integre, swap, meetup, expedition, paiement securise -- fonctionnalites absentes de FB Marketplace/Kijiji
- **Timing post-Vinted** : Vinted a quitte le Canada en fevrier 2024, laissant un vide pour une alternative a faible commission
- **Features differenciantes** : analyse IA des photos, recherche visuelle, swap parties, profil de style, moments/stories, systeme d'offres et contre-offres
- **Stack moderne** : Expo Router v4, React 19, Zustand 5, React Query 5 -- rapide a iterer
- **Commission potentiellement inferieure** : opportunite de se positionner sous les 20% de Poshmark
- **Conformite privacy** : Loi 25 deja partiellement adressee (export data, delete account dans le MVP)
- **Localite** : option meetup/remise en main propre, adaptee a la densite urbaine de Montreal

### Faiblesses (Weaknesses)

- **Aucune base utilisateurs** : demarrage a zero (cold start problem) -- le classique chicken-and-egg des marketplaces
- **Marche geographique restreint** : ciblage initial Quebec/Montreal limite le volume
- **Mono-langue** : le francais uniquement exclut les anglophones du Quebec (~13% de la population) et le reste du Canada
- **Equipe presumee petite** : capacite limitee de marketing, operations, support client
- **Dependance Helcim** : processeur de paiement moins connu que Stripe -- confiance utilisateur a construire
- **Pas de marque reconnue** : doit construire la notoriete from scratch face a Poshmark, Depop, FB Marketplace
- **Couts d'expedition** : les vetements ont une faible valeur unitaire, les frais de port peuvent dissuader (probleme commun a tout le secteur)
- **Pas de protection acheteur prouvee** : confiance a etablir sans historique de litiges resolus

### Opportunites (Opportunities)

- **Vide Vinted** : la sortie de Vinted du Canada en 2024 laisse des utilisateurs orphelins cherchant une alternative
- **Mecontentement Poshmark** : les vendeurs se plaignent massivement de la commission 20% et du declin de la plateforme
- **Cout de la vie** : inflation et couts eleves poussent les Canadiens vers la seconde main (83% trouvent le thrifting sensible economiquement)
- **Conscience environnementale** : regulation textile (interdiction enfouissement 2026), pression Gen Z sur la mode durable
- **Culture friperie Montreal** : scene existante forte, universites, communaute creative
- **Bill 109** : legislation forcant les interfaces en francais par defaut favorise les plateformes nativement francophones
- **Expansion Canada anglophone** : une fois la traction quebecoise prouvee, ajout de l'anglais pour le reste du Canada
- **Social commerce** : 39% des jeunes acheteurs font des achats seconde main via social -- integration possible avec stories/moments
- **Communaute universitaire** : Montreal (McGill, UdeM, Concordia, UQAM) = reservoir de early adopters Gen Z
- **IA generative** : la fonctionnalite d'analyse photo IA de Second est differenciante ; 48% des acheteurs utilisent deja des outils IA pour le shopping seconde main

### Menaces (Threats)

- **Retour de Vinted au Canada** : Vinted (valorisation 8 milliards EUR, 1,1 milliard EUR de revenus 2025) a lance aux US en janvier 2026 avec 0% commission vendeur. Un retour au Canada est possible a moyen terme et serait devastateur avec leur tresorerie et leur modele 0% vendeur
- **Poshmark consolide** : sous Naver (proprietaire depuis 2023), Poshmark pourrait baisser ses commissions ou ameliorer l'experience francophone au Canada
- **Facebook Marketplace** : omnipresent, gratuit, et continuellement ameliore par Meta
- **Marche trop petit** : le Quebec francophone seul pourrait ne pas suffire pour atteindre la masse critique d'un marketplace effect
- **Couts d'acquisition utilisateurs** : sans budget marketing significatif, le cold start peut etre fatal
- **Consolidation du secteur** : eBay acquiert Depop (~1,2 milliard USD). Les grands acteurs ont les moyens de penetrer n'importe quel marche
- **Regulation** : evolution rapide des lois (Loi 25, Bill 10, taxes e-commerce) pourrait augmenter les couts de conformite
- **Concurrence gratuite** : FB Marketplace et les groupes Facebook de vente restent gratuits et massivement utilises

---

## 6. Validation product-market fit

### 6.1 Gaps dans l'offre existante

Le marche canadien presente **3 gaps majeurs** que Second est positionne pour adresser :

**Gap 1 : Aucune marketplace C2C mode seconde main nativement francophone**
- Poshmark, Depop, ThredUp : anglais dominant
- Kijiji/FB Marketplace : bilingues mais pas specialises mode
- Vestiaire Collective : francophone mais niche luxe (min 34 CAD)
- Second serait **le premier** dans cette position

**Gap 2 : Vide laisse par Vinted au Canada**
- Vinted a quitte le Canada en fevrier 2024
- Son modele 0% commission vendeur etait tres attractif
- Les utilisateurs canadiens n'ont pas d'equivalent
- Second peut capturer ces utilisateurs avec un modele a faible commission

**Gap 3 : Alternative a la commission elevee de Poshmark (20%)**
- Les vendeurs canadiens se plaignent massivement de la commission 20%
- Certains migrent vers d'autres plateformes (Whatnot, Mercari)
- Second peut se positionner avec une commission 5-10%, capturant les vendeurs mecontents

### 6.2 Risques majeurs et evaluation

| Risque | Probabilite | Impact | Evaluation |
|--------|-------------|--------|------------|
| Vinted revient au Canada avec 0% commission | Moyenne (2-3 ans) | Critique | Vinted se concentre sur US en 2026, mais un retour Canada est probable a terme. Avantage : Second serait deja installe avec une communaute francophone |
| Poshmark domine et bloque la croissance | Elevee | Modere | Poshmark a l'avantage de la base installee, mais sa commission 20% et son interface non-francaise sont des vulnerabilites |
| Marche trop petit pour la viabilite | Moyenne | Eleve | Montreal (4,4M metro) est comparable a des villes ou Vinted a reussi en Europe. Mais le francais seul est restrictif |
| Cold start / chicken-and-egg | Elevee | Critique | Risque existentiel pour toute marketplace. Necessite une strategie d'amorcage agressive |
| FB Marketplace absorbe la demande | Elevee | Modere | FB Marketplace n'est pas specialise et n'offre pas de protection -- coexistence possible |

### 6.3 Mitigations

**Contre le retour de Vinted :**
- Construire la communaute et la marque maintenant, pendant que le terrain est libre
- L'identite francophone/locale est un avantage que Vinted n'a jamais eu au Canada
- Vinted a echoue au Canada a cause de problemes techniques de plateforme, pas de demande -- la demande existe

**Contre la domination Poshmark :**
- Se positionner explicitement comme "le Vinted francais du Quebec" avec commission inferieure
- Cibler les vendeurs mecontents de Poshmark (20% commission)
- L'interface francaise native est un facteur de differenciation clair

**Contre le marche trop petit :**
- Commencer par Montreal (4,4M) qui est un marche suffisant pour atteindre la viabilite
- Expansion au Quebec entier puis Canada anglophone (ajout anglais)
- Les features swap/meetup encouragent l'engagement local et reduisent le besoin de volume massif

**Contre le cold start :**
- Strategie supply-first : recruter 200-500 vendeurs actifs avant le lancement public
- Partenariats avec friperies locales, influenceurs mode Montreal, associations etudiantes
- Organiser des swap parties physiques pour generer du contenu et des inscriptions

---

## 7. Recommandations strategiques

### 7.1 Positionnement

**Proposition de valeur :** "La marketplace mode seconde main creee pour le Quebec -- en francais, avec des commissions justes et une communaute locale."

**Positionnement vs concurrents :**
- vs Poshmark : "Moins cher (commission < 20%), en francais, fait pour ici"
- vs FB Marketplace : "Specialise mode, paiement securise, livraison integree, protection acheteur"
- vs Kijiji : "Experience mode premium, communaute de passionnes, pas de spam"
- vs friperies physiques : "Des milliers de pieces a portee de main, depuis ton sofa"

### 7.2 Pricing -- Modele de commission recommande

| Option | Commission vendeur | Commission acheteur | Avantages | Risques |
|--------|-------------------|---------------------|-----------|---------|
| **Option A (Vinted-like)** | 0% | 5-8% protection acheteur | Maximise l'offre (vendeurs) | Revenus limites cote vendeur |
| **Option B (Balanced)** | 5-8% | 3-5% protection acheteur | Revenus diversifies | Ni l'un ni l'autre n'est "gratuit" |
| **Option C (Promotional)** | 0% pendant 12 mois, puis 8% | 5% protection acheteur | Amorcage rapide | Perte financiere initiale |

**Recommandation :** Option C pour le lancement -- 0% commission vendeur pendant 12 mois pour maximiser l'offre, avec une commission acheteur de 5% (frais de protection) pour generer des revenus minimaux. Communiquer clairement la transition vers 8% apres la periode promotionnelle.

### 7.3 Strategie de lancement -- 4 phases

**Phase 1 : Pre-lancement (0-3 mois)**
- Recruter 300-500 vendeurs "fondateurs" via Instagram, TikTok, groupes Facebook mode Montreal
- Partenariats avec 5-10 influenceurs mode quebecois (micro-influenceurs, 5-50K followers)
- Organiser 2-3 swap parties physiques a Montreal (Plateau, Mile-End) pour creer du buzz
- Landing page avec waitlist + programme "Early Adopter" (badge, avantages permanents)
- Contenu TikTok/Reels : "Pourquoi j'ai quitte Poshmark pour Second"

**Phase 2 : Lancement soft (3-6 mois)**
- Ouverture a Montreal (geolocalisation)
- 0% commission vendeur, 5% protection acheteur
- Focus sur l'option meetup/remise en main propre (evite le frein expedition)
- Push notifications sur les nouveaux articles dans ta zone
- Programme parrainage genereux (10 CAD par filleul actif)

**Phase 3 : Expansion Quebec (6-12 mois)**
- Ouverture Quebec, Sherbrooke, Gatineau, Trois-Rivieres
- Activation expedition (ShipEngine) pour les ventes hors-ville
- Lancement des swap parties virtuelles
- Partenariats friperies locales (cross-promotion)

**Phase 4 : Croissance (12-24 mois)**
- Ajout interface anglaise pour le Canada anglophone
- Introduction commission vendeur 8%
- Fonctionnalites premium (boost listings, analytics vendeur)
- Potentiel extension a d'autres villes : Toronto, Ottawa, Vancouver

### 7.4 North Star Metric

**GMV mensuelle (Gross Merchandise Value)** -- valeur totale des transactions completees par mois.

| Jalon | Cible | Delai |
|-------|-------|-------|
| Product-market fit signal | 500 transactions/mois | 6-9 mois post-lancement |
| Viabilite communaute | 2 000 transactions/mois, 50K GMV CAD | 12-18 mois |
| Break-even | 5 000 transactions/mois, 150K GMV CAD | 18-24 mois |
| Scale-up | 15 000+ transactions/mois, 500K+ GMV CAD | 24-36 mois |

**Metriques secondaires a suivre :**
- Ratio vendeurs actifs / acheteurs actifs (cible : 1:3 minimum)
- Taux de conversion listing --> vente (cible : >10%)
- Temps moyen avant premiere vente (cible : <7 jours)
- NPS (Net Promoter Score) (cible : >50)
- Retention M1/M3/M6 (cible : 40%/25%/15%)
- Taux de meetup vs expedition (indicateur d'engagement local)

### 7.5 Differenciateurs a mettre en avant

1. **"Fait pour ici"** -- interface 100% francaise, fait a Montreal, comprend la culture locale
2. **Commission juste** -- 0% au lancement vs 20% chez Poshmark
3. **IA integree** -- analyse photo IA pour faciliter la mise en vente (feature deja dans le MVP)
4. **Recherche visuelle** -- "trouve des pieces similaires en prenant une photo" (deja dans le MVP)
5. **Swap / echange** -- fonctionnalite unique pas presente chez les concurrents (Poshmark, Depop)
6. **Meetup integre** -- rencontre locale securisee, zero frais de port
7. **Swap parties** -- evenements communautaires physiques + virtuels
8. **Profil de style** -- recommandations personnalisees via IA

---

## 8. Sources

### Marche mondial et projections
- [ThredUp 2026 Resale Report](https://www.thredup.com/resale)
- [ThredUp 2026 -- Secondhand hitting $393B by 2030 (WWD)](https://wwd.com/sustainability/business/thredup-2026-resale-report-secondhand-growth-1238871192/)
- [ThredUp 14th Annual Resale Report (Investor Relations)](https://ir.thredup.com/news-releases/news-release-details/thredups-14th-annual-resale-report-reveals-new-era-structural)
- [Secondhand Apparel Market -- $485B by 2031 (GlobeNewsWire)](https://www.globenewswire.com/news-release/2026/01/23/3224864/28124/en/Secondhand-Apparel-Market-Analysis-Report-2026-A-485-Billion-Market-by-2031-Driven-by-Gen-Z-Rise-of-Digital-Resale-Platforms-Trade-in-Programs-and-Demand-for-Sustainable-and-Afford.html)
- [Secondhand Apparel Market Growth 2026-2030 (Technavio)](https://www.technavio.com/report/secondhand-apparel-market-industry-analysis)
- [US resale market to surpass $78B by 2030 (Yahoo Finance)](https://finance.yahoo.com/economy/articles/us-resale-market-expected-surpass-112500583.html)
- [Recommerce Statistics 2026 (DontPayFull)](https://www.dontpayfull.com/explore/recommerce-statistics)

### Marche canadien
- [Second-hand goods in Canada -- statistics & facts (Statista)](https://www.statista.com/topics/2838/second-hand-goods-in-canada/)
- [Luxury Resale Growth in Canada Signals Consumer Shift (Retail Insider)](https://retail-insider.com/retail-insider/2026/05/luxury-resale-growth-in-canada-signals-consumer-shift/)
- [USA & Canada Secondhand Apparel Market 2025-2035 (Future Market Insights)](https://www.futuremarketinsights.com/reports/usa-and-canada-secondhand-apparel-market)
- [The Thrift Shift: Majority of Canadians plan to shop second-hand (Retail Insider)](https://retail-insider.com/retail-insider/2026/04/the-thrift-shift-majority-of-canadians-plan-to-shop-second-hand-this-year/)
- [Canadians Embrace Pre-Owned Shopping as Mainstream Trend (Retail Insider)](https://retail-insider.com/retail-insider/2025/08/canadians-embrace-pre-owned-shopping-as-mainstream-trend/)
- [The Thrift Shift (BNN Bloomberg)](https://www.bnnbloomberg.ca/press-releases/2026/04/09/the-thrift-shift-majority-of-canadians-plan-to-shop-second-hand-this-year/)
- [Kijiji Second-Hand Economy Index (eBay Inc.)](https://www.ebayinc.com/stories/news/kijiji-launches-inaugural-second-hand-economy-index-in-canada/)
- [Canada's 2nd-hand goods market -- $29B (CBC News)](https://www.cbc.ca/news/business/second-hand-economy-kijiji-report-1.4024202)
- [Canada second-hand economy $30B (Newswire)](https://www.newswire.ca/news-releases/second-hand-economy-in-canada-worth-30-billion-annually-report-finds-516933941.html)
- [Second-hand market booming in Canada (CTV News)](https://www.ctvnews.ca/northern-ontario/article/second-hand-market-booming-in-canada-survey-finds/)

### Quebec et Montreal
- [La rue Saint-Denis -- destination mode seconde main a Montreal (Silo 57)](https://www.silo57.ca/2025/07/21/la-rue-saint-denis-une-nouvelle-destination-mode-seconde-main-a-montreal)
- [Mode eco a Montreal : friperies et seconde main](https://www.unefrenchieamontreal.com/friperies-seconde-main-montreal/)
- [25 friperies a connaitre au Quebec (Clin d'oeil)](https://www.clindoeil.ca/boutiques-vintage-et-friperies-chics-nos-bonnes)
- [7 friperies quebecoises en ligne (Clothes & Roads)](https://clothesandroads.com/blogs/news/7-friperies-quebecoises-en-ligne-a-decouvrir)
- [Montreal Metro Area Population (MacroTrends)](https://www.macrotrends.net/global-metrics/cities/20384/montreal/population)
- [Population projections Quebec (Statistique Quebec)](https://statistique.quebec.ca/en/document/population-projections-quebec)
- [Canada Population 2026 (Worldometer)](https://www.worldometers.info/world-population/canada-population/)

### Concurrents
- [Poshmark Statistics 2026 (Expanded Ramblings)](https://expandedramblings.com/index.php/poshmark-facts-statistics/)
- [Poshmark Canada FAQ (Blog Poshmark)](https://blog.poshmark.com/poshmark-canada-faq/)
- [Poshmark Fee Policy Canada](https://poshmark.ca/fee_policy)
- [Poshmark Reviews -- Seller Complaints (PissedConsumer)](https://poshmark-canada.pissedconsumer.com/review.html)
- [Poshmark reverses fee structure after backlash (Modern Retail)](https://www.modernretail.co/operations/poshmark-reverses-new-fee-structure-after-seller-backlash/)
- [Depop Gen Z Report](https://depopxbainreport.depop.com/)
- [Depop Selling Fees 2026 (CLOSO)](https://closo.co/blogs/fees/the-real-cost-of-business-breaking-down-depop-selling-fees-in-2025)
- [Vinted Canada exit (RetailBoss)](https://retailboss.co/why-did-vinted-close-in-canada/)
- [Vinted Canadian market exit (LRT)](https://www.lrt.lt/en/news-in-english/19/2155435/lithuania-s-vinted-announces-canadian-market-exit)
- [Vinted US launch and expansion 2026 (FashionUnited)](https://fashionunited.com/news/business/vinted-announces-major-us-expansion-to-address-growing-demand/2026012270176)
- [Vinted Revenue and Statistics 2026 (Business of Apps)](https://www.businessofapps.com/data/vinted-statistics/)
- [Vinted 38% revenue jump 2025](https://www.globalbankingandfinance.com/second-hand-fashion-platform-vinted-reports-38-jump-revenue/)
- [Vestiaire Collective Fees 2026 (Underpriced)](https://www.underpriced.app/blog/vestiaire-collective-fees-2026)
- [ThredUp -- What countries do we ship to?](https://help.thredup.com/en_us/what-countries-do-we-ship-to-rJSmMXJih)
- [Kijiji Business Model (Finty)](https://finty.com/us/business-models/kijiji/)
- [Value Village opens two more Canadian stores (Retail Insider)](https://retail-insider.com/retail-insider/2025/09/value-village-opens-two-more-canadian-stores/)
- [La Penderie du Paradis -- friperie en ligne](https://lapenderieduparadis.com/en)
- [Bunz Trading Zone (Wikipedia)](https://en.wikipedia.org/wiki/Bunz_Trading_Zone)

### Gen Z et mode durable
- [Gen Z Sustainable Fashion -- CBC News](https://www.cbc.ca/news/entertainment/generation-z-sustainable-fashion-environment-1.7205071)
- [Sustainable Fashion Statistics 2026 (TheRoundup)](https://theroundup.org/sustainable-fashion-statistics/)
- [Gen Z reshaping fashion retail (Retailist Mag)](https://retailistmag.com/how-gen-zs-pursuit-of-sustainability-is-reshaping-fashion-retail/)
- [Sustainability impacting Gen Z purchase decisions (Strategy)](https://strategyonline.ca/2023/08/24/how-sustainability-is-impacting-gen-zs-purchase-decisions/)
- [39% younger shoppers buy secondhand via social commerce (Ultimate Thrifting)](https://ultimatethrifting.com/secondhand-fashion-market-trends-2025/)

### Dechets textiles et economie circulaire
- [Textiles Tuesday -- Circular Economy Month](https://circulareconomymonth.ca/textiles-tuesday/)
- [Canada Textile EPR Landfill Dumping Ban 2026 (The Green Blueprint)](https://thegreenblueprints.com/canada-textile-epr-landfill-dumping-ban/)
- [Opportunities for circularity in apparel textiles -- Canada.ca](https://www.canada.ca/en/services/environment/conservation/sustainability/circular-economy/workshop-report-opportunities-circularity-apparel-textiles.html)
- [Textile Waste -- Problems & Sustainable Solutions (Waste Solutions)](https://waste.solutions/blog/textile-waste-in-canada/)
- [Canada funds circular textiles initiative (ESE Magazine)](https://esemag.com/solid-waste/canada-funds-circular-textiles-initiative-to-combat-plastic-waste/)

### Reglementation
- [TPS/TVH et TVQ (Revenu Quebec)](https://www.revenuquebec.ca/fr/entreprises/taxes/tpstvh-et-tvq/)
- [Biens d'occasion (Revenu Quebec)](https://www.revenuquebec.ca/fr/entreprises/taxes/tpstvh-et-tvq/situations-particulieres-liees-a-la-tpstvh-et-a-la-tvq/biens-doccasion/)
- [Quebec consumer protection rules (Torys LLP)](https://www.torys.com/our-latest-thinking/staying-current/2025/01/quebecs-new-consumer-protection-rules)
- [Doing E-Commerce In Canada (Fasken)](https://www.fasken.com/en/knowledge/2025/05/doing-ecommerce-in-canada-heres-what-you-need-to-know)
- [Consumer Protection Act Quebec](https://legisquebec.gouv.qc.ca/en/showdoc/cs/P-40.1)
- [Quebec Loi 25 privacy compliance guide (Alation)](https://www.alation.com/blog/quebec-law-25-compliance-guide/)
- [Quebec Law 25 -- What you need to know (Outside GC)](https://outsidegc.com/blog/quebecs-privacy-law-25-what-you-need-to-know/)
- [Bill 109 -- French language content (Fasken)](https://www.fasken.com/en/knowledge/2026/01/bill-109)
- [Bill 109 -- French language digital platforms (DLA Piper)](https://knowledge.dlapiper.com/dlapiperknowledge/globalemploymentlatestdevelopments/2025/Quebec-proposes-French-language-legislation-targeting-digital-platforms-and-their-content)

### Economie canadienne et cout de la vie
- [Canada inflation CPI (Statistics Canada)](https://www150.statcan.gc.ca/n1/daily-quotidien/260119/dq260119b-eng.htm)
- [Canada 2026 Rising Living Costs (AiF)](https://aifinancial.ca/aif-insight-canada-2026-cost-of-living-financial-planning-0105/)
- [Cost of living Canada 2026 (Spergel)](https://www.spergel.ca/learning-centre/average-cost-of-living-in-canada/)
- [Canadians cost-of-living crisis (Policy Options)](https://policyoptions.irpp.org/2026/02/cost-anxiety/)

### Paiement et shipping
- [Helcim Pricing](https://www.helcim.com/pricing/)
- [Helcim Fee Saver Canada](https://legal.helcim.com/ca/payment-methods-products/fee-saver/)
- [Canada Post -- Find a Rate](https://www.canadapost-postescanada.ca/cpc/en/tools/find-a-rate.page)
- [Interprovincial Trade Barriers (Provincial Trade Report)](https://provincialtradereport.ca/2025/06/30/interprovincial-trade-barriers-cost-canada/)

---

## Verdict final

**Le marche est valide, mais l'execution est tout.** Le timing est favorable : Vinted absent, Poshmark impopulaire chez les vendeurs, aucun concurrent nativement francophone, demande forte et croissante. Le risque principal est le cold start et la taille limitee du marche initial francophone. La recommandation est un lancement agressif a Montreal avec 0% commission vendeur, une strategie communautaire forte (swap parties physiques, influenceurs locaux, campus universitaires), et un plan clair d'expansion vers le Canada anglophone sous 18 mois.

Le product-market fit hypothetique est prometteur, mais ne sera confirme qu'apres avoir atteint les 500 transactions/mois et observe la retention M3. Le MVP de Second possede les features necessaires (chat, swap, meetup, IA, recherche visuelle, expedition) -- le defi est 100% go-to-market.
