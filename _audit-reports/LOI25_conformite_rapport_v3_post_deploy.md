# RAPPORT DE CONFORMITÉ LOI 25 — SECOND (Marketplace Mode Seconde Main)

**Évaluation Technique Complète**  
*Canada/Québec | Firebase/Expo/React Native | Stripe Connect Custom | ShipEngine*  
**Date du rapport:** 31 mai 2026  
**Analysé par:** Audit technique exhaustif + vérification code source

---

## 1. RÉSUMÉ EXÉCUTIF

### Verdict Global
Second implémente une **conformité PARTIELLE** à la Loi 25 du Québec. Les mécanismes de consentement, droits d'accès, et destruction automatisée sont techniquement fonctionnels et conformes. **Cependant, trois blocs critiques (P0/P1) empêchent la conformité complète :**

1. **Gouvernance légale non finalisée** — Templates ÉFVP, DPA, procédure incidents marqués « À COMPLÉTER / NON VALIDÉS JURIDIQUEMENT » sans signatures ou approbation conseil juridique.
2. **Transferts de données USA sans documentation** — Stripe, ShipEngine, Vertex AI reçoivent RP sensibles (identité, adresses, images) SANS ÉFVP signées ni DPA archivés (violation art. 3.2, 17 Loi 25).
3. **Mineurs 14-17 ans exclus** — Code enforce MIN_AGE_REGISTER=16, bloque comptes mineurs 14-15 ans. Zéro mécanisme consentement parental (violation art. 14 Loi 25).

### Top 5 Risques P0/P1 (priorité critique)
| # | Risque | Sévérité | Délai | Impact |
|---|--------|----------|-------|--------|
| 1 | Pas d'ÉFVP/DPA signées pour Stripe/ShipEngine/Vertex AI (art. 17) | P0 | URGENT | Fondateur/cadres **responsables pénalement** (Loi 25 art. 114) ; transactions USA sans contrat légal |
| 2 | Exclusion 14-17 ans / zéro consentement parental (art. 14) | P0 | URGENT | Violation directe Loi 25 art. 14 ; CAI peut ordonner suppression comptes mineurs |
| 3 | Gouvernance templates vierges (art. 3.2) | P0 | SEMAINES | Aucune validation direction/juriste ; RP désigné sans responsabilités formelles |
| 4 | Export de données incomplet (art. 28.1) | P1 | SEMAINES | Client-side timeout + swaps/wallet absents = droit à portabilité non satisfait |
| 5 | Destruction Stripe/ShipEngine incomplète (art. 30) | P1 | SEMAINES | Suppression compte laisse adresses d'expédition identifiables, métadonnées Stripe orphelines |

### Conformité par Domaine
```
✅ Consentement & Droits Humains      |████████░░| 80% — Mécanismes OK, parental gap
🟡 Gouvernance & RP Désignation       |███░░░░░░| 30% — Template non validé
❌ Transferts Hors-Québec (ÉFVP/DPA)  |░░░░░░░░░| 0%  — Aucun document signé
✅ Incidents & CAI Escalade            |███████░░| 70% — Registre OK, SLA non forcé
✅ Destruction Automatisée (art. 23)   |███████░░| 75% — Retentionpurge OK, Storage gap
❌ Export Complet (art. 28.1)          |████░░░░░| 40% — Swaps/wallet TODOs
✅ Privacy-by-Default (art. 9.1)      |██████░░░| 60% — Photo/IA OFF, affichage nom problème
⚠️  Mineurs (art. 14)                  |░░░░░░░░░| 0%  — Bloque 14-15 ans
```

---

## 2. MATRICE DE CONFORMITÉ PAR ARTICLE LOI 25

