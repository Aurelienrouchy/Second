# 🔥 Guide Firebase Deploy - Second App

## 🚨 Problème actuel

Les Firebase Functions ne sont **pas déployées**!

**Impact:**
- ❌ Pas de notifications push pour les messages
- ❌ Pas de notifications push pour les offres acceptées/refusées
- ✅ Le reste de l'app fonctionne normalement

---

## 🛠️ Solution rapide (5 minutes)

### Sur ton ordinateur local:

```bash
# 1. Aller dans le dossier
cd ~/seconde/second-app

# 2. Pull les derniers changements
git pull origin main

# 3. Connexion Firebase (si pas déjà fait)
firebase login

# 4. Vérifier le projet
firebase projects:list
# Tu devrais voir: seconde-b47a6

# 5. Déployer les functions
cd functions
npm install
cd ..
firebase deploy --only functions

# Attendre ~2-3 minutes...
# ✅ Deploy complete!
```

---

## ✅ Vérification

### 1. Console Firebase
- Ouvre https://console.firebase.google.com
- Projet: **seconde-b47a6**
- Aller dans **Functions**
- Tu devrais voir:
  - ✅ `sendMessageNotification`
  - ✅ `sendOfferStatusNotification`
  - ✅ Status: "Deployed"

### 2. Tester les notifications

**Test 1: Message simple**
1. Device 1: Envoyer un message dans un chat
2. Device 2: Vérifier réception de la notification push

**Test 2: Offre**
1. Device 1: Créer un article
2. Device 2: Faire une offre
3. Device 1: Vérifier notification "Nouvelle offre reçue"
4. Device 1: Accepter l'offre
5. Device 2: Vérifier notification "Offre acceptée! 🎉"

### 3. Logs en direct
```bash
# Terminal
firebase functions:log --only sendMessageNotification

# Puis envoyer un message test
# Tu devrais voir les logs s'afficher
```

---

## 🐛 En cas de problème

### Erreur: "No authorized accounts"
```bash
firebase logout
firebase login
# Suivre les instructions dans le navigateur
```

### Erreur: "Permission denied"
```bash
# Vérifier que tu es owner du projet
firebase projects:list
firebase use seconde-b47a6
```

### Erreur: "Functions not found"
```bash
cd functions
npm install
npm run build
cd ..
firebase deploy --only functions
```

### Les notifs ne partent toujours pas
1. Vérifier que l'app a bien les permissions push
2. Vérifier que les FCM tokens sont enregistrés dans Firestore:
   ```
   users/{userId}/fcmTokens
   ```
3. Check les logs Firebase:
   ```bash
   firebase functions:log
   ```

---

## 🔐 Option VPS/Serveur (CI Token)

Si tu veux déployer depuis le serveur:

```bash
# Sur ton PC
firebase login:ci
# Copier le token affiché

# Sur le serveur
export FIREBASE_TOKEN="1//0gXXXXXXXXXXXXX"
firebase deploy --only functions --token "$FIREBASE_TOKEN"
```

⚠️ **Sécurité:** Ne jamais committer le token dans Git!

---

## 📊 Monitoring

### Firebase Console
- **Functions** → Voir nombre d'invocations
- **Logs** → Debugger les erreurs
- **Performance** → Temps d'exécution

### Quotas (plan Blaze)
- 2M invocations/mois **gratuit**
- Puis $0.40 par million
- Actuellement: probablement <10K/mois = **GRATUIT**

---

## 🚀 Automatisation future

### Option 1: GitHub Actions
```yaml
# .github/workflows/deploy.yml
name: Deploy Functions
on:
  push:
    branches: [main]
    paths:
      - 'functions/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm install -g firebase-tools
      - run: firebase deploy --only functions --token ${{ secrets.FIREBASE_TOKEN }}
```

### Option 2: Husky pre-push
```bash
npm install husky --save-dev
npx husky add .husky/pre-push "cd functions && npm run build"
```

---

## 📝 Checklist complète

- [ ] `git pull` pour récupérer les derniers changements
- [ ] `firebase login` si pas déjà fait
- [ ] `firebase deploy --only functions`
- [ ] Vérifier dans Firebase Console
- [ ] Tester avec 2 devices
- [ ] Check les logs en temps réel
- [ ] Tout fonctionne? ✅

---

**Temps estimé:** 5-10 minutes  
**Coût:** $0 (dans le plan gratuit)  
**Difficulté:** ⭐☆☆☆☆

Bon déploiement! 🚀
