/**
 * Seed du système de cadeaux :
 *   1. GiftTier (globaux) : free, bronze, silver, gold, diamond
 *   2. Gifts (par app)    : 5 statiques + 5 IA, référençant les tiers par key
 *
 * IDÉMPOTENT à 100 % :
 *   - Tiers : upsert sur la `key` (pas de duplication)
 *   - Gifts : skip si (appId, title.fr) déjà présent
 *
 * Usage :
 *   node scripts/seed-gifts.js                            # dry-run
 *   node scripts/seed-gifts.js --apply                    # toutes apps
 *   node scripts/seed-gifts.js --apply --app bigwin       # une app
 *   node scripts/seed-gifts.js --apply --tiers-only       # tiers seuls
 *   node scripts/seed-gifts.js --apply --gifts-only       # gifts seuls
 */

require('dotenv').config();
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const TIERS_ONLY = args.includes('--tiers-only');
const GIFTS_ONLY = args.includes('--gifts-only');
const appIdx = args.indexOf('--app');
const APP_FILTER = appIdx >= 0 ? args[appIdx + 1] : null;

const APP_IDS = ['bigwin', 'goatips', 'goodtips', 'strategytips', 'wisetips'];

const PLACEHOLDER_PDF = 'https://placeholder.proxidream.com/gifts/coming-soon.pdf';
const PLACEHOLDER_THUMB = 'https://placeholder.proxidream.com/gifts/thumb.png';

// ============================================================
// 1. TIERS (globaux)
// ============================================================

const TIERS = [
  {
    key: 'free',
    label: { fr: 'Gratuit', en: 'Free' },
    defaultCreditCost: 0,
    emoji: '🆓',
    color: '10B981',
    displayOrder: 1,
  },
  {
    key: 'bronze',
    label: { fr: 'Bronze', en: 'Bronze' },
    defaultCreditCost: 1,
    emoji: '🥉',
    color: 'CD7F32',
    displayOrder: 2,
  },
  {
    key: 'silver',
    label: { fr: 'Argent', en: 'Silver' },
    defaultCreditCost: 2,
    emoji: '🥈',
    color: '9CA3AF',
    displayOrder: 3,
  },
  {
    key: 'gold',
    label: { fr: 'Or', en: 'Gold' },
    defaultCreditCost: 3,
    emoji: '🥇',
    color: 'EAB308',
    displayOrder: 4,
  },
  {
    key: 'diamond',
    label: { fr: 'Diamant', en: 'Diamond' },
    defaultCreditCost: 5,
    emoji: '💎',
    color: '06B6D4',
    displayOrder: 5,
  },
];

// ============================================================
// 2. GIFTS (par app, identique pour les 5)
// ============================================================
//
// Référence le tier par sa `key` — sera résolu vers son ObjectId au runtime.

