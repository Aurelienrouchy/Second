const admin = require('firebase-admin');
const serviceAccount = require('../seconde-b47a6-firebase-adminsdk-fbsvc-26728f2671.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkEmbeddings() {
  const snapshot = await db.collection('article_images').limit(3).get();
  
  if (snapshot.empty) {
    console.log('No article_images found');
    return;
  }
  
  snapshot.docs.forEach((doc, i) => {
    const data = doc.data();
    const embedding = data.embedding;
    let dimension = 'none';
    if (embedding) {
      if (embedding.toArray) {
        dimension = embedding.toArray().length;
      } else if (embedding._values) {
        dimension = embedding._values.length;
      } else if (Array.isArray(embedding)) {
        dimension = embedding.length;
      }
    }
    console.log(`Doc ${i+1}: articleId=${data.articleId}, embedding dimension=${dimension}`);
  });
}

checkEmbeddings().then(() => process.exit(0));