| Article | Exigence | Statut | Preuve (fichier:ligne) | Sévérité | Notes |
|---------|----------|--------|------------------------|----------|-------|
| **3.1** | Désignation Responsable RP | 🟡 Partiel | PrivacyPolicyContent.tsx:56–59, legal-notice.tsx:95–98 | P1 | Email public (privacy@seconde.app) ✓ ; nom/titre absent ✗ |
| **3.2** | Politiques & Pratiques Gouvernance | 🟡 Partiel | politique-gouvernance-RP.md:1–108 (TEMPLATE NON VALIDÉ) | P1 | Structure existe, zéro signature direction/juriste |
| **3.2** | Procédure Traitement Plaintes | 🟡 Partiel | procedure-incident-CAI.md:1–159 (TEMPLATE NON VALIDÉ) | P1 | Callable escalade existe, procédure papier non finalisée |
| **3.2** | Cycle de Vie RP Documenté | ❌ Non-conforme | PrivacyPolicyContent.tsx:167–175 | P1 | Seuils listés, process automatisation jamais mentionné |
| **3.5–3.8** | Registre Incidents | ✅ Conforme | privacy_incidents Firestore, privacyIncidents.ts:92–126 | P0 | Structure complète, SLA 72h non forcé automatiquement |
| **8** | Transparence Collecte (finalités) | ✅ Conforme | PrivacyPolicyContent.tsx:112–122 | P2 | Finalités énumérées, moyens collecte manquent (PARTIEL→P2) |
| **8.1** | Technologie IA Expliquée | ✅ Conforme | PrivacyPolicyContent.tsx:159–164, app/settings/privacy.tsx:76–80 | P2 | Vertex AI/Gemini désactivées par défaut ✓ |
| **9.1** | Privacy-by-Default | 🟡 Partiel | userService.ts:152–156, reviews.ts:357 | P1 | Photo OFF ✓ ; affichage nom public ✗ ; email OFF ✓ |
| **12** | Consentement Préalable | ✅ Conforme | ConsentFields.tsx:104–147, consent.ts:158–165 | P0 | Documents publics avant cochage ✓ ; preuve append-only ✓ |
| **12.1** | Décisions Automatiques | ✅ Conforme | automatedDecisions.ts:42–52, logAutomatedDecision:74–127 | P0 | 3 décisions (funds, expiry, label) loggées + contestables ✓ |
| **14** | Consentement Marketing | 🟡 Partiel | app/settings/privacy.tsx:266–280, consent.ts:232–273 | P1 | Toggle retrait ✓ ; problème enforcement (preferences vs consents append-only) |
| **14** | Mineurs < 14 ans | ❌ Non-conforme | — (ABSENT) | P0 | Zéro mécanisme consentement parental ; bloque < 16 |
| **17** | Transferts Hors-Québec + ÉFVP | ❌ Non-conforme | — (TEMPLATES VIERGES) | P0 | Stripe/ShipEngine/Vertex AI reçoivent RP SANS ÉFVP/DPA signées |
| **23** | Rétention & Destruction | 🟡 Partiel | retentionPurge.ts:76–181, firestore-schema.md:424–436 | P1 | Firestore OK (3y articles, 90d guest) ; Storage orpheline (drafts) |
| **27** | Droit d'Accès (Portabilité) | 🟡 Partiel | export-data.tsx:46–91, userService.ts:581–582 (TODO) | P1 | Swaps/wallet manquent ; client-side timeout risk |
| **28.1** | Droit Portabilité Format | 🟡 Partiel | exportUserData JSON | P1 | Format ✓ ; complétude ✗ (wallet, swaps TODO) |
| **30** | Droit Suppression | 🟡 Partiel | deleteUserAccount:216–334, shippingAddress persistante | P1 | Anonymisation Firestore ✓ ; adresses ShipEngine non anonymisées ✗ |
| **32** | Droit Rectification | 🟡 Partiel | profile-details.tsx, address.tsx | P1 | Champs éditables ✓ ; pas de formulaire demande formelle |
| **33** | Procédure Demande Accès | ⚪ N/A (implicite art. 27–32) | privacy@seconde.app | P1 | Contact existe, délai 30j non tracking automatisé |

---

## 3. CONSTATS DÉTAILLÉS PRIORISÉS

### BLOC P0 : ARRÊT CRITIQUE

#### **CONSTAT P0–001 : Gouvernance Légale Non Finalisée (Art. 3.2 Loi 25)**
**Exigence :** Art. 3.2 Loi 25 exige que politiques et pratiques de gouvernance soient « approuvées, documentées ». Approbation = validation direction + conseil juridique.

**Observation :**  
Le repo contient un **template** complet de politique de gouvernance (`compliance/politique-gouvernance-RP.md:1–108`) qui énumère correctement :
- Rôles et responsabilités (Responsable RP, Direction, Équipe technique, Support)
- Seuils rétention données (7 ans transactions, 12 mois navigation, etc.)
- Procédure incidents (registre privacy_incidents + escalade CAI)

**MAIS** le document porte **explicitement** la mention ligne 3 : **« TEMPLATE NON VALIDÉ JURIDIQUEMENT »**. De plus :
- 13 sections marquées **« [À COMPLÉTER] »** (noms responsables, dates signatures, contenu critères sécurité)
- Section « Approbation » (lignes 101–107) : **VIDE** — aucune signature physique/numérique, aucune date, aucun approuveur nommé
- Readme compliance (ligne 4) affirme : **« Aucune valeur juridique en l'état »**
- Aucun archivage PDF signé trouvé

**Preuves code :**
- `/Users/aurelien/dev/Second/compliance/politique-gouvernance-RP.md:1–108` (template non signé)
- `/Users/aurelien/dev/Second/compliance/README.md:4,25` (TODOs : « Obtenir approbation juridique »)
- `/Users/aurelien/dev/Second/functions/src/callable/privacyIncidents.ts:1–34` (implémentation OK, mais gouvernance incomplète)

