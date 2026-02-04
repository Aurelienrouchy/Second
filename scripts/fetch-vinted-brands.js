const https = require('https');
const fs = require('fs');

// Configuration
const OUTPUT_FILE = 'vinted-brands.txt';
const DELAY_MS = 200; // Délai entre les requêtes pour éviter de surcharger l'API
const CATALOG_ID = '5'; // ID du catalogue (hommes)

// Générer les combinaisons de caractères
function generateSearchTerms() {
  const terms = new Set();

  // Alphabet et chiffres
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const allChars = letters + numbers;

  // 1. Caractères simples (a, b, c, ..., z, 0, 1, ..., 9)
  for (const char of allChars) {
    terms.add(char);
  }

  // 2. Combinaisons de 2 caractères (aa, ab, ..., zz, 00, 01, ..., 99)
  for (const char1 of allChars) {
    for (const char2 of allChars) {
      terms.add(char1 + char2);
    }
  }

  // 3. Combinaisons de 3 caractères (limité pour ne pas faire trop de requêtes)
  // On prend toutes les combinaisons avec les lettres a-z pour le premier caractère
  // et a-e pour les suivants pour limiter le nombre
  for (const char1 of letters) {
    for (const char2 of letters.slice(0, 10)) { // a-j
      for (const char3 of letters.slice(0, 5)) { // a-e
        terms.add(char1 + char2 + char3);
      }
    }
  }

  // 4. Caractères spéciaux courants dans les marques
  const specialChars = ['&', '+', '-', '.', "'", ' '];
  for (const special of specialChars) {
    terms.add(special);
  }

  return Array.from(terms);
}