const GIFT_DEFINITIONS = [
  // ===== STATIQUES =====
  {
    sortOrder: 1,
    type: 'static',
    tierKey: 'free',
    category: 'sports',
    isFreeTeaser: true,
    title: {
      fr: '5 erreurs fatales du parieur débutant',
      en: '5 fatal mistakes of the beginner bettor',
    },
    description: {
      fr: 'La stratégie explosive utilisée par les professionnels pour multiplier leur capital de manière spectaculaire et sécurisée.',
      en: 'The explosive strategy professionals use to multiply their capital spectacularly and safely.',
    },
    thumbnail: PLACEHOLDER_THUMB,
    staticFormat: 'pdf',
    contentUrl: PLACEHOLDER_PDF,
  },
  {
    sortOrder: 2,
    type: 'static',
    tierKey: 'free',
    category: 'sports',
    isFreeTeaser: true,
    title: {
      fr: 'Pourquoi 90% des parieurs perdent toujours',
      en: 'Why 90% of bettors always lose',
    },
    description: {
      fr: "La vérité choquante sur ce qui sépare les 10% de gagnants du reste — révélations que l'industrie cache jalousement.",
      en: 'The shocking truth about what separates the 10% of winners from the rest — revelations the industry jealously hides.',
    },
    thumbnail: PLACEHOLDER_THUMB,
    staticFormat: 'pdf',
    contentUrl: PLACEHOLDER_PDF,
  },
  {
    sortOrder: 3,
    type: 'static',
    tierKey: 'bronze',
    category: 'productivity',
    title: {
      fr: "30 Prompts qui font travailler l'IA à ta place",
      en: '30 Prompts that make AI work for you',
    },
    description: {
      fr: "Pendant que tes potes galèrent 8h sur ChatGPT, toi tu copies-colles et c'est plié.",
      en: "While your friends struggle 8 hours on ChatGPT, you copy-paste and it's done.",
    },
    thumbnail: PLACEHOLDER_THUMB,
    staticFormat: 'pdf',
    contentUrl: PLACEHOLDER_PDF,
  },
  {
    sortOrder: 4,
    type: 'static',
    tierKey: 'silver',
    category: 'business',
    title: {
      fr: '7 side-business qui rapportent en 2026',
      en: '7 side-businesses that pay off in 2026',
    },
    description: {
      fr: "Les niches explosives que personne n'ose te montrer — pendant que d'autres se rempliront les poches en silence.",
      en: 'The explosive niches no one dares show you — while others quietly fill their pockets.',
    },
    thumbnail: PLACEHOLDER_THUMB,
    staticFormat: 'pdf',
    contentUrl: PLACEHOLDER_PDF,
  },
  {
    sortOrder: 5,
    type: 'static',
    tierKey: 'silver',
    category: 'mindset',
    title: {
      fr: 'Le Manuel du Riche Discret : 11 habitudes qui changent tout',
      en: 'The Quiet Rich Manual: 11 habits that change everything',
    },
    description: {
      fr: "Ce que les vrais riches font en silence pendant que les autres dépensent leur salaire.",
      en: 'What the truly wealthy do in silence while others spend their paychecks.',
    },
    thumbnail: PLACEHOLDER_THUMB,
    staticFormat: 'pdf',
    contentUrl: PLACEHOLDER_PDF,
  },

  // ===== IA =====
  {
    sortOrder: 6,
    type: 'ai',
    tierKey: 'gold',
    category: 'sports',
    title: {
      fr: 'Le Plan que les Bookmakers Détestent',
      en: 'The Plan Bookmakers Hate',
    },
    description: {
      fr: "L'arme secrète des parieurs gagnants — ta caisse pilotée semaine après semaine par l'IA.",
      en: 'The secret weapon of winning bettors — your bankroll piloted week after week by AI.',
    },
    thumbnail: PLACEHOLDER_THUMB,
    outputFormat: 'html',
    rateLimitPerWeek: 1,
    formSchema: [
      {
        name: 'bankroll',
        label: { fr: 'Ton budget total (FCFA)', en: 'Your total budget (FCFA)' },
        type: 'number',
        required: true,
        placeholder: { fr: 'Ex: 50000', en: 'Ex: 50000' },
      },
      {
        name: 'niveauRisque',
        label: { fr: 'Niveau de risque', en: 'Risk level' },
        type: 'select',
        required: true,
        options: [
          { value: 'prudent', label: { fr: 'Prudent', en: 'Cautious' } },
          { value: 'equilibre', label: { fr: 'Équilibré', en: 'Balanced' } },
          { value: 'agressif', label: { fr: 'Agressif', en: 'Aggressive' } },
        ],
      },
      {
        name: 'sportsPreferes',
        label: { fr: 'Sports préférés', en: 'Favorite sports' },
        type: 'text',
        required: false,
        placeholder: { fr: 'Ex: foot, basket', en: 'Ex: football, basketball' },
      },
    ],
    promptTemplate: `Construis un plan de gestion de bankroll pour la semaine.
Budget total : {bankroll} FCFA
Profil de risque : {niveauRisque}
Sports préférés : {sportsPreferes}

Livre :
1. Une répartition jour par jour (lundi à dimanche) avec montants précis en FCFA
2. La mise unitaire optimale en pourcentage du capital (basée sur Kelly simplifié)
3. 3 règles strictes à respecter cette semaine
4. Le piège typique à éviter pour ce profil de risque
5. Un objectif réaliste de fin de semaine

Pas de pronostic concret (interdit). Que de la méthode.
Sortie HTML structurée avec h1, h2, table pour la répartition, ul pour les règles.`,
  },
  {
    sortOrder: 7,
    type: 'ai',
    tierKey: 'gold',
    category: 'career',
    title: {
      fr: "La Lettre-Bombe : décroche l'embauche en 48h",
      en: 'The Bomb Letter: land the job in 48h',
    },
    description: {
      fr: "La formule confidentielle qui force un RH à t'appeler — même quand 200 personnes postulent au même poste.",
      en: "The confidential formula that forces an HR to call you back — even when 200 people apply for the same job.",
    },
    thumbnail: PLACEHOLDER_THUMB,
    outputFormat: 'html',
    rateLimitPerWeek: 2,
    formSchema: [
      {
        name: 'posteVise',
        label: { fr: 'Poste visé', en: 'Target job' },
        type: 'text',
        required: true,
        placeholder: { fr: 'Ex: Développeur Full Stack', en: 'Ex: Full Stack Developer' },
      },
      {
        name: 'entreprise',
        label: { fr: 'Entreprise', en: 'Company' },
        type: 'text',
        required: true,
        placeholder: { fr: 'Ex: Orange Cameroun', en: 'Ex: Orange Cameroun' },
      },
      {
        name: 'tonExperience',
        label: { fr: 'Ton parcours / expériences', en: 'Your background / experiences' },
        type: 'textarea',
        required: true,
        placeholder: {
          fr: '3 ans en développement web, projets React/Node…',
          en: '3 years in web development, React/Node projects…',
        },
      },
      {
        name: 'tonStyle',
        label: { fr: 'Style de la lettre', en: 'Letter style' },
        type: 'select',
        required: true,
        options: [
          { value: 'formel', label: { fr: 'Formel', en: 'Formal' } },
          { value: 'punchy', label: { fr: 'Punchy', en: 'Punchy' } },
          { value: 'storytelling', label: { fr: 'Storytelling', en: 'Storytelling' } },
        ],
      },
    ],
    promptTemplate: `Rédige une lettre de motivation percutante pour {posteVise} chez {entreprise}.
Profil candidat : {tonExperience}
Style demandé : {tonStyle}

Contraintes :
- 250 à 300 mots maximum
- Pas de phrase bateau ("je suis dynamique et motivé")
- Une accroche qui parle d'un problème réel de l'entreprise ou du secteur
- Au moins une preuve chiffrée tirée de l'expérience candidat
- Un CTA final concret (pas "dans l'attente de votre réponse")
- Adapter le ton à l'environnement africain francophone si pertinent

Sortie HTML structurée avec h1 (titre court), p (corps de la lettre), strong pour les chiffres clés.`,
  },
  {
    sortOrder: 8,
    type: 'ai',
    tierKey: 'gold',
    category: 'career',
    title: {
      fr: 'Ton CV Passé au Scanner',
      en: 'Your CV Run Through the Scanner',
    },
    description: {
      fr: "L'analyse impitoyable qui révèle pourquoi 85% des CV finissent à la poubelle.",
      en: 'The merciless analysis that reveals why 85% of CVs end up in the trash.',
    },
    thumbnail: PLACEHOLDER_THUMB,
    outputFormat: 'html',
    rateLimitPerWeek: 2,
    formSchema: [
      {
        name: 'cvText',
        label: { fr: 'Colle ici le contenu de ton CV', en: 'Paste your CV content here' },
        type: 'textarea',
        required: true,
        placeholder: {
          fr: 'Copie-colle tout ton CV (texte brut)…',
          en: 'Copy-paste your full CV (plain text)…',
        },
      },
      {
        name: 'posteVise',
        label: { fr: 'Poste visé', en: 'Target role' },
        type: 'text',
        required: true,
        placeholder: { fr: 'Ex: Chef de projet', en: 'Ex: Project Manager' },
      },
      {
        name: 'experienceAnnees',
        label: { fr: "Années d'expérience", en: 'Years of experience' },
        type: 'number',
        required: false,
      },
    ],
    promptTemplate: `Analyse ce CV pour le poste de {posteVise} ({experienceAnnees} années d'expérience).

CV à analyser :
"""
{cvText}
"""

Produis une analyse en 5 sections :
1. Score global du CV (sur 10) avec justification courte
2. Les 3 forces qui sortent du lot
3. Les 5 problèmes critiques qui font perdre des entretiens
4. Une réécriture concrète des 3 phrases les plus faibles (avant/après)
5. Le top 3 des actions immédiates pour passer le filtre ATS

Ton direct, sans politesse inutile. L'utilisateur veut savoir la vérité.
Sortie HTML structurée : h1, h2 pour chaque section, ul pour les listes, table avant/après pour la réécriture.`,
  },
  {
    sortOrder: 9,
    type: 'ai',
    tierKey: 'diamond',
    category: 'business',
    title: {
      fr: 'Vends ton Idée à un Banquier en 30 Secondes',
      en: 'Sell Your Idea to a Banker in 30 Seconds',
    },
    description: {
      fr: "L'argumentaire qui fait dire OUI à celui qui tient les cordons de la bourse.",
      en: 'The pitch that makes the one who holds the purse strings say YES.',
    },
    thumbnail: PLACEHOLDER_THUMB,
    outputFormat: 'html',
    rateLimitPerWeek: 2,
    formSchema: [
      {
        name: 'idee',
        label: { fr: 'Décris ton idée', en: 'Describe your idea' },
        type: 'textarea',
        required: true,
        placeholder: { fr: 'Une plateforme qui…', en: 'A platform that…' },
      },
      {
        name: 'cibleClient',
        label: { fr: 'À qui tu vends ?', en: 'Who do you sell to?' },
        type: 'text',
        required: true,
        placeholder: { fr: 'Ex: étudiants 18-25 ans', en: 'Ex: students 18-25' },
      },
      {
        name: 'problemeResolu',
        label: { fr: 'Quel problème ça résout ?', en: 'What problem does it solve?' },
        type: 'textarea',
        required: true,
      },
      {
        name: 'modeleEco',
        label: { fr: 'Comment tu gagnes de l\'argent ?', en: 'How do you make money?' },
        type: 'textarea',
        required: true,
      },
      {
        name: 'montantDemande',
        label: { fr: 'Montant recherché (FCFA ou €)', en: 'Funding asked (FCFA or €)' },
        type: 'text',
        required: false,
      },
    ],
    promptTemplate: `Transforme cette idée en pitch one-pager pour banquier ou investisseur.

Idée : {idee}
Cible : {cibleClient}
Problème résolu : {problemeResolu}
Modèle économique : {modeleEco}
Montant recherché : {montantDemande}

Structure le pitch en 7 sections courtes (chacune max 3 lignes) :
1. Le problème (en 1 phrase qui parle au banquier)
2. La solution (en 1 phrase concrète)
3. Le marché (taille estimée + pourquoi maintenant)
4. Le modèle économique (comment l'argent rentre)
5. Pourquoi toi (ce qui te rend crédible)
6. Le besoin (montant + ce qu'il finance précisément)
7. Le retour attendu (rentabilité, échéance, multiple)

Ton sérieux mais punchy. Vocabulaire compréhensible par un non-tech.
Sortie HTML one-pager : h1, h2 par section, p concis, strong pour les chiffres clés.`,
  },
  {
    sortOrder: 10,
    type: 'ai',
    tierKey: 'diamond',
    category: 'career',
    title: {
      fr: 'Coach Négociation : simule la convo qui change ta vie',
      en: 'Negotiation Coach: simulate the conversation that changes your life',
    },
    description: {
      fr: "L'IA joue ton patron, ton client ou ta banque — tu sors champion à chaque fois.",
      en: 'AI plays your boss, your client or your bank — you come out a champion every time.',
    },
    thumbnail: PLACEHOLDER_THUMB,
    outputFormat: 'html',
    rateLimitPerWeek: 2,
    formSchema: [
      {
        name: 'situation',
        label: { fr: 'Situation à négocier', en: 'Negotiation situation' },
        type: 'select',
        required: true,
        options: [
          { value: 'augmentation', label: { fr: 'Augmentation de salaire', en: 'Salary raise' } },
          { value: 'embauche', label: { fr: 'Salaire à l\'embauche', en: 'Starting salary' } },
          { value: 'client', label: { fr: 'Vente à un client', en: 'Sale to a client' } },
          { value: 'pret', label: { fr: 'Prêt bancaire', en: 'Bank loan' } },
          { value: 'partenaire', label: { fr: 'Accord avec un partenaire', en: 'Partner agreement' } },
        ],
      },
      {
        name: 'objectif',
        label: { fr: 'Ton objectif chiffré', en: 'Your target outcome' },
        type: 'text',
        required: true,
        placeholder: { fr: 'Ex: +30% sur le salaire', en: 'Ex: +30% on salary' },
      },
      {
        name: 'contexte',
        label: { fr: 'Contexte / position de force', en: 'Context / leverage' },
        type: 'textarea',
        required: true,
        placeholder: {
          fr: '5 ans dans la boîte, 2 promotions ratées, j\'ai une autre offre…',
          en: '5 years in the company, 2 missed promotions, I have another offer…',
        },
      },
      {
        name: 'craintes',
        label: { fr: 'Tes craintes', en: 'Your fears' },
        type: 'textarea',
        required: false,
        placeholder: { fr: 'Peur de me faire virer, peur du non…', en: 'Fear of being fired, fear of no…' },
      },
    ],
    promptTemplate: `Coach l'utilisateur pour une négociation : {situation}.
Objectif chiffré : {objectif}
Contexte : {contexte}
Craintes : {craintes}

Produis :
1. Le diagnostic de sa position de force (réelle vs perçue)
2. La phrase d'ouverture exacte qu'il doit dire (verbatim, entre guillemets)
3. La structure de la conversation en 4 étapes (avec ce qu'il doit dire à chaque étape)
4. Les 3 objections probables et la réponse exacte à chacune
5. La sortie idéale (gagnant-gagnant)
6. Le plan B si la négociation échoue

Ton coach exigeant. Pas de bullshit du genre "ayez confiance en vous".
Sortie HTML : h1, h2 par section, blockquote pour les phrases verbatim, table pour objections/réponses.`,
  },
];