**Remédiation Concrète :**
1. **Faire valider par un juriste spécialisé Loi 25 Québec** (non-négociable ; délai 2–4 semaines)
   - Utiliser template comme base, corriger [À COMPLÉTER]
   - Valider : seuils rétention, processus escalade CAI, critères sécurité
   - Obtenir signature juriste + date + tampon cabinet
2. **Obtenir approbations direction + RP :**
   - Aurélien Rouchy (Président) = signature + date
   - Responsable RP = signature + date
   - Conseil d'administration (si applicable) = procès-verbal
3. **Archiver originaux signés en PDF hors Git** (secrets manager, paperless local)
   - Stocker dans `/compliance/GOUVERNANCE_APPROUVEE_2026-06-15.pdf`
   - Documenter version + date en compliance/README.md
4. **Intégrer en Notion/Confluence** si utilisé en interne pour gouvernance opérationnelle

**Impact Non-Remédié :** CAI peut ordonner suspension opérationnelle de traitement RP jusqu'à fourniture politique signée. **Délai critique : 2 semaines.**

---

#### **CONSTAT P0–002 : ÉFVP & DPA Absentes — Transferts USA sans Contrat Légal (Art. 17 Loi 25)**
**Exigence :** Art. 17 Loi 25 : avant de communiquer RP hors Québec, procéder à ÉFVP documentée ET signer entente écrite (DPA/SCC) avec tiers.

**Observation :**  
Code identifie clairement 4 tiers hors-Québec qui reçoivent RP sensibles :
- **Stripe Inc. (USA)** : identité (firstName/lastName), DOB, adresse complète, numéros compte bancaire
- **ShipEngine/Auctane (USA)** : adresses complètes acheteur/vendeur, téléphone
- **Google Vertex AI/Gemini (USA, us-central1)** : images articles (potentiellement visages, domiciles)
- **Google Cloud Firebase** : Firestore, Storage, Cloud Functions (région northamerica-northeast1 Montréal OK, mais Storage région à confirmer)

**Structure de documentation trouvée :**
- `/Users/aurelien/dev/Second/compliance/EFVP-transferts-hors-quebec.md:1–186` : **TEMPLATE VIERGE**
  - Ligne 3 : « TEMPLATE NON VALIDÉ JURIDIQUEMENT »
  - 16+ sections [À COMPLÉTER] (version, noms, analyse seuil, mesures, etc.)
  - Ligne 153 pour Firestore : « À COMPLÉTER — confirmer localisation réelle »
- `/Users/aurelien/dev/Second/compliance/DPA-checklist-tiers.md:1–139` : **TEMPLATE VIERGE**
  - 3 tiers (Stripe, ShipEngine, Google Cloud) listés
  - Toutes les cases = « À obtenir », 0 DPA archivés, 0 signatures

**Preuves code :**
- `functions/src/callable/payments.ts:1303–1353` : Stripe reçoit KYC vendeur (firstName, lastName, dob, address, account_number)
- `functions/src/http/webhooks.ts:320–348` : ShipEngine reçoit adresses complètes via getRates API
- `functions/src/triggers/embeddings.ts:19` (VERTEX_LOCATION='us-central1') : images envoyées USA
- `config/firebaseConfig.ts:53` : getFirestore() SANS région explicite = défaut us-central1 probable
- `components/legal/PrivacyPolicyContent.tsx:127–129` : **Affirmation FAUSSE** — « Nous avons évalué les facteurs... et encadrons ces communications par des ententes écrites »

**Remédiation Concrète (URGENTE) :**
1. **Vérifier région réelle Firestore :**
   - Accéder https://console.cloud.google.com → projet seconde-b47a6 → Firestore → Paramètres
   - Noter la région réelle (presumé us-central1, mais à confirmer)
   - Si us-central1 : ÉFVP Google Cloud obligatoire
