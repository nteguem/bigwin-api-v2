// Met à jour htmlContent.fr et htmlContent.en du gift "🔥 Le Journal du Parieur —
// Édition du 13 mai 2026" sur les 5 apps (bigwin + goatips + goodtips +
// strategytips + wisetips), à partir des fichiers HTML responsifs locaux,
// après avoir retiré les références "Cameroun"/"WAT".

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'App'));
require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'GiftTier'));
const Gift = require(path.join(__dirname, '..', 'src', 'api', 'models', 'common', 'Gift'));

const FR_PATH = 'C:/DEV/journal_parieur_13_mai_2026.html';
const EN_PATH = 'C:/DEV/bettors_daily_may_13_2026.html';

const GIFT_IDS = {
  bigwin:       '6a0498361733adad6f5aaaee',
  goatips:      '6a04996d365b51697a5f1240',
  goodtips:     '6a04996f365b51697a5f1248',
  strategytips: '6a049971365b51697a5f124f',
  wisetips:     '6a049974365b51697a5f1256',
};

function strip(html, locale) {
  // FR : "(heure Cameroun)" puis " heure Cameroun" hors parenthèses (le `(`
  // précédent reste et le `)` suivant aussi → résultat propre).
  // EN : "(WAT)" puis " WAT" (avec word boundary).
  if (locale === 'fr') {
    return html
      .replace(/\s*\(heure Cameroun\)/g, '')
      .replace(/\s+heure Cameroun/g, '');
  }
  return html
    .replace(/\s*\(WAT\)/g, '')
    .replace(/\s+WAT\b/g, '');
}

(async () => {
  // Lecture + cleanup
  const frRaw = fs.readFileSync(FR_PATH, 'utf8');
  const enRaw = fs.readFileSync(EN_PATH, 'utf8');
  const fr = strip(frRaw, 'fr');
  const en = strip(enRaw, 'en');

  console.log(`FR : ${frRaw.length} → ${fr.length} octets (${frRaw.length - fr.length} retirés)`);
  console.log(`EN : ${enRaw.length} → ${en.length} octets (${enRaw.length - en.length} retirés)`);

  // Sanity : il ne doit plus rester de mentions
  const frLeft = (fr.match(/Cameroun/gi) || []).length;
  const enLeft = (en.match(/\bWAT\b/g) || []).length;
  console.log(`Restant FR « Cameroun » : ${frLeft}`);
  console.log(`Restant EN « WAT » : ${enLeft}`);
  if (frLeft || enLeft) {
    console.warn('⚠️  Il reste des mentions — abort'); process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('\nMise à jour des gifts :');
  for (const [appId, id] of Object.entries(GIFT_IDS)) {
    const g = await Gift.findById(id);
    if (!g) { console.log(`  ⚠️  ${appId}: gift ${id} introuvable`); continue; }
    const beforeFr = g.htmlContent?.fr?.length || 0;
    const beforeEn = g.htmlContent?.en?.length || 0;
    g.htmlContent = { fr, en };
    await g.save();
    console.log(`  ✅ ${appId.padEnd(13)} ${id}  fr ${beforeFr} → ${fr.length}  |  en ${beforeEn} → ${en.length}`);
  }

  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