// ============================================================
// EXÉCUTION
// ============================================================

async function seedTiers(GiftTier) {
  console.log('\n━━━ Seed des TIERS ━━━');
  const stats = { upserted: 0, updated: 0, errors: 0 };

  for (const tierDef of TIERS) {
    try {
      const existing = await GiftTier.findOne({ key: tierDef.key });

      if (!APPLY) {
        console.log(`   ${existing ? '🔁 [DRY] update' : '➕ [DRY] create'} "${tierDef.key}"`);
        existing ? stats.updated++ : stats.upserted++;
        continue;
      }

      if (existing) {
        // Update : on respecte les modifs admin sur defaultCreditCost.
        // Ici on fait un update FULL pour seed initial seulement.
        await GiftTier.updateOne(
          { _id: existing._id },
          {
            $set: {
              label: tierDef.label,
              defaultCreditCost: tierDef.defaultCreditCost,
              emoji: tierDef.emoji,
              color: tierDef.color,
              displayOrder: tierDef.displayOrder,
            },
          }
        );
        stats.updated++;
        console.log(`   🔁 "${tierDef.key}" mis à jour`);
      } else {
        await GiftTier.create(tierDef);
        stats.upserted++;
        console.log(`   ✅ "${tierDef.key}" créé`);
      }
    } catch (err) {
      stats.errors++;
      console.error(`   ❌ "${tierDef.key}": ${err.message}`);
    }
  }

  console.log(
    `   ▸ ${stats.upserted} créé(s) · ${stats.updated} màj · ${stats.errors} erreur(s)`
  );
}