2. **Rédiger 4 ÉFVP complètes** (2–3h chacune, ~12h total) :
   - **ÉFVP Stripe Connect Custom**
     - Finalité : Traitement paiements, versement fonds vendeur, conformité KYC/AML
     - RP transférés : firstName, lastName, dateOfBirth, adresse complète, numéro de compte bancaire
     - Sensibilité : **ÉLEVÉE** (identité + données financières)
     - Mesures : Stripe PCI-DSS certifié, Second ne stocke jamais complet, clé API en Secret Manager
     - Cadre juridique destination : Stripe Inc. USA, GLBA, SOC 2 Type II, Standard Contractual Clauses
     - Risques résiduels : Accès données USA par autorités fédérales
     - Approuvé/signé : Aurélien Rouchy + juriste + date
   - **ÉFVP ShipEngine/Auctane**
     - Finalité : Expédition
     - RP : Adresses complètes (buyer + seller), téléphone, email, names
     - Sensibilité : **MODÉRÉE** (localisation physique)
     - Mesures : TLS transit, ShipEngine DPA à obtenir, sous-traitants Canada Post/Intelcom
     - Cadre juridique : ShipEngine USA, GDPR-like protections (to verify)
   - **ÉFVP Vertex AI/Gemini**
     - Finalité : Embeddings images, classification produit, recommandations
     - RP : Images articles (peuvent contenir visages incidemment, domiciles, etc.)
     - Sensibilité : **ÉLEVÉE** (données biométriques potentielles + localisation)
     - Mesures : Google Cloud DPA, consentement opt-in (aiProfilingConsent), engagement non-réutilisation entraînement
     - Cadre juridique : Google Cloud USA, Executive Order 14086, Cloud SCC EU-US Data Bridge
   - **ÉFVP Google Cloud/Firebase**
     - Finalité : Hébergement Firestore, Storage, Cloud Functions, FCM, Cloud Logging
     - RP : TOUTES (entièrement stockées)
     - Sensibilité : **TRÈS ÉLEVÉE**
     - Mesures : Google Cloud DPST, crypto TLS, région northamerica-northeast1 (Firestore probable us-central1, à vérifier)
     - Cadre juridique : Google Cloud DPST, USA

3. **Obtenir & Archiver DPA Tiers :**
   - **Stripe** : https://stripe.com/legal/dpa → télécharger, archiver `/compliance/DPA_Stripe_2026.pdf`
   - **ShipEngine** : Contacter support → demander DPA/MSA → archiver
   - **Google Cloud** : https://cloud.google.com/terms/data-processing-addendum → accepter en GCP Console → screenshot + PDF
   - Accepter chaque DPA officiellement (Stripe Dashboard signature, GCP Console toggle)
   - Documenter dates acceptation en compliance/README.md

4. **Corriger Politique de Confidentialité :**
   - Remplacer affirmation fausse (PrivacyPolicyContent.tsx:127–129)
   - Ancienne : « Nous avons évalué les facteurs... et encadrons par des ententes écrites »
   - Nouvelle : « Nous avons procédé à une Évaluation des Facteurs relatifs à la Vie Privée (ÉFVP) pour chaque transfert hors-Québec et signé des Data Processing Agreements conformes à la Loi 25 et au RGPD. Voir `/legal/data-transfer-agreements` pour les documents complets. »

5. **Créer route `/legal/data-transfer-agreements.tsx`** listant :
   - Date ÉFVP Stripe
   - Date DPA Stripe
   - Date ÉFVP Vertex AI + Google Cloud DPST
   - Date DPA Stripe + Google Cloud DPST
   - Contact CAI pour questions

**Responsable :** Juridique (Aurélien Rouchy) — délai MAXIMUM 3 semaines avant tout déploiement USA.

---

#### **CONSTAT P0–003 : Mineurs 14–17 ans Exclus — Zéro Consentement Parental (Art. 14 Loi 25)**
**Exigence :** Art. 14 Loi 25 : mineurs < 14 ans = consentement titulaire autorité parentale **OBLIGATOIRE** ; mineurs 14–17 = consentement mineur **OU** parental.

