// scripts/filter-afribapay-report.js
//
// Filtre le rapport `afribapay-full-diagnostic.md` :
//  - retire les lignes/sections pour 🇨🇮 CI et 🇸🇳 SN (pays non ouverts côté merchant)
//  - retire les lignes/sections en `placeholder` (pas de vrai numéro historique
//    pour ce combo → résultat non fiable, à ignorer)
// Réécrit le fichier en place.

const fs = require('fs');
const path = require('path');

const REPORT = path.join(__dirname, 'afribapay-full-diagnostic.md');
const src = fs.readFileSync(REPORT, 'utf8');
const lines = src.split('\n');
const out = [];

let i = 0;
let removedTable = 0;
let removedDetail = 0;

while (i < lines.length) {
  const line = lines[i];

  // ── Section 1 (synthèse) : filtrer les lignes de table
  if (line.startsWith('|') &&
      (line.includes('🇨🇮 CI ') ||
       line.includes('🇸🇳 SN ') ||
       /\(placeholder\)/.test(line))) {
    removedTable++;
    i++;
    continue;
  }

  // ── Section 2 (détail) : retirer un bloc `### ` complet si CI / SN / placeholder
  if (line.startsWith('### ')) {
    // déterminer la fin du bloc (jusqu'au prochain `### ` ou `## `)
    let end = i + 1;
    while (end < lines.length &&
           !lines[end].startsWith('### ') &&
           !lines[end].startsWith('## ')) {
      end++;
    }
    const block = lines.slice(i, end).join('\n');
    const skipCI = /^### 🇨🇮 CI/.test(line);
    const skipSN = /^### 🇸🇳 SN/.test(line);
    const skipPlaceholder = /source : placeholder/.test(block);
    if (skipCI || skipSN || skipPlaceholder) {
      removedDetail++;
      i = end;
      continue;
    }
  }

  out.push(line);
  i++;
}

fs.writeFileSync(REPORT, out.join('\n'), 'utf8');
console.log(`✓ ${removedTable} lignes de synthèse retirées, ${removedDetail} blocs détail retirés`);
console.log(`✓ ${REPORT} mis à jour`);