async function seedGifts({ Gift, GiftTier, apps }) {
  console.log('\n━━━ Seed des CADEAUX ━━━');

  // 1) Précharger les tiers en map { key -> _id }
  const tierDocs = await GiftTier.find();
  const tierByKey = Object.fromEntries(tierDocs.map((t) => [t.key, t._id]));

  // En APPLY : on doit avoir tous les tiers requis, sinon on s'arrête net.
  // En DRY-RUN : on tolère leur absence — l'apply suivant créera les tiers
  // d'abord (la fonction seedTiers tourne avant celle-ci).
  const requiredKeys = [...new Set(GIFT_DEFINITIONS.map((g) => g.tierKey))];
  const missing = requiredKeys.filter((k) => !tierByKey[k]);
  if (missing.length > 0 && APPLY) {
    throw new Error(
      `Tiers manquants en BD : ${missing.join(', ')}. Lance d'abord le seed des tiers.`
    );
  }
  if (missing.length > 0) {
    console.log(
      `   ℹ️  DRY-RUN : tiers manquants (${missing.join(', ')}) — seront créés à l'apply`
    );
  }

  const stats = { created: 0, skipped: 0, errors: 0 };

  for (const appId of apps) {
    console.log(`\n   ┌── ${appId} ──`);
    for (const def of GIFT_DEFINITIONS) {
      try {
        const existing = await Gift.findOne({ appId, 'title.fr': def.title.fr });
        if (existing) {
          console.log(`   ⏭️  [SKIP] "${def.title.fr}"`);
          stats.skipped++;
          continue;
        }

        const { tierKey, ...rest } = def;
        const payload = {
          appId,
          tier: tierByKey[tierKey],
          ...rest,
        };

        if (!APPLY) {
          console.log(`   ➕ [DRY] "${def.title.fr}" tier=${tierKey}`);
          stats.created++;
          continue;
        }

        await Gift.create(payload);
        stats.created++;
        console.log(`   ✅ "${def.title.fr}"`);
      } catch (err) {
        stats.errors++;
        console.error(`   ❌ "${def.title.fr}": ${err.message}`);
      }
    }
  }

  console.log(
    `\n   ▸ ${stats.created} créé(s) · ${stats.skipped} skipped · ${stats.errors} erreur(s)`
  );
}

(async () => {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO_URI) {
    console.error('❌ MONGO_URI manquant');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connecté à MongoDB');

  if (!APPLY) console.log('🟡 DRY-RUN. Lance avec --apply pour exécuter.');

  const GiftTier = require('../src/api/models/common/GiftTier');
  const Gift = require('../src/api/models/common/Gift');

  if (!GIFTS_ONLY) {
    await seedTiers(GiftTier);
  }

  if (!TIERS_ONLY) {
    const apps = APP_FILTER ? [APP_FILTER] : APP_IDS;
    console.log(`\n📦 Apps cible : ${apps.join(', ')}`);
    await seedGifts({ Gift, GiftTier, apps });
  }

  await mongoose.disconnect();
  console.log('\n✅ Terminé');
})().catch((err) => {
  console.error('❌ Erreur fatale:', err);
  process.exit(1);
});