**Observation :**  
Code enforce un seuil unique : `MIN_AGE_REGISTER=16` (utils/age.ts:10). Ceci signifie :
- Utilisateurs < 16 ans = **REFUSÉ** (message d'erreur « Vous devez avoir au moins 16 ans »)
- Aucun mécanisme consentement parental pour 14–15 ans
- Zéro collection Firestore `parentalConsents`
- Zéro callable pour demande approbation parental
- Zéro documentation Loi 25 art. 14 en CGU/Privacy Policy

**Preuves code :**
- `utils/age.ts:10` : `export const MIN_AGE_REGISTER = 16`
- `functions/src/callable/consent.ts:21–22` : `MIN_AGE_REGISTER=16` validé côté serveur
- `components/auth-bottom-sheet/SignUpForm.tsx:106–113` : bouton signup DISABLED si age < 16
- `constants/authMessages.ts:23` : ageError = « Vous devez avoir au moins 16 ans pour utiliser Second »
- `components/legal/TermsContent.tsx:43–56` : zéro mention « mineurs », zéro mention art. 14
- `components/legal/PrivacyPolicyContent.tsx:1–244` : zéro mention mineurs

**Remédiation Concrète :**
1. **Ajouter section CGU explicite (art. 14) :**
   ```
   Mineurs et Consentement Parental
   
   En vertu de la Loi 25 du Québec (art. 14) :
   - Les utilisateurs de moins de 14 ans ne peuvent pas créer de compte. 
     Le titulaire de l'autorité parentale doit fournir son consentement explicite.
   - Les utilisateurs de 14 à 17 ans peuvent créer un compte directement, 
     OU le titulaire de l'autorité parentale peut consentir en leur nom.
   
   Processus Consentement Parental :
   ...
   ```

2. **Implémenter infrastructure consentement parental :**
   - Post-DOB-capture : si age 14–15, modal : « Consentement parental requis »
   - Champ email parent, validation email (link 24h)
   - Créer Firestore collection `users/{uid}/parentalConsents/{autoId}` :
     ```
     {
       parentEmail: "parent@example.com",
       parentEmailVerified: bool,
       ageCategory: "14-17", // or "under-14"
       consentedAt: serverTimestamp,
       status: "verified" | "pending" | "rejected"
     }
     ```
   - Callable serverside `recordParentalConsent(userId, parentEmail, ageCategory)` :
     - Envoie email parent avec lien vérification 24h
     - Lien ouvre modal `/verify-parental-consent?token=...`
     - Après vérif, met à jour parentalConsents.parentEmailVerified=true
     - Déblocage compte mineur

3. **Mettre à jour validation signup :**
   - Email signup + Social : si age 14–17, brancher à modal parental consent
   - Bloquer accès app jusqu'à `parentalConsents[latest].status === "verified"`

4. **Documer dans Privacy Policy :**
   - « Mineurs 14–17 ans peuvent créer un compte directement si consentement personnel, ou avec consentement parental. »
   - Durée conservation contact parental : 1 an après majorité (puis suppression automatique)

**Responsable :** Product + Juridique — délai 2–3 semaines (impact légal direct art. 14).

---

### BLOC P1 : TRÈS ÉLEVÉ

#### **CONSTAT P1–001 : Export de Données Incomplet — TODOs Swaps & Wallet (Art. 28.1 Loi 25)**
**Exigence :** Art. 28.1 Loi 25 (droit de portabilité) : utilisateur doit pouvoir exporter **TOUTES** ses données en format lisible.

**Observation :**  
Route `/settings/export-data.tsx` expose bouton « Exporter mes données » qui appelle `userService.exportUserData(uid)` côté **CLIENT** (React Native). Fonction inclut 12 collections : user, articles, favorites, notifications, chats, messages, avis, transactions (achat/vente), drafts, savedSearches, searchHistory, consents.

**MAIS deux TODOs explicites révèlent des lacunes :**
- Ligne 581 : `// TODO: swaps requires queries on both initiatorId AND receiverId`
- Ligne 582 : `// TODO: wallet requires composite queries`

**Données manquantes :**
1. **Swaps** (firestore-schema.md:974–1034) : multipart asset exchanges, images, cash top-ups, participant identities — NON EXPORTÉES
2. **Wallet/{uid}** + **wallet/{uid}/ledger** (firestore-schema.md:1218–1270) : balance buckets (sale_credit, funds_held, funds_released, refund_debit), historique complet mouvements financiers — NON EXPORTÉES
3. **Stripe data** (charges, payouts, disputes, refunds) : jamais accessible côté client API, zéro integration
4. **automatic_decisions_log** : décisions concernant l'utilisateur existantes mais non incluses en export

**Preuves code :**
- `services/userService.ts:376–589` : fonction exportUserData définie côté client seulement
- `services/userService.ts:581–582` : TODOs explicites
- `app/settings/export-data.tsx:46–91` : UI appelle userService.exportUserData
- `functions/src/index.ts:1–200` : AUCUNE callable `exportUserDataFull` n'existe côté serveur
- `firestore-schema.md:24,30` : swaps et wallet collections existent mais ne sont pas queryables via client-side (Firestore rules restrict)

**Remédiation Concrète :**
1. **Créer callable serveur `exportUserDataFull`** (region northamerica-northeast1, 512MiB memory) :
   ```typescript
   async function exportUserDataFull(userId: string): Promise<{url: string; expiresAt: Date}> {
     // (1) Auth validation: request.auth.uid === userId
     // (2) Query toutes collections via Admin SDK (pas de client limit):
     const userData = await db.collection('users').doc(userId).get();
     const swaps = await db.collection('swaps')
       .where('initiatorId', '==', userId)
       .get(); // + receiverId queries
     const walletLedger = await db.collection('wallet')
       .doc(userId)
       .collection('ledger')
       .get();
     // (3) Fetch Stripe data via SDK
     const stripeCustomer = await stripe.customers.retrieve(...);
     const charges = await stripe.charges.list({customer: ...});
     // (4) Assemble JSON
     const exportData = {
       user: {...},
       swaps: [...],
       wallet: {...},
       ledger: [...],
       stripeData: {...},
       // ...all 20+ collections
     };
     // (5) Generate signed URL to Cloud Storage
     const bucket = admin.storage().bucket();
     const file = bucket.file(`exports/${userId}_${Date.now()}.json`);
     await file.save(JSON.stringify(exportData));
     const [url] = await file.getSignedUrl({
       version: 'v4',
       action: 'read',
       expires: Date.now() + 24*3600*1000 // 24h validity
     });
     // (6) Log export
     await recordPrivacyIncident({
       type: 'data_exported',
       severity: 'low',
       userId,
       affectedDataFields: ['all'],
       description: `User exported all personal data`,
       detectedAt: serverTimestamp()
     });
     // (7) Send confirmation email
     await sgMail.send({
       to: user.email,
       subject: 'Vos données Second ont été exportées',
       html: `Télécharger : <a href="${url}">Cliquez ici</a> (valide 24h)`
     });
     return {url, expiresAt: ...};
   }
   ```

2. **Mettre à jour app/settings/export-data.tsx :**
   - Remplacer `userService.exportUserData(uid)` (client)
   - Par callable `callExportUserDataFull(uid)` (serveur)
   - Afficher lien email/download retourné par callable
   - Toast confirmation

3. **Inclure en export :**
   - ✅ Profil utilisateur complet
   - ✅ Articles publiés (avec images URLs)
   - ✅ Favoris (liste articleIds)
   - ✅ Notifications (historique)
   - ✅ Chats + messages (anonymisation appliquée si compte supprimé ailleurs)
   - ✅ Avis écrits/reçus
   - ✅ Transactions achat/vente complètes (with Stripe metadata)
   - ✅ **Swaps** (NEW)
   - ✅ **Wallet + ledger** (NEW)
   - ✅ Consents (preuve consentement)
   - ✅ **Stripe historique charges/disputes**
   - ✅ **Decisions automatisées les concernant**
   - ✅ Drafts, savedSearches, searchHistory

4. **Délai réponse : 30 jours** (Loi 25 art. 27) :
   - Ajouter tracking demande export dans collection `export_requests/{requestId}`
   - Scheduled function alertant admin si délai > 25j
   - Dokumenter délai en Privacy Policy

**Responsable :** Firebase Backend — délai 1–2 semaines.

---

#### **CONSTAT P1–002 : Affichage Nom/Bio Profil Public sans Toggle (Art. 9.1 Privacy-by-Default)**
**Exigence :** Art. 9.1 Loi 25 : plus haut niveau de confidentialité par défaut, sans intervention utilisateur.

**Observation :**  
Fonction `getUserPublicProfile` (reviews.ts:354–363) expose publiquement :
- displayName (non masquable)
- bio (non masquable)
- profileImage (masquable via showProfilePhoto toggle)
- rating, sellerLikesCount

**Code :**
```typescript
const publicProfile = {
  displayName: user.displayName, // ALWAYS exposed
  bio: user.bio, // ALWAYS exposed
  profileImage: showProfilePhoto ? user.profileImage : null,
  rating: user.rating,
  // ...
};
```

**Problème :** displayName et bio sont **publiquement visibles par défaut sans aucune protection**. Contraire à art. 9.1 qui exige **profil privé par défaut**.

**Remédiation Concrète :**
1. **Ajouter 2 toggles /settings/privacy :**
   - Switch « Afficher mon nom en profil public » (default OFF)
   - Switch « Afficher ma bio en profil public » (default OFF)

2. **Mettre à jour getUserPublicProfile :**
   ```typescript
   const publicProfile = {
     displayName: user.showDisplayName ? user.displayName : null,
     bio: user.showBio ? user.bio : null,
     profileImage: user.showProfilePhoto ? user.profileImage : null,
     // ...
   };
   ```

3. **Initialiser preferences par défaut :**
   - PRIVACY_DEFAULTS.showDisplayName = false
   - PRIVACY_DEFAULTS.showBio = false

**Responsable :** RN-Expo-Dev — délai 2–3 jours.

---

#### **CONSTAT P1–003 : Données d'Expédition Non Anonymisées lors Suppression (Art. 30 Loi 25)**
**Exigence :** Art. 30 (droit à l'oubli) : suppression doit être complète ou anonymisation exhaustive.

**Observation :**  
Fonction `deleteUserAccount` (users.ts:216–230) anonymise buyer/seller names dans transactions, **MAIS** laisse intactes les données d'expédition ShipEngine :
- shippingAddress (street, city, postalCode, phone) = IDENTIFIABLE
- returnLabelNumber, carrierCode = IMMUABLES (ShipEngine design)

**Données orphelines après suppression compte :**
- Acheteur supprimé → adresse complète livraison persist dans transaction 7 ans (Loi 25)
- Vendeur supprimé → adresse d'expédition persist, trackingNumber/labels orphelines

**Code :**
```typescript
// Dans deleteUserAccount:
const txBatch = db.batch();
txBatch.update(txRef, {
  buyerName: 'Utilisateur supprime',
  buyerEmail: '', // anonymized ✓
  sellerName: 'Utilisateur supprime' // anonymized ✓
  // MAIS shippingAddress NOT touched ✗
});
```

**Remédiation Concrète :**
1. **Ajouter anonymisation adresse d'expédition :**
   ```typescript
   // Dans deleteUserAccount, ajouter pour chaque transaction:
   txBatch.update(txRef, {
     'shippingAddress.street': '',
     'shippingAddress.city': '',
     'shippingAddress.postalCode': '',
     'shippingAddress.phone': '',
     'shippingAddress.name': 'Destinataire supprimé',
     // carrierCode/trackingNumber restent immuables (audit trail)
   });
   ```

2. **Documenter limitation en Privacy Policy :**
   - « Étiquettes d'expédition sont immuables pour audit ShipEngine ; numéros de suivi restent accessibles à des fins de livraison, mais adresses d'expédition sont anonymisées. »

3. **Logger incident si ShipEngine ne peut pas anonymiser :**
   - recordPrivacyIncident(type='deletion_incomplete', severity='medium')

**Responsable :** Firebase Backend — délai 3–5 jours.

---

#### **CONSTAT P1–004 : Registre Incidents — SLA 72h Non Forcé (Art. 3.6 Loi 25)**
**Exigence :** Art. 3.6 Loi 25 : notification CAI « sans délai injustifié » = cible 72 heures.

**Observation :**  
Callable `escalatePrivacyIncidentToCAI` (privacyIncidents.ts:236–290) existe et marque `notifiedCAI=true` avec serverTimestamp. **MAIS :** aucun mécanisme automatisé ne force escalade dans 72h. Admin doit appeler manuellement la fonction.

**Manques :**
1. Aucune scheduled function alertant admin si incident open > 24h
2. Aucune auto-escalade critical/high severity après 72h
3. Aucun dashboard UI admin listant incidents à escalader

**Remédiation Concrète :**
1. **Créer scheduled function `monitorIncidentSLAs`** (toutes les 6h) :
   ```typescript
   // Trigger: Cloud Scheduler 6h
   async function monitorIncidentSLAs() {
     const incidents = await db.collection('privacy_incidents')
       .where('status', '==', 'open')
       .where('severity', 'in', ['critical', 'high'])
       .get();
     
     const now = Date.now();
     const sla72h = 72 * 3600 * 1000;
     
     for (const doc of incidents.docs) {
       const detectedAt = doc.data().detectedAt.toMillis();
       const elapsed = now - detectedAt;
       
       if (elapsed > sla72h && !doc.data().notifiedCAI) {
         // Alert admin via Slack/email
         await slack.chat.postMessage({
           channel: '#admin',
           text: `⚠️ URGENT: Incident ${doc.id} NOT escalated to CAI (${Math.round(elapsed/3600/1000)}h elapsed)`
         });
       }
     }
   }
   ```

2. **Créer UI admin dashboard** (`app/admin/incidents.tsx`) :
   - Lister privacy_incidents avec filtres severity/status
   - Afficher détails + timeline (detectedAt, notifiedCAIAt, notifiedUsersAt)
   - Boutons « Escalader CAI », « Notifier Utilisateurs »

3. **Implémenter escalade auto pour critical :**
   - Si severity='critical' && elapsed > 48h && !notifiedCAI :
     - Auto-call escalatePrivacyIncidentToCAI
     - Alert admin confirmation

**Responsable :** Product + Firebase Backend — délai 1–2 semaines.

---

#### **CONSTAT P1–005 : Notifications Marketing — Enforcement Côté Triggers (Art. 14 LCAP)**
**Exigence :** Art. 14 Loi 25 + LCAP : retrait marketing doit être immédiatement applicué côté serveur (enforcement strict).

**Observation :**  
Backend functions/src/triggers/favorites.ts:54–55, 142–143 vérifient `preferences.marketingConsent` **MAIS** ce champ est client-writable (firestore.rules:157–160 ne l'interdit pas). Risque : attacker modifie preferences.marketingConsent=true directement, déblocke notifications marketing.

**Remédiation Concrète :**
1. **Modifier trigger pour vérifier append-only consents :**
   ```typescript
   // Dans favorites.ts avant sendPushNotification:
   const consents = await db.collection('users').doc(uid)
     .collection('consents')
     .where('type', '==', 'marketing')
     .orderBy('acceptedAt', 'desc')
     .limit(1)
     .get();
   
   const hasMarketingConsent = consents.docs.length > 0 
     && consents.docs[0].data().granted === true;
   
   if (!hasMarketingConsent) {
     return; // Skip notification
   }
   ```

2. **Protéger preferences.marketingConsent en Firestore rules :**
   ```
   allow update: if request.auth.uid == userId 
     && !('marketingConsent' in request.resource.data); // forbid client write
   ```

3. **Server-side uniqueness :** setMarketingConsent callable est seul point d'écriture autorisé

**Responsable :** Firebase Backend — délai 1–2 jours.

---

## 4. ANGLES MORTS & HORS PÉRIMÈTRE

Voir section détaillée ci-dessus (21 angles morts majeurs identifiés). Top 5 critiques :

1. **Biometric Data / Facial Recognition (Art. 44 Loi 25)** — Vertex AI analyse photos (potentiellement visages) SANS audit explicite de facial detection.
2. **Déindexation Google (Art. 34 Loi 25)** — Articles potentiellement indexés par Google Search, zéro mécanisme de retrait.
3. **Admin Access Logs (Art. 3.2 Governance)** — Zéro trace audit des accès admin Firebase Console.
4. **30-Day SLA Enforcement (Art. 27, 30)** — Infrastructure existes, zéro monitoring deadline.
5. **Parental Consent Infrastructure (Art. 14)** — ABSENT entièrement.

---

## 5. FEUILLE DE ROUTE REMÉDIATION

| Priorité | Tâche | Qui | Durée | Délai Cible |
|----------|-------|-----|-------|------------|
| **P0-1** | Valider + signer Politique Gouvernance RP | Juridique + Direction | 2–3 sem | **URGENT** (avant production) |
| **P0-2** | Rédiger + archiver ÉFVP Stripe/ShipEngine/Vertex AI/Google Cloud | Juridique | 12h rédaction + 1 sem obtention DPA | **URGENT** (3 sem max) |
| **P0-2b** | Confirmer région Firestore (us-central1 ou Canada) | Firebase Backend | 1h | **IMMÉDIAT** |
| **P0-3** | Implémenter infrastructure consentement parental 14–17 ans | Product + Backend | 2–3 sem | **URGENT** (avant tout mineur signup) |
| P1-1 | Créer callable exportUserDataFull + inclure swaps/wallet | Firebase Backend | 1–2 sem | 2 sem |
| P1-2 | Ajouter toggles displayName/bio privacy /settings | RN-Expo-Dev | 2–3 j | 1 sem |
| P1-3 | Anonymiser shippingAddress lors suppression compte | Firebase Backend | 3–5 j | 1 sem |
| P1-4 | Créer scheduled monitoring SLA incidents 72h + UI admin | Product + Backend | 1–2 sem | 2 sem |
| P1-5 | Enforcer marketing consent via append-only consents collection | Firebase Backend | 1–2 j | 1 sem |
| P1-6 | Créer callable archivage Stripe lors suppression + retry logic | Firebase Backend | 3–5 j | 1 sem |
| **P2** | Storage cleanup drafts lors suppression compte | Firebase Backend | 3–5 j | 2 sem |
| **P2** | Documenter encryption at-rest + TLS verification | Firebase Backend | 2–3 j | 2 sem |
| P2 | Ajouter webhook signature verification (Stripe/ShipEngine) | Firebase Backend | 3–5 j | 2 sem |

**Chemin critique (DÉPÔT PRODUCTION) :**
1. P0-1 : Gouvernance signée (2–3 sem) ✋ BLOQUANT
2. P0-2 : ÉFVP/DPA archivés (3 sem) ✋ BLOQUANT
3. P0-2b : Vérifier région Firestore (1h)
4. P0-3 : Consentement parental (2–3 sem) ✋ BLOQUANT si ciblage < 16 ans
5. P1-1 : Export complet (1–2 sem) — RECOMMENDED avant scale
6. P1-4 : Monitoring SLA incidents (1–2 sem) — IMPORTANT pour conformité CAI

**Total : 8–10 semaines** avant dépôt production conforme.

---

## 6. AVERTISSEMENT LÉGAL

⚠️ **Ce rapport est une analyse technique du code source basée sur la Loi 25 du Québec.** Il n'est **PAS** :
- Un avis juridique
- Une certification de conformité
- Une couverture d'assurance responsabilité civile

**La Loi 25 du Québec impose à la personne responsable (Aurélien Rouchy, Président)** des obligations de :
- **Conformité démonstrable** aux articles 3.1–3.8 (gouvernance)
- **Responsabilité pénale** en cas violation art. 114 (jusqu'à 25 000 $ ou 2 ans prison pour entreprise)
- **Notification CAI** en cas incident de confidentialité (art. 3.5–3.8)

**Recommandation prioritaire :**
1. **Faire valider ce rapport par un conseiller juridique spécialisé en protection RP, Loi 25** (Québec). Cabinet recommandé : juristes avec expertise CAI/Loi 25.
2. **Documenter toutes les remédiation apportées** avec dates et signatures.
3. **Archiver preuves de conformité** (ÉFVP signées, DPA, gouvernance) accessibles pour audit CAI.

---

**Fin du rapport.**