// Faire une requête à l'API Vinted avec tous les headers de la cURL
function fetchBrands(searchText) {
  return new Promise((resolve, reject) => {
    const cookies = `v_udt=ZHlBQUV5NGNBREVBaWhoMU1EK1pMNXRML0lCZC0tcUF1WVpBS09OTlc0QWFpKy0tUGYya1ZkTVUwZy96Q3Q5NkFpZWhldz09; anon_id=68bb0ee4-edbf-4d7c-afdd-a41d708d1b75; anonymous-locale=en-us-fr; homepage_session_id=f43416d3-74c3-45af-a239-fe9a60b3ee06; access_token_web=eyJraWQiOiJFNTdZZHJ1SHBsQWp1MmNObzFEb3JIM2oyN0J1NS1zX09QNVB3UGlobjVNIiwiYWxnIjoiUFMyNTYifQ.eyJhcHBfaWQiOjQsImF1ZCI6ImZyLmNvcmUuYXBpIiwiY2xpZW50X2lkIjoid2ViIiwiZXhwIjoxNzYxMDcwMTgzLCJpYXQiOjE3NjEwNjI5ODMsImlzcyI6InZpbnRlZC1pYW0tc2VydmljZSIsInB1cnBvc2UiOiJhY2Nlc3MiLCJzY29wZSI6InB1YmxpYyIsInNpZCI6IjMzYWY5MjYwLTE3NjEwNjI5ODMifQ.rqcC_2JeYQFUneDGvbr3CEVW-h7lqJiQ4eRrtwmROqnMzGBcnjH1ZEUddJEtONRh3Yz_KLZtLK8Uv86BKpST3_2V9RohCg1wcmUCVEFdBQJibhRAtfvz6nLDEGa8lY89S8TTECTsmmbuM1DFnRmKp32Syhl4AFLAnynY62e8u20a-ubVVsH3IOKv5N-M8j8XrSJCa2WBYO9-hU9_3PHsZ5VZlc-0jyUlZ6aioSHWq6ei8leWmagHMJM-5OMw-NxlGm2ILf5u6MOnt2rCZvG29kV-O2sP4QRmpFfiC25N3lteeUlIo-xc1kmXO91nX9NvGwyoVO5oZ4Hl7C6xoZrX9g; refresh_token_web=eyJraWQiOiJFNTdZZHJ1SHBsQWp1MmNObzFEb3JIM2oyN0J1NS1zX09QNVB3UGlobjVNIiwiYWxnIjoiUFMyNTYifQ.eyJhcHBfaWQiOjQsImF1ZCI6ImZyLmNvcmUuYXBpIiwiY2xpZW50X2lkIjoid2ViIiwiZXhwIjoxNzYxNjY3NzgzLCJpYXQiOjE3NjEwNjI5ODMsImlzcyI6InZpbnRlZC1pYW0tc2VydmljZSIsInB1cnBvc2UiOiJyZWZyZXNoIiwic2NvcGUiOiJwdWJsaWMiLCJzaWQiOiIzM2FmOTI2MC0xNzYxMDYyOTgzIn0.j8oaNlRhucCuq5y8uMQoUvF_Z5I6ZHJt_kj7QUeJiaYD8SgtqMLQey_R8TsGTSg7-gXexYRSz0bQTTGMOyTWxru6YNZ-7n9pMI-zdInHN9Vd4yxK3LCNGuNnDoz9xt6RGb3qQ3XeEzQ3qKNblt6D4DeVg0aoPMuheBGKpaHyWtiLd6jHK2bpFOUfcC5M1z_hRJrmZtLtaT7lA5FxBa6Cty_M7Jq0a6hAI5yTo6VUCcsLfFJuWdNy9YR7-M1eBm_u3bgzXcNVrcEEhEXm1mvtC_OdbLiIusCFNab99IZ5IhLnEvcplVXaXItQJ-yAbVFkkEek_M3zPiNNfrxEPamN0A; anon_id=acdb96a3-ccae-4f43-b043-09f8f74b861f; __cf_bm=AsWvnrL5CZxDDkVwMdlIOOKRucDzpOQIxBLQKweglbQ-1761062984-1.0.1.1-IZ.27MdCJGviZm8cg4zyaZrDXLeWf2VT_RioJreTIJM6qYXL9xyS.tY4.ZMYFk4Xw.Y2TWDLfJA6ddFQAvvw3.PiAyC5QUITm9H0TPydq0J5k00FH4qoIJ76yGWSIjVH; is_shipping_fees_applied_info_banner_dismissed=false; viewport_size=1695; cf_clearance=k42zZChsrcOMKw86fM.CpWy2xzp6UIrgaGKZjUz2M6c-1761062985-1.2.1.1-pm._xN0hx8_2sOi8EXdKUDpci5xRh4ctws2hO2Ve52YVZqefbf48ZbREWr4NEMhW9arr2qYt9KvWEdCtGmpC1dWjD0ZNka1c7wnyzstbvXO2nuWTeTc4O8N2Whv.FECyGKKUDG7Pr95DJoUPkhM8n0hrBstsQuOPCf9IHRpoHY4rDmBNmCi49B3Ubln22LLjEfCIaDLhAeTRB7Ta0f0wB5t75rP.3yYMrDOnIb4etmg; v_sid=a995c6ec984849e9d38da6e0b40475f7; domain_selected=true; OptanonAlertBoxClosed=2025-10-21T16:09:53.385Z; datadome=_hHnfGrxXFcFku8W~Kr3dPKuDGz_RVR0Jj5XTuIUlDO8KSfrkY2lyNAm1jCdJHxQk1gvuTGXaJMvAlvIDV~p~1JFobD~rxTtQnxSCh6P47XUDiQ4XByXbkUtxbzvaVH1`;

    const options = {
      hostname: 'www.vinted.com',
      path: `/api/v2/catalog/filters/search?filter_search_code=brand&filter_search_text=${encodeURIComponent(searchText)}&catalog_ids=${CATALOG_ID}&size_ids=&brand_ids=&status_ids=&color_ids=&patterns_ids=&material_ids=`,
      method: 'GET',
      headers: {
        'accept': 'application/json, text/plain, */*,image/webp',
        'accept-language': 'en-us-fr',
        'cookie': cookies,
        'priority': 'u=3',
        'referer': 'https://www.vinted.com/catalog/5-hommes',
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        'x-anon-id': '68bb0ee4-edbf-4d7c-afdd-a41d708d1b75',
        'x-csrf-token': '75f6c9fa-dc8e-4e52-a000-e09dd4084b3e'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error(`Parse error for "${searchText}": ${e.message}\nData: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.end();
  });
}

// Fonction pour attendre
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fonction principale
async function main() {
  console.log('Génération des termes de recherche...');
  const searchTerms = generateSearchTerms();
  console.log(`${searchTerms.length} termes de recherche générés\n`);

  const allBrands = new Set();
  let processedCount = 0;
  let errorCount = 0;

  console.log('Début de la récupération des marques...\n');

  for (const term of searchTerms) {
    try {
      processedCount++;

      const response = await fetchBrands(term);

      // L'API retourne les marques dans le champ "options"
      const brandsList = response.options || [];

      if (Array.isArray(brandsList) && brandsList.length > 0) {
        brandsList.forEach(brand => {
          if (brand.title) {
            // Normaliser: minuscules et trim pour éviter les doublons
            const brandName = brand.title.toLowerCase().trim();
            if (brandName) {
              allBrands.add(brandName);
            }
          }
        });

        if (processedCount % 50 === 0 || brandsList.length > 0) {
          console.log(`[${processedCount}/${searchTerms.length}] "${term}" → ${brandsList.length} marques (Total: ${allBrands.size})`);
        }
      } else if (processedCount % 100 === 0) {
        console.log(`[${processedCount}/${searchTerms.length}] Progression... (Total: ${allBrands.size})`);
      }

      // Attendre avant la prochaine requête
      await sleep(DELAY_MS);

    } catch (error) {
      errorCount++;
      if (errorCount <= 5) {
        console.error(`❌ Erreur pour "${term}": ${error.message}`);
      }
      // Continuer malgré l'erreur
      await sleep(DELAY_MS * 2); // Attendre plus longtemps en cas d'erreur
    }
  }

  // Trier les marques par ordre alphabétique
  const sortedBrands = Array.from(allBrands).sort();

  // Sauvegarder dans un fichier
  console.log(`\nSauvegarde de ${sortedBrands.length} marques uniques dans ${OUTPUT_FILE}...`);
  fs.writeFileSync(OUTPUT_FILE, sortedBrands.join('\n'), 'utf8');

  console.log('\n✓ Terminé!');
  console.log(`\n📊 Statistiques:`);
  console.log(`   - Requêtes effectuées: ${processedCount}`);
  console.log(`   - Erreurs: ${errorCount}`);
  console.log(`   - Marques uniques trouvées: ${sortedBrands.length}`);
  console.log(`   - Fichier de sortie: ${OUTPUT_FILE}`);

  // Afficher quelques exemples
  if (sortedBrands.length > 0) {
    console.log(`\n📝 Exemples de marques:`);
    console.log(`   ${sortedBrands.slice(0, 10).join(', ')}...`);
  }
}

// Lancer le script
main().catch(console.error);
