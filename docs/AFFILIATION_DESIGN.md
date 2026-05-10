# Système d'affiliation BIGWIN — Design v2 (refonte complète)

> **Mode** : Refonte from scratch.
> Le système d'affiliation actuel (amateur, désaligné avec l'ambition produit) sera **entièrement supprimé** des deux repos avant de construire le nouveau.
> Aucun code écrit tant que ce doc n'est pas validé.

---

## ✅ Décision verrouillée : architecture multi-app — **Option A**

> **Choix retenu : 1 compte affilié PAR APP, totalement indépendant.**
> Ce qui suit dans ce doc est aligné sur cette décision. Les options B et C sont conservées en référence ci-dessous.

### Option A — 1 compte affilié PAR APP ✅

> Sarah s'inscrit comme affiliée sur BIGWIN → elle a un compte affilié BIGWIN avec code `BG7K3M2A`.
> Si Sarah veut aussi promouvoir COACHING, elle s'inscrit séparément sur COACHING → 2ᵉ compte totalement indépendant avec code `CO9P2L4D`.

**Concrètement** :
- 2 comptes affiliés, 2 codes, 2 dashboards, 2 balances, 2 payouts
- Aucun lien backend entre les 2 comptes (juste même téléphone par hasard)
- Sarah doit demander 2 payouts si elle veut récupérer ses gains des 2 apps

**Côté affilié (mobile)** :
- Sarah ouvre BIGWIN → "Devenir affilié" → compte affilié BIGWIN
- Elle ne voit JAMAIS qu'il existe d'autres apps du groupe (ce n'est pas son problème)
- Son lien `bigwin.link/BG7K3M2A` ramène uniquement vers BIGWIN
- Si un filleul s'inscrit sur COACHING via ce lien (par accident ou redirect) → **aucune commission** pour Sarah
- Pour gagner sur COACHING, Sarah doit installer COACHING, créer un compte user COACHING, devenir affiliée COACHING

**Côté admin (backoffice central)** :
- Toi/ton équipe ouvrez `affiliation.bigwin.com` (un seul backoffice pour gérer les 5 apps)
- En haut, un selector `App: [BIGWIN ▾]` — tu choisis l'app que tu gères
- Quand tu choisis BIGWIN, tu vois la liste des affiliés BIGWIN, leurs commissions BIGWIN, leurs payouts BIGWIN
- Quand tu switches sur COACHING, tu vois ceux de COACHING (Sarah apparaît dans les 2 listes en tant que 2 entités séparées)
- Toutes les apps sont en BD du même backoffice, mais filtrées par app dans l'UI

**Pros** :
- ✅ Architecture simple et naturelle (colle au modèle `User` per-app actuel)
- ✅ Brand cohérent : Sarah promeut BIGWIN à fond car c'est SON contexte
- ✅ Comptabilité propre par app (utile si entités juridiques séparées)
- ✅ Rollout flexible : tu peux activer l'affiliation sur BIGWIN d'abord, COACHING dans 6 mois
- ✅ Fraude isolée : un compte compromis n'affecte qu'1 app
- ✅ Taux de commission différents par app = config triviale

**Cons** :
- ❌ Si Sarah est super-fan et veut promouvoir 3 apps, elle s'inscrit 3 fois
- ❌ 3 dashboards à consulter = friction pour les power affiliés (mais c'est marginal)

---

### Option B — 1 compte affilié GLOBAL (cross-app)

> Sarah s'inscrit comme affiliée 1 seule fois (peu importe sur quelle app).
> Elle a 1 code unique `BW7K3M2A` qui marche sur les 5 apps.
> Quand elle partage son lien, le filleul peut s'inscrire sur n'importe laquelle des 5 apps → la commission revient à Sarah.

**Concrètement** :
- 1 compte affilié, 1 code, 1 dashboard consolidé
- 1 payout consolidé (toutes apps confondues)
- Le dashboard de Sarah montre les revenus par app : "BIGWIN: 12 000 XAF — COACHING: 5 000 XAF — Total: 17 000 XAF"

**Côté affilié (mobile)** :
- Sarah ouvre BIGWIN → "Devenir affilié" → compte affilié global
- Sarah voit dans son dashboard : "Tu peux aussi gagner sur nos autres apps : COACHING, NUTRITION..."
- Son lien `bigwin.link/BW7K3M2A?app=coaching` peut cibler une app précise
- Côté technique, ça nécessite une **identité affilié séparée du modèle User** (modèle Affiliate global)

**Côté admin (backoffice central)** :
- Liste unique de tous les affiliés du groupe
- Filtres par app pour voir les performances par app
- Payout consolidé à valider une fois par affilié

**Pros** :
- ✅ Power affiliés adorent (1 inscription, 1 dashboard, 1 payout)
- ✅ Cross-promotion naturelle entre les apps
- ✅ Gros affiliés gagnent plus = plus motivés

**Cons** :
- ❌ Architecture plus complexe (modèle Affiliate global indépendant des Users per-app)
- ❌ Comptabilité cross-app (qui paie quoi ?) si entités juridiques séparées
- ❌ Brand confus : Sarah promeut "le groupe BIGWIN" plutôt qu'une app précise
- ❌ Fraude se propage sur les 5 apps si un compte est compromis

---

### Option C — Hybride (per-app strict + import express)

> Comme Option A (1 compte par app, 2 comptes pour 2 apps).
> MAIS à l'inscription affilié sur l'app B, si on détecte le même téléphone qu'un affilié existant sur app A → on propose "Importer mes infos depuis BIGWIN ?".
> Sarah confirme → ses nom/téléphone/infos paiement sont pré-remplies, elle valide en 1 tap.

**Concrètement** :
- Toujours 2 comptes distincts en BD (= Option A en data)
- Juste l'UX de signup est fluide pour les multi-app affiliés
- Aucune liaison backend entre les comptes (= isolation totale)

**Pros** :
- ✅ Tous les pros de l'Option A
- ✅ Friction réduite pour les power affiliés (signup express)

**Cons** :
- ❌ Complexité +5% vs Option A (juste un endpoint "import infos")

---

### Schéma Option A (recommandé / ce que tu décris)

```
┌─────────────────────────────────────────────────────────────┐
│  BIGWIN (mobile app)         COACHING (mobile app)          │
│  ┌──────────────────┐        ┌──────────────────┐           │
│  │ Sarah inscrite   │        │ Sarah inscrite   │           │
│  │ Code: BG7K3M2A   │        │ Code: CO9P2L4D   │           │
│  │ Balance: 12k XAF │        │ Balance: 5k XAF  │           │
│  │ Dashboard BIGWIN │        │ Dashboard COACH. │           │
│  └──────────────────┘        └──────────────────┘           │
│           │                           │                      │
│           ▼                           ▼                      │
│  Lien bigwin.link/BG7K3M2A   Lien coach.link/CO9P2L4D       │
│  → ramène vers BIGWIN seul    → ramène vers COACH. seul     │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ AUCUN LIEN entre les 2 comptes
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  affiliation.bigwin.com   (backoffice central pour ADMIN)   │
│                                                              │
│   [App: BIGWIN ▾]  ← admin choisit l'app à gérer            │
│                                                              │
│   Liste affiliés BIGWIN :                                   │
│     - Sarah (BG7K3M2A) — 12k XAF                            │
│     - Jean (BG3X8N1Y)  — 8k XAF                             │
│     ...                                                      │
│                                                              │
│   [switche selector → App: COACHING ▾]                       │
│                                                              │
│   Liste affiliés COACHING :                                 │
│     - Sarah (CO9P2L4D) — 5k XAF   ← même personne, autre cpt│
│     - Marie (CO5M1Q9R) — 15k XAF                            │
│     ...                                                      │
└─────────────────────────────────────────────────────────────┘
```

### Récapitulatif comparatif

| Critère | Option A | Option B | Option C |
|---------|----------|----------|----------|
| Comptes pour 1 personne sur 3 apps | 3 | 1 | 3 (avec import) |
| Codes différents | 3 | 1 | 3 |
| Dashboards | 3 | 1 | 3 |
| Payouts | 3 | 1 | 3 |
| Complexité backend | 🟢 Faible | 🔴 Élevée | 🟡 Moyenne |
| Refacto modèle User | Aucune | Importante | Aucune |
| Brand cohérence | ✅ | ⚠️ | ✅ |
| Compta per-app | ✅ | ❌ | ✅ |
| Confort power-affilié | 🟡 | 🟢 | 🟢 |
| Fraude isolation | ✅ | ❌ | ✅ |

**Choix final** : **Option A pure**. Si plus tard la friction multi-app devient un vrai problème pour les power affiliés, on pourra ajouter le mécanisme "import express" de l'Option C sans refacto (c'est juste 1 endpoint).

---

## TL;DR

**Programme d'affiliation production-grade**, pas amateur. Transforme chaque user satisfait en commercial actif rémunéré automatiquement.

**6 piliers** :

1. **Architecture clean** : affilié = rôle dans User (sous-doc `User.affiliate`), pas un compte parallèle. 1 sub-doc par app, scope per-app.
2. **Scope pays strict** : un affilié ne touche que sur les filleuls de son pays (figé au signup via `User.countryCode` IP). Mismatch = pas de commission.
3. **Tracking natif** : Google Play Install Referrer (gratuit, fiable, déjà utilisé en prod). Pas de Branch.io / AppsFlyer.
4. **Programme configurable** : taux, tiers, bonus, threshold — tout configurable depuis le backoffice par app, sans déploiement.
5. **Payouts automatisés AfribaPay** : workflow `requested → processing → paid` avec webhook + reconciliation. Stratégie **pay-on-demand** : pas de pré-financement, le compte payout d'un pays est alimenté manuellement quand un affilié de ce pays demande son 1ᵉʳ retrait.
6. **Robustesse production-grade** : HMAC webhook, idempotency, lock atomique MongoDB, reconciliation cron, audit immuable, surveillance balance AfribaPay.

**V1 démarrage** : Cameroun seul (XAF, Orange + MTN). Les 13 autres pays AfribaPay s'activent dynamiquement à la demande.

**Plateforme V1** : Android only (iOS hors scope).

Délai estimé : **6-7 semaines** pour l'ensemble (1 dev temps plein), dont 3-4 jours de wipe ancien système.

---

## 1. Pourquoi tout supprimer

L'existant est fonctionnel mais structurellement faible :

- `Affiliate` est un **modèle séparé** avec son propre login, mot de passe, JWT — duplication inutile, friction UX (un user qui veut parrainer doit créer un 2ᵉ compte)
- Le **code de parrainage** est saisi à la main par le filleul → conversion divisée par 4 vs deep link
- Pas de **tracking d'attribution** sérieux (pas de cookie, pas de window, pas de fingerprint)
- Pas de **device fingerprinting** ni de protection anti-fraude
- Pas de **payout automatique** : l'admin tape la référence à la main
- Pas de **marketing kit** : l'affilié doit improviser son pitch
- Pas de **gamification** : aucune raison de pousser fort sur les premiers mois

C'est un MVP qui n'a jamais grandi. Le réécrire coûte autant que de le patcher, mais avec un plafond beaucoup plus haut.

---

## 2. Vision

> **Un user qui kiffe BIGWIN doit pouvoir devenir un commercial rémunéré en moins de 60 secondes, avec un kit de partage prêt à diffuser, suivre ses gains en temps réel, et faire une demande de retrait validée par l'admin sous quelques jours.**

Indicateurs de succès à 6 mois :

| Métrique | Cible |
|----------|-------|
| % d'users actifs ayant activé le mode affilié | 5-10 % |
| % d'installs venus d'un lien affilié | 15-25 % |
| Commission moyenne mensuelle des affiliés actifs | 5 000 - 30 000 XAF |
| LTV des filleuls vs LTV moyenne | ≥ 1.0× (pas de baisse de qualité) |
| Délai moyen entre demande de retrait et virement | < 7 jours |

---

## 3. Refonte architecturale

### 3.1 Affiliate = rôle dans User (pas une entité séparée)

**Avant** :
```
User (auth phone+pwd)
Affiliate (auth phone+pwd) ← compte séparé
```

**Après** :
```
User (auth phone+pwd)
  └─ affiliate: { isActive, code, tier, paymentInfo, ... } ← sous-doc embed
```

**Avantages** :
- 1 seul login, 1 seul JWT, 1 seule UX d'inscription
- Quand un user achète, on sait directement s'il est aussi affilié
- Plus dur de tricher (le numéro est déjà vérifié OTP)
- Mobile et admin partagent la même API d'auth

**Scope (Option A)** : le sous-doc `affiliate` est porté par le `User` qui est lui-même scopé par `appId`. Donc un même téléphone sur BIGWIN et COACHING = 2 Users distincts = 2 sous-docs `affiliate` distincts = 2 comptes affiliés indépendants. Naturel.

### 3.1.bis Scope pays — règle métier capitale

> **Décision** : un affilié ne touche de commission **que sur les filleuls de son propre pays**. Un filleul d'un autre pays peut s'inscrire via le lien (rien ne l'en empêche) mais aucune commission n'est créée.

**Implémentation** :
- `User.countryCode` est déjà rempli automatiquement à la création du compte (résolution IP au signup, déjà existant en BD pour tous les users actuels).
- À l'activation du rôle affilié, on copie `User.countryCode` dans `User.affiliate.country` et c'est **figé à vie** (pas de modification possible — anti-arbitrage).
- Au moment de la création de la `Commission` (webhook paiement filleul réussi), on compare :
  ```js
  if (filleul.countryCode !== parrain.affiliate.country) {
    // skip silencieux + log analytics
    return;
  }
  ```
- Pas d'écran de "choix du pays" dans le parcours signup affilié — le pays est imposé par l'IP de signup utilisateur. Si l'user veut changer de pays, contact admin (rare).

### 3.2 Modèles core (nouveaux)

```
User {
  ...,
  countryCode,                         // déjà existant — dérivé de l'IP au signup
  affiliate: {
    isActive: Boolean,
    code: String (8 chars unique),
    tier: String ('rookie' | ...),
    country: String (ISO-2),           // FIGÉ au signup affilié, copié de User.countryCode
    payoutMethod: {
      operator: String ('orange' | 'mtn' | 'wave' | 'moov' | ...),
      phoneNumber: String,             // sans dial code
    },
    activatedAt: Date,
    suspended: Boolean,
    suspendedReason: String,
  }
}

Referral
  - code (8 chars unique)
  - clickedAt, clickedFrom (UTM, device, IP, fingerprint)
  - convertedUserId (rempli au signup)
  - status: clicked | installed | signed_up | converted | fraud
  - attributionWindow (date max pour valider)

Commission
  - referrerUserId (l'affilié qui touche)
  - referralId (lien vers le Referral)
  - subscriptionId (lien vers la sub achetée)
  - amount, currency
  - tier, rate (pour audit)
  - status: pending | available | paid | clawback
  - paidAt, paymentReference

Payout
  - userId (affilié)
  - commissions[] (les Commission aggregées)
  - amount, currency, method, status
  - requestedAt, paidAt, providerReference

AffiliateTierConfig (collection config par app)
  - tierKey (rookie, pro, elite, legend)
  - minMonthlyConversions, commissionRate, recurringMonths, perksJson

FraudFlag
  - referralId / commissionId
  - reason, signalScore, reviewedBy, action
```

Schéma plat : 4 collections principales (Referral, Commission, Payout, AffiliateTierConfig) + 1 sous-doc dans User. Lisible, propre.

### 3.3 Core API (nouveau)

```
POST   /api/auth/affiliate/activate       → upgrade un user en affilié
GET    /api/auth/affiliate/me             → état + stats temps réel
PATCH  /api/auth/affiliate/payout-method  → set/update mobile money

GET    /api/auth/affiliate/link           → URL + QR + variantes
GET    /api/auth/affiliate/referrals      → mini-CRM (filleuls)
GET    /api/auth/affiliate/commissions    → historique
POST   /api/auth/affiliate/payout/request → déclenche un payout

GET    /r/:code                           → landing page publique (deep link)

(admin)
GET    /api/admin/affiliates              → liste, filtres, top performers
GET    /api/admin/affiliates/:id          → détail, anti-fraude
POST   /api/admin/affiliates/:id/suspend
POST   /api/admin/affiliates/:id/promote
GET    /api/admin/payouts                 → queue payouts
POST   /api/admin/payouts/:id/process     → trigger payout auto
GET    /api/admin/fraud-flags             → review queue
```

Préfixe `/api/auth/affiliate/` (pas `/api/affiliate/` séparé) car l'auth utilisée est celle du user.

---

## 4. Tracking & attribution — via Google Play Install Referrer

> **Décision** : pas de Branch.io, AppsFlyer, ni domain custom. On utilise le **Google Play Install Referrer** (mécanisme natif Google, gratuit, fiable). Une partie du code est déjà en place côté Flutter.

### 4.1 Format des liens

Le lien partagé est un lien **direct vers le Google Play Store**, avec le code de l'affilié injecté dans le paramètre `referrer` :

```
https://play.google.com/store/apps/details?id=com.bigwin.app&referrer=utm_source%3DBG7K3M2A
```

Composants :
- `id=com.bigwin.app` → le `packageName` de l'app cible (récupéré depuis le modèle `App.googlePlay.packageName`)
- `referrer=utm_source%3DBG7K3M2A` → le code de l'affilié, URL-encoded (`%3D` = `=`)

**Pour partage simplifié**, on peut générer une URL raccourcie via un service simple côté backend (`/r/:code` qui redirige vers le lien Play complet).

Variantes optionnelles (pour analytics fines) :
```
&referrer=utm_source%3DBG7K3M2A%26utm_campaign%3Dwhatsapp_status
```

### 4.2 Capture côté Flutter (à réimplémenter from-scratch)

> **Approche** : on s'inspire du **concept** Play Install Referrer (qui existait dans la version amateur) mais on **réécrit tout à neuf** dans le nouveau système. L'ancien code (`utm_referrer_service.dart`, `acquisition_service.dart`, etc.) est supprimé en Phase 0.

Le nouveau service Flutter, propre et dédié :

- Service `AffiliateReferrerService` (nouveau fichier dédié) — utilise la lib publique `play_install_referrer` (gardée dans `pubspec.yaml` car c'est un package tiers, pas du code business)
- Au 1ᵉʳ lancement de l'app après install :
  1. Lit le referrer Play Store via `PlayInstallReferrer.installReferrer`
  2. Parse le paramètre `utm_source=`
  3. Si la valeur matche le format **code affilié** (regex `^[A-Z0-9]{8}$`), la stocke dans un slot dédié `affiliate_referral_code`
  4. Si la valeur matche autre chose (Facebook, Google Ads, etc.), elle est ignorée (le tracking acquisition est un autre sujet, on ne le mélange pas)
- Au signup, l'app récupère le code stocké et l'envoie en payload `POST /auth/register { ..., affiliateCode: 'BG7K3M2A' }`
- Le backend valide, crée le `Referral`, lie le `User`

**Aucune dépendance, aucune adaptation, aucun code legacy** — c'est du neuf de A à Z, juste avec la même technique.

### 4.3 Comportement selon le contexte

> **V1 = Android uniquement**. iOS est explicitement hors scope pour cette première version.

| Contexte | Comportement |
|----------|--------------|
| Android, app pas installée | Clic → Play Store → install → 1ᵉʳ lancement → `PlayInstallReferrer` retourne le code → stocké → utilisé à l'inscription ✅ |
| Android, app déjà installée | Le referrer n'est pas capturé. Fallback : saisie manuelle du code à l'inscription (champ optionnel) |
| Lien partagé sans clic (texte copié) | Saisie manuelle du code à l'inscription |
| ~~iOS~~ | **Hors scope V1** — à voir plus tard |

**Trade-off honnête** : le Play Install Referrer ne couvre QUE le cas "Android, fresh install". Pour le cas "app déjà là", l'affilié communique son code et le filleul le tape à la main. On accepte cette limite.

### 4.4 Attribution

- Window : **30 jours** entre install et 1ᵉʳ achat (configurable côté admin via `AffiliateConfig.attributionWindowDays`)
- Le code capturé au 1ᵉʳ lancement de l'app est verrouillé pour ce User à l'inscription, pas modifiable ensuite
- Si l'user désinstalle puis réinstalle via un autre lien, le nouveau referrer écrase l'ancien (last-touch)
- Mais une fois `User.referredBy` enregistré côté backend, c'est figé

### 4.5 Saisie manuelle au signup (fallback)

Champ optionnel "Code de parrainage" sur l'écran d'inscription mobile :
- **Android** : pré-rempli si capture Play Install Referrer disponible, sinon vide
- **iOS** (futur, V2) : toujours vide, saisie manuelle

---

## 5. Programme de commission — 100 % configurable depuis le backoffice

> **Décision** : aucune valeur n'est hardcodée dans le code. Tout est configurable depuis le backoffice admin, par app. Tu peux ajuster les taux, créer des tiers, désactiver le recurring, etc., sans déploiement.

### 5.1 Modèle de configuration (`AffiliateConfig`)

Une collection MongoDB par app stocke la config :

```
AffiliateConfig {
  appId: 'bigwin',
  isEnabled: true,                    // active/désactive l'affiliation pour cette app
  defaultTier: 'rookie',              // tier d'entrée

  tiers: [                            // tiers configurables (1 à N)
    {
      key: 'rookie',
      label: { fr: 'Débutant', en: 'Rookie' },
      commissionRate: 10,             // % du prix du forfait
      recurringMonths: 3,             // 0 = pas de recurring
      lifetimeCapMultiplier: 3,       // commission max = 3× prix forfait
      promotionRule: null,            // tier d'entrée
    },
    {
      key: 'pro',
      label: { fr: 'Pro', en: 'Pro' },
      commissionRate: 15,
      recurringMonths: 6,
      lifetimeCapMultiplier: 3,
      promotionRule: { minConversionsPerMonth: 5, consecutiveMonths: 2 },
    },
    // ... autant que tu veux
  ],

  attributionWindowDays: 30,
  payoutThreshold: 5000,              // en devise par défaut de l'app
  payoutThresholdCurrency: 'XAF',

  bonuses: [                          // bonus configurables
    { key: 'first_win', amount: 500, currency: 'XAF', enabled: true },
    { key: 'streak_3m', percentBonus: 20, enabled: true },
    // ...
  ],

  // Override par package (optionnel)
  packageOverrides: [
    { packageId: 'xxx', commissionRate: 25 },  // ce forfait paye 25 % au lieu du tier rate
  ],
}
```

### 5.2 Backoffice — onglet "Configuration affiliation"

Pour chaque app, l'admin a un onglet "Configuration" avec :

- **Activation** on/off de l'affiliation pour cette app
- **Tiers** : CRUD complet (ajouter/modifier/supprimer un tier, changer son taux, sa règle de promotion)
- **Window d'attribution** : slider 7-90 jours
- **Seuil de payout** : input avec sélecteur de devise
- **Bonus** : liste configurable des bonus actifs et leurs montants
- **Overrides par package** : optionnel — assigner un taux spécifique à un forfait précis (ex: forfait annuel = 25 %)
- **Aperçu** : "Avec cette config, un affilié Rookie qui parraine un forfait Argent (3 000 XAF) gagnera 300 XAF / vente"

### 5.3 Tiers — exemple de défaut, à ajuster en config

Les tiers ne sont pas codés en dur. Voici juste une **suggestion de config initiale** pour démarrer :

| Tier | Comment l'atteindre | Commission | Recurring |
|------|---------------------|-----------|-----------|
| Rookie | Par défaut | 10 % | 3 mois |
| Pro | 5 conv./mois × 2 mois | 15 % | 6 mois |
| Elite | 20 conv./mois × 2 mois | 20 % | 9 mois |
| Legend | 50 conv./mois × 2 mois | 25 % | 12 mois |

L'admin peut :
- Démarrer avec **1 seul tier flat** (ex: "Affilié 15 %") pour simplifier
- Ajouter Pro/Elite/Legend plus tard quand le volume justifie
- Avoir des tiers différents entre BIGWIN et COACHING

**Auto-promotion** : un cron mensuel (1er du mois) recalcule le tier de chaque affilié selon les règles configurées.

**Auto-démotion** : tolérance configurable de 1 mois sous le seuil avant descente (évite les yo-yo).

### 5.4 Commission récurrente avec cap

Si `recurringMonths > 0` dans le tier :
- Commission versée à chaque renouvellement du filleul, pendant la durée configurée
- Cap configurable : `lifetimeCapMultiplier` × prix forfait par filleul (par défaut 3×)
- Stop automatique si le filleul churn (cancel sub) > 30 jours

### 5.5 Bonus de performance (optionnels, configurables)

| Bonus | Trigger | Récompense | Configurable ? |
|-------|---------|------------|----------------|
| First win | 1ʳᵉ conversion | Montant fixe (ex: 500 XAF) | ✅ |
| Streak | N mois consécutifs ≥ M conversions | % bonus sur le mois suivant | ✅ |
| Big day | N conversions en 24 h | Badge + reconnaissance | ✅ |
| Top 10 | Top 10 mensuel de l'app | Pack VIP gratuit | ✅ |

L'admin active/désactive chaque bonus et configure ses paramètres.

### 5.6 Pas de multi-niveau (MLM)

**Décision tranchée** : 1 seul niveau de parrainage. Pas de "parrain de parrain".

**Pourquoi** : régulation incertaine en Afrique francophone (frontière avec MLM/pyramidal), perception négative, complexité fraude > bénéfice.

Si tu veux pousser l'incentive plus loin, on le fait via les **bonus de performance** plutôt que par MLM — c'est plus sain et tout aussi motivant.

---

## 6. Affiliate Hub (mobile)

L'écran principal de l'affilié dans l'app, avec 5 sections en swipe horizontal :

### 6.1 Dashboard
- Card hero : balance disponible + pending + ce mois-ci
- Graphe 30 jours : clics / installs / signups / achats
- Tier actuel + progress bar vers le tier suivant
- Notifications récentes ("Sarah a souscrit Argent — +2 250 XAF")

### 6.2 Mon lien
- Lien court + QR code + bouton "Partager"
- Variantes du lien : "Pour mes amis" (plus chaleureux), "Pour les pros" (plus formel) — A/B test côté admin
- Stats par variante

### 6.3 Marketing kit
- 10 templates WhatsApp Status (image + texte) — différents tons (humour, sérieux, urgence)
- 3 vidéos courtes prêtes à partager (15 s, 30 s, 60 s)
- Scripts d'argumentaire (texte) à copier-coller
- Banners pour stories Instagram / Facebook
- **Tout est généré pré-rempli avec son code** (pas besoin de l'éditer)

### 6.4 Mini-CRM (filleuls)
- Liste des filleuls anonymisés avec statut :
  - 🟡 Cliqué mais pas installé
  - 🟠 Installé mais pas inscrit
  - 🟢 Inscrit, pas encore acheté
  - 💰 Acheteur (avec montant gagné)
- Bouton "Relancer" sur chaque clic non-converti → ouvre WhatsApp avec un message pré-rempli

### 6.5 Wallet & Demandes de retrait
- Wallet : balance disponible + balance pending (en cours de validation) + total versé
- Historique des commissions (filtrable par mois, par filleul, par statut)
- Bouton "Demander un retrait" si balance disponible ≥ seuil
- Saisie de la méthode de paiement souhaitée : mobile money (numéro + opérateur) ou virement bancaire (RIB/IBAN)
- Suivi en direct du statut : `requested` → `processing` → `paid` (avec preuve d'envoi affichée)
- Téléchargement de la preuve de paiement (capture/justificatif uploadé par l'admin)
- Statement PDF mensuel téléchargeable

### 6.6 Gamification (transverse)
- Leaderboard hebdo des top affiliés (anonymisable)
- Badges débloquables (first win, streak, big day, etc.)
- Notification push à chaque conversion : "Tu as gagné X" → addictif
- Notification quand tu approches le tier suivant : "Plus que 3 conversions pour passer Pro"

---

## 7. Anti-fraude — checks automatiques minimalistes

> **Décision** : pas de scoring complexe, pas de file de review. Le webhook de paiement crée la commission **immédiatement validée**. Quelques checks auto rejettent les cas évidents. Les fraudes plus subtiles seront détectées plus tard via dashboard admin (analytics).

### 7.1 Checks automatiques au moment de créer la commission

| Signal | Action |
|--------|--------|
| **Pays mismatch** (filleul.countryCode ≠ parrain.affiliate.country) | **Pas de commission créée** (skip silencieux + log analytics `country_mismatch`) |
| Même `phone` que l'affilié (self-ref) | Commission créée en `cancelled` directement, log + notif admin |
| Filleul refunde / chargeback | Commission `available` ou `locked` → `cancelled` (auto via webhook refund) |
| Filleul cancel sub avant 30 j (si recurring activé plus tard) | Cancel des futures commissions recurring |
| `referralCode` utilisé > 50 fois en 24 h | Rate-limit côté `/auth/register` (le code reste valide mais throttle) + alerte admin |

**C'est tout.** Pas de score, pas de hold, pas de review queue.

### 7.2 Détection a posteriori (dashboard admin)

Le backoffice expose des indicateurs pour repérer les patterns douteux :

- **Top affiliés du mois** avec ratio conversion / refund
- **Affiliés flaggés** : self-ref détectés, taux de refund > seuil (ex: > 20 %)
- **Filtre "à investiguer"** : affiliés avec > N filleuls qui cancel < 30 j

L'admin peut **suspendre manuellement** un affilié à tout moment (gel des commissions futures, blocage des payouts en attente).

### 7.3 Pas de mode "approval" pour les nouveaux

Les nouveaux affiliés ont accès au programme **immédiatement**, sans validation humaine de leurs premières commissions. Si abus, l'admin suspend a posteriori.

---

## 8. Payouts — automatisés via AfribaPay (stratégie "pay-on-demand")

> **Décision finale** : payouts automatisés via l'API AfribaPay sortant (`api-payout.afribapay.com`). Architecture **pay-on-demand** : l'affilié peut s'inscrire dans n'importe quel pays AfribaPay supporté ; quand il demande un retrait, on tente le payout. Si AfribaPay répond "insufficient funds" sur ce pays, on bascule en `awaiting_funds`, on notifie l'admin qui alimente le compte AfribaPay du pays concerné, puis le payout retry automatiquement. Aucun pré-financement de comptes inutilisés.

### 8.1 Modèle `PayoutRequest`

```
PayoutRequest {
  appId,
  user,                              // affilié qui demande
  amount, currency,
  country,                           // ISO-2, copié de user.affiliate.country
  operator,                          // 'orange' | 'mtn' | 'wave' | 'moov' | ...
  phoneNumber,                       // mobile money number (sans dial code)

  status:
    | 'queued'           // créé, en attente du worker
    | 'processing'       // POST AfribaPay envoyé, attente webhook ou réconciliation
    | 'awaiting_funds'   // AfribaPay refus pour solde insuffisant — admin doit alimenter
    | 'paid'             // webhook AfribaPay confirme SUCCESS
    | 'failed'           // échec définitif (numéro invalide, etc.)
    | 'cancelled',       // annulé par admin

  commissionsIncluded: [ObjectId],   // Commission agrégées dans ce payout (locked)

  // AfribaPay tracking
  afribaPayOrderId,                  // = `payout-${this._id}` — idempotency key
  afribaPayTransactionId,            // POM... renvoyé par AfribaPay
  afribaPayProviderId,               // provider_id (ex: pt-1tf343fvr11nt)
  afribaPayLastResponse,             // dernier payload reçu (debug)

  // Audit immuable
  attempts: [{
    at,
    type: 'request' | 'webhook' | 'reconciliation' | 'admin_action',
    status,
    payload,
    response,
    error,
  }],

  failureReason,                     // user-facing si échec
  webhookReceivedAt,
  reconciledAt,
  requestedAt,
  paidAt,
}
```

### 8.2 Flow côté affilié (mobile + portail web)

1. Affilié ouvre **Wallet** → bouton "Demander un retrait" si balance ≥ 100 (min AfribaPay)
2. Modal :
   - Montant à retirer (max = balance disponible, max AfribaPay = 2 500 000)
   - Coordonnées mobile money pré-remplies depuis `user.affiliate` (modifiables)
3. Confirm → `PayoutRequest` créé en `queued`
4. Push notif : "Demande enregistrée, traitement sous quelques minutes."
5. L'affilié suit le statut en temps réel :
   - `queued` → "En file d'attente"
   - `processing` → "En cours de traitement par AfribaPay"
   - `awaiting_funds` → "Notre service de paiement a besoin d'être réapprovisionné, ton retrait sera traité sous 24h"
   - `paid` → "Envoyé ✅" + lien vers détail (référence AfribaPay)
   - `failed` → "Échec : {raison}" + bouton "Re-tenter" (si récupérable)

### 8.3 Service `AfribaPayService` (backend, singleton)

```
class AfribaPayService {
  ensureToken()           → cache JWT, refresh à T-1h (TTL 24h chez AfribaPay)
  triggerPayout(req)      → POST api-payout.afribapay.com/v1/pay/payout
  getPayoutStatus(orderId) → GET api.afribapay.com/v1/status?order_id=X
  getBalance()            → GET api.afribapay.com/v1/balance
  verifyWebhookSignature(rawBody, headerSign)
                          → HMAC SHA-256 du body avec api_key
}
```

### 8.4 Worker payout (job runner)

Cron Node simple toutes les 30s avec lock atomique MongoDB :

```
1. find PayoutRequest { status: 'queued' } limit 10
   findOneAndUpdate({ _id, status: 'queued' }, { $set: { status: 'processing' } })
   → atomique, évite double traitement par 2 workers

2. Pour chaque payout pickup :
   - Construit payload AfribaPay :
     {
       operator, country, phone_number, amount, currency,
       order_id: `payout-${_id}`,           // idempotency
       merchant_key: env.AFRIBAPAY_MERCHANT_KEY,
       reference_id: `${appId}-${affilieId}`,
       lang: 'fr',
       notify_url: `${BASE_URL}/api/afribapay/payout-webhook`,
     }
   - POST AfribaPay /v1/pay/payout (timeout 15s, retry 3× exponential backoff)
   - Si réponse 200 + status PENDING :
     → save afribaPayTransactionId, afribaPayProviderId
     → log dans attempts[]
   - Si réponse 200 + status FAILED avec message "insufficient funds" / "balance too low" :
     → status = 'awaiting_funds'
     → notif admin URGENTE (push + email) avec : pays, devise, montant manquant
     → log dans attempts[]
   - Si autre erreur (4xx, 5xx, timeout) :
     → status = 'queued' (re-tente plus tard) si erreur réseau
     → status = 'failed' si erreur métier (numéro invalide, etc.)
```

### 8.5 Webhook AfribaPay `/api/afribapay/payout-webhook`

```
1. Récupère raw body + header `Afribapay-Sign`
2. Vérifie HMAC SHA-256 (rejette 403 si mismatch)
3. Parse body, extrait order_id
4. Trouve PayoutRequest correspondant (par afribaPayOrderId)
5. Si déjà traité (paid/failed) → retourne 200 (idempotent, skip)
6. Selon status reçu :
   SUCCESS :
     → PayoutRequest.status = 'paid'
     → Commissions liées : status passe de 'locked' à 'paid'
     → Décrémente définitivement le wallet de l'affilié
     → Push notif user : "Ton retrait de X XAF a été envoyé ✅"
     → Save attempts[]
   FAILED :
     → PayoutRequest.status = 'failed'
     → Commissions liées : status revient à 'available' (réintégrées au wallet)
     → Push notif user : "Échec : {raison}"
7. TOUJOURS retourner 200 (sinon AfribaPay retry indéfiniment)
```

### 8.6 Cron de réconciliation

Pour gérer les cas où le webhook ne nous parvient pas (réseau, AfribaPay down) :

```
Toutes les 15 min :
  find PayoutRequest {
    status: 'processing',
    requestedAt: { $lt: now - 15min },
    webhookReceivedAt: null
  }
  Pour chaque :
    → GET AfribaPay /v1/status?order_id=payout-{_id}
    → Applique transition si terminé (paid / failed)
    → Save reconciledAt
```

### 8.7 Workflow `awaiting_funds` — validation admin manuelle (PAS de cron)

> **Décision finale** : aucun retry automatique. Toute relance de payout après "insufficient funds" passe par une **action humaine de l'admin** dans le backoffice. Pas de cron qui surveille les balances et retente automatiquement.

**Flow complet** :

```
1. AfribaPay rejette le payout pour "insufficient funds"
   → PayoutRequest.status = 'awaiting_funds'
   → Création d'une AdminFundingRequest liée au payout
   → Notif URGENTE à l'admin (push + email) :
     "Recharge AfribaPay nécessaire — pays: XX, devise: YYY,
      affilié: <name>, montant: <amount>"

2. L'affilié voit dans son dashboard :
   "Ton retrait est en cours de traitement par notre équipe.
    Tu seras notifié dès qu'il est envoyé."
   → Pas de bouton "réessayer" affiché à l'affilié.

3. Admin va sur bigwin-admin → section Affiliation → "Demandes de validation"
   → Liste des AdminFundingRequest en attente

4. Admin alimente manuellement le compte AfribaPay du pays
   (virement bancaire, hors plateforme)

5. Admin clique "Valider et relancer" sur la demande
   → Backend re-soumet le payout à AfribaPay (avec le solde maintenant dispo)
   → status = 'processing'
   → Si AfribaPay accepte → flow normal (webhook → paid)
   → Si AfribaPay refuse encore → retour à 'awaiting_funds' (rare, admin re-traite)
```

**Important** :
- L'affilié ne re-déclenche PAS la demande. Sa demande initiale est conservée et relancée par l'admin.
- L'admin peut aussi rejeter la demande (raison obligatoire) → commissions réintégrées au wallet.

### 8.8 Surveillance balance AfribaPay (proactive)

Cron quotidien :
```
GET /v1/balance
Pour chaque payout {country, currency} :
  si balance < seuil_critique[country] (ex: 50 000 XAF pour CM)
    → email + notif admin "Solde payout faible"
  si balance < seuil_bloquant (ex: 10 000 XAF)
    → email URGENT + bloque automatiquement les nouveaux retraits du pays
       (les nouveaux PayoutRequest atterrissent en `awaiting_funds`)
```

### 8.9 Cycle de vie complet d'une commission

```
Webhook paiement filleul reçu (AfribaPay payin)
  → Vérification scope pays : if (filleul.countryCode !== parrain.affiliate.country) → SKIP
  → Vérification self-ref : if (filleul.phone === parrain.phone) → SKIP
  → Commission créée, status: available

  [optionnel webhook refund filleul]
  → status: cancelled (clawback automatique)

Affilié demande retrait
  → Commissions agrégées sélectionnées (FIFO ou somme libre)
  → status: locked

Worker tente AfribaPay payout
  → Si succès webhook : status: paid (versement effectif)
  → Si échec définitif : status: available (réintégrées au wallet)
```

### 8.10 Limites & sécurité

| Mesure | Valeur |
|---|---|
| Min payout | 100 (min AfribaPay) |
| Max payout | 2 500 000 (max AfribaPay) |
| Max payouts en cours par affilié | 1 |
| Max payouts par mois par affilié | 2 (configurable par tier) |
| Token JWT cache TTL | 23h (rafraîchi avant expiration) |
| Timeout API AfribaPay | 15s |
| Retry HTTP (erreurs réseau) | 3× exponential backoff (2s, 5s, 15s) |
| Webhook signature | HMAC SHA-256, reject 403 si invalide |
| Replay attack | Idempotent par order_id (ignore webhook déjà traité) |
| Lock distribué | findOneAndUpdate atomique sur status transition |
| Audit immuable | append-only sur `attempts[]` |

---

## 9. Admin power tools (`bigwin-admin` — section Affiliation)

### 9.1 Dashboard live
- Top 20 affiliés du mois
- Funnel temps réel : clics → installs → signups → convertis
- Heatmap géographique des conversions
- LTV moyen par affilié
- Alerts en bandeau rouge : fraud rate, payouts `awaiting_funds`, balance AfribaPay basse

### 9.2 Surveillance balance AfribaPay (CRITIQUE)
- Card temps réel par pays/devise (refresh GET /v1/balance toutes les heures + on-demand)
- Indicateur visuel : 🟢 OK (> 50k) / 🟠 Attention (< 50k) / 🔴 Critique (< 10k, retraits bloqués)
- Bouton "Recharger" qui ouvre le détail (montant à transférer + IBAN AfribaPay du pays)
- Historique des recharges effectuées (manuelle, saisie admin)

### 9.3 PayoutRequests dashboard
- Liste filtrable par statut (queued / processing / awaiting_funds / paid / failed)
- Détail : audit trail complet (`attempts[]`), réponse AfribaPay brute, raison échec
- Action manuelle : "Re-tenter ce payout" (utile si admin vient d'alimenter le compte)
- Action manuelle : "Annuler" (refund vers le wallet affilié, raison obligatoire)

### 9.4 Anti-fraude
- Liste affiliés avec ratio refund / conversion suspect
- Affiliés avec > X filleuls qui cancel < 30j
- Country mismatch : top affiliés qui drainent du trafic hors zone (analytics)
- Bouton "Suspendre" l'affilié (gel commissions futures + bloque payouts en attente)

### 9.5 Configuration
- Taux de commission par tier × par app
- Liste des pays AfribaPay supportés (sync depuis `/v1/countries` + toggle activation)
- Seuils par pays : threshold payout, balance critique, balance bloquante
- Limites par tier : nb max payouts/mois, montant max
- Custom rates par campagne (ex: code influenceur à 30 %)

### 9.6 Analytics export
- CSV des commissions par mois (pour la compta)
- CSV des payouts (pour reconciliation AfribaPay)
- Stats par affilié et par pays

---

## 10. Parcours utilisateur complets

### 10.1.A Mehdi devient affilié — depuis l'app mobile

1. Mehdi est user actif de BIGWIN (Android), abonné Argent
2. Il voit dans le menu "Gagne de l'argent en parrainant"
3. Tap → écran de présentation (3 slides : "Partage", "Tes amis s'abonnent", "Tu touches X %")
4. CTA "Activer mon compte affilié"
5. Formulaire :
   - Email (optionnel mais recommandé — sert à se connecter au portail web ensuite)
   - Numéro mobile money + opérateur (pré-rempli avec son numéro user)
6. Confirm → **création immédiate, AUCUNE approbation admin requise**
7. Code unique `BW7K3M2A` généré, affiché immédiatement dans le dashboard avec le lien Play Store partageable + QR
8. Onboarding 4 slides expliquant les sections

⏱ **60 secondes** du tap au lien partageable.

### 10.1.B Mehdi devient affilié — depuis le portail web (`bigwin-affiliate-portal`)

Cas où Mehdi n'a pas encore de compte mobile, ou veut s'inscrire directement depuis son ordi.

1. Mehdi va sur `affiliate.bigwin.com` (ou équivalent — domaine à choisir)
2. Sélectionne son app cible (BIGWIN / GOAT TIPS / GOOD TIPS / STRATEGY TIPS / WISE TIPS)
3. Page d'inscription :
   - Email + mot de passe
   - Téléphone + dial code
   - Numéro mobile money + opérateur (sa méthode de retrait préférée)
4. Validation OTP par SMS sur le numéro renseigné
5. **Création immédiate, AUCUNE approbation admin**
6. Connecté direct dans son dashboard → voit son code, son lien, son suivi

⏱ **2 minutes** du formulaire au dashboard.

> **Cas spécial : email déjà utilisé sur l'app mobile**
>
> Si Mehdi a déjà un compte mobile BIGWIN (auth Google) avec son email, et qu'il essaye de s'inscrire au portail web avec le même email :
> - Le système détecte le User existant
> - Propose : "Un compte existe avec cet email, connecte-toi avec tes identifiants Google" (lien Google Sign-In sur le portail web)
> - OU "Tu peux ajouter un mot de passe à ton compte existant pour te connecter au portail" (envoi d'un magic link de set-password)
> - Une fois authentifié, l'activation du rôle affilié se fait sur le User existant — **pas de doublon**

### 10.2 Sarah clique sur le lien de Mehdi (Android only)

> Pour la V1, **on ne gère pas iOS**. Le lien partagé fonctionne uniquement sur Android.

**Cas A — Android, app pas installée** :
1. Sarah clique sur le lien `https://play.google.com/store/apps/details?id=com.bigwin.app&referrer=utm_source%3DBW7K3M2A`
2. Le Play Store s'ouvre — fiche BIGWIN
3. Sarah installe l'app
4. 1ᵉʳ lancement → `AffiliateReferrerService` lit le referrer, parse `BW7K3M2A`, stocke
5. Sarah s'inscrit (création de compte mobile), l'app envoie `affiliateCode: 'BW7K3M2A'` au backend
6. Backend crée le `Referral`, lie `User.referredBy = Mehdi._id`
7. Notification push à Mehdi : "Sarah a installé BIGWIN via ton lien 🎉"

**Cas B — Android, app déjà installée** :
1. Sarah clique → Play Store ouvre la fiche "Désinstaller / Ouvrir"
2. Le referrer **n'est pas capturé** (Play Store ne l'envoie qu'au 1ᵉʳ install)
3. Fallback : Mehdi peut dire à Sarah "tape mon code `BW7K3M2A` à l'inscription"
4. Sarah ouvre l'app → champ "Code de parrainage (optionnel)" sur l'écran d'inscription
5. Saisie manuelle → idem cas A à partir de l'étape 6

**Cas C — iOS** :
- Pas géré pour le moment (pas de tracking auto)
- Si on veut quand même supporter, ajout V2 : champ manuel dans l'app iOS uniquement

### 10.3 Sarah achète un forfait — commission auto-validée

1. Sarah achète Pack Argent (3 000 XAF)
2. Webhook paiement (Korapay / Smobilpay / etc.) → `paymentMiddleware.handleSuccessfulTransaction()`
3. `Subscription` créée
4. Le service détecte que `User.referredBy` est rempli :
   - Crée `Commission` avec `amount = 3 000 × tauxConfiguré (ex: 15%) = 450 XAF`
   - **`status = available` directement** (pas de pending, pas de review humaine)
   - Auto-cancel si self-ref détecté (même phone que Mehdi → impossible ici car Sarah ≠ Mehdi)
5. Push à Mehdi en temps réel : "Tu as gagné 450 XAF — Sarah s'est abonnée à Argent 💰"
6. La balance de Mehdi est mise à jour immédiatement

> Pas d'attente de 7 jours, pas de validation admin. Si refund plus tard, la commission est annulée auto via webhook refund (cf. 10.5).

### 10.4 Mehdi demande son retrait — payout AfribaPay automatique

1. Balance disponible : 12 500 XAF (Mehdi est CM affilié)
2. Sur mobile OU portail web : "Demander un retrait" → modal pré-rempli avec ses coordonnées mobile money
3. Confirm → `PayoutRequest` créé en `queued` (idempotency via `_id`)
4. Push immédiat : "Demande enregistrée, traitement sous quelques minutes."
5. **Worker backend (cron 30s)** picke le payout :
   - Lock atomique → status passe à `processing`
   - POST AfribaPay `api-payout.afribapay.com/v1/pay/payout` avec `order_id=payout-<_id>`
   - AfribaPay répond 200 PENDING avec `transaction_id=POM...`
6. **Webhook AfribaPay** (sous 1-2 min en moyenne) `POST /api/afribapay/payout-webhook` :
   - HMAC vérifié → match `order_id` → status passe à `paid`
   - Commissions de Mehdi passent en `paid` (versement effectif)
   - Push à Mehdi : "Ton retrait de 12 500 XAF a été envoyé ✅ — Référence: POM..."
7. Mehdi reçoit le SMS Orange/MTN sur son téléphone avec le crédit.

⏱ **Quelques minutes** du tap au cash sur le téléphone. Aucune intervention humaine.

### 10.4.bis Cas pay-on-demand — Aïssatou (CI) demande son 1ᵉʳ retrait

1. Aïssatou est affiliée CI (pays sans solde payout AfribaPay encore alimenté chez nous)
2. Elle demande un retrait de 8 000 XOF
3. Worker tente AfribaPay → réponse "insufficient funds for CI XOF"
4. `PayoutRequest.status = 'awaiting_funds'`
5. Backend envoie email + push URGENT à l'admin :
   > Recharge AfribaPay nécessaire — pays: CI, devise: XOF, montant en attente: 8 000
6. Push à Aïssatou : "Ton retrait est en cours de traitement, peut prendre jusqu'à 24h."
7. Admin alimente manuellement le compte payout AfribaPay CI XOF (virement bancaire)
8. **Cron de retry (toutes 6h)** :
   - Détecte `PayoutRequest awaiting_funds` pour CI XOF
   - Check balance AfribaPay → solde maintenant > 8 000 XOF
   - Repasse status à `queued` → worker la traite normalement
9. Webhook AfribaPay → `paid` → push à Aïssatou.

⏱ **Premier retrait CI** : ~24h (le temps que l'admin alimente). **Suivants** : minutes.

### 10.5 Sarah refunde son achat — clawback auto

1. Sarah obtient un refund (chargeback ou demande validée)
2. Webhook refund → backend détecte la commission liée
3. Si commission encore `available` ou `locked` → passe à `cancelled`
4. Si commission déjà `paid` → flag pour reconciliation manuelle (rare, traité par admin)
5. Notif transparente à Mehdi : "La commission de Sarah (450 XAF) a été annulée car son achat a été remboursé"

### 10.6 Cas filleul d'un autre pays — pas de commission

1. Mehdi (CM) partage son lien
2. Cheikh (Sénégalais, `User.countryCode = 'SN'`) clique, s'inscrit, achète un pack
3. Webhook paiement reçu → backend tente la création de Commission :
   ```
   filleul.countryCode = 'SN'  ≠  parrain.affiliate.country = 'CM'
   → SKIP, log analytics 'country_mismatch'
   ```
4. Aucune commission créée. Mehdi voit dans son dashboard : "1 install hors zone (non comptabilisé)"
5. Cheikh utilise normalement l'app, pas de différence pour lui.

---

## 11. Suppression de l'existant (Phase 0)

### 11.1 Backend (`c:/DEV/ROLAND/bigwin v2`)

**Fichiers à supprimer entièrement** (16 fichiers / dossiers) :
- `src/api/routes/affiliate/` (entier)
- `src/api/routes/admin/affiliateRoutes.js`
- `src/api/routes/admin/affiliateTypeRoutes.js`
- `src/api/routes/admin/commissionRoutes.js`
- `src/api/controllers/affiliate/` (entier — 3 fichiers)
- `src/api/controllers/admin/affiliateController.js`
- `src/api/controllers/admin/affiliateTypeController.js`
- `src/api/controllers/admin/commissionController.js`
- `src/api/middlewares/affiliate/affiliateAuth.js`
- `src/api/services/affiliate/dashboardService.js`
- `src/api/services/admin/affiliateManagementService.js`
- `src/api/models/affiliate/Affiliate.js`
- `src/api/models/affiliate/AffiliateType.js`
- `src/api/models/common/Commission.js`

**Fichiers à éditer** (nettoyage références) :
- `src/api/models/user/User.js` → retirer champ `referredBy` + index
- `src/api/routes/index.js` → retirer imports + `router.use()` affiliation (lignes 27, 34, 45-47, 85-87)
- `src/api/services/common/authService.js` → retirer `validateAffiliateCode()` + références (lignes 70-88, 105-106)
- `src/api/controllers/user/authController.js` → retirer paramètre `affiliateCode` du `register()`
- `src/api/services/user/subscriptionService.js` → retirer création commission (lignes 8, 69-72)
- `src/api/services/common/googleAuthService.js` → retirer validation `affiliateCode`
- `src/api/middlewares/common/multiAuth.js` → retirer méthode `adminOrAffiliate()`

**Migration BD** :
- Drop des collections `affiliates`, `affiliatetypes`, `commissions`
- `User.updateMany({}, { $unset: { referredBy: '' } })` pour nettoyer les docs

### 11.2 Mobile — les 5 apps Flutter

**Suppression totale** dans toutes les apps du groupe. Aucun code legacy conservé.

#### Inventaire des 5 repos mobile

| App | Chemin | Code affilié détecté |
|-----|--------|----------------------|
| BIGWIN | `C:/DEV/ROLAND/bigwin/` | Oui (services + models + auth + storage + l10n) |
| GOAT TIPS | `C:/DEV/ROLAND/goat tips/goat_tips/` | Oui (auth_service + auth_provider) |
| GOOD TIPS | `C:/DEV/ROLAND/goat tips/good_tips/` | Oui (auth_service + auth_provider) |
| STRATEGY TIPS | `C:/DEV/ROLAND/goat tips/strategy_tips/` | Oui (auth_service + auth_provider) |
| WISE TIPS | `C:/DEV/ROLAND/goat tips/wise_tips/` | Oui (auth_service + auth_provider) |

#### Pour chaque app — checklist de nettoyage

**Fichiers à SUPPRIMER complètement** (si présents) :
- `lib/shared/services/utm_referrer_service.dart` (BIGWIN seulement)
- Tout écran/widget/provider/service dédié à l'affiliation amateur

**Fichiers à ÉDITER (nettoyage références)** — vérifier dans CHAQUE app :
- `lib/shared/services/auth_service.dart` → retirer paramètre `affiliateCode` (4 apps + bigwin)
- `lib/shared/providers/auth_provider.dart` → idem (4 apps + bigwin)
- `lib/shared/services/api_auth_service.dart` (bigwin) ou équivalent → idem
- `lib/shared/models/user_model.dart` → retirer champ `affiliateCode` (ctor, copyWith, fromJson, toJson, eq, hashCode)
- `lib/shared/guards/auth_guard.dart` (bigwin) → retirer `_affiliateController`
- `lib/core/config/app_config.dart` → retirer `affiliateCodeKey`
- `assets/translations/app_*.arb` → retirer clés `affiliateCode`, `affiliateCodeHint` puis `flutter gen-l10n`
- `lib/screens/splash/services_initialization_screen.dart` (bigwin) → retirer appel à l'ancien `UtmReferrerService`
- `lib/shared/services/storage_service.dart` (bigwin) → retirer `setUtmSource`, `getUtmSource`, `hasAffiliateCode`

**À CONSERVER (techniques pures, hors scope affiliation)** :
- Package `play_install_referrer: ^0.5.0` dans `pubspec.yaml` (wrapper API native Google — pas du code business)
- `lib/shared/services/acquisition_service.dart` (bigwin) — tracking `gclid` Google Ads, sujet différent

#### Procédure recommandée pour le wipe mobile

1. Audit complet par app : `grep -ri "affiliate\|affiliation\|parrain\|referral\|referredBy" lib/` dans chaque repo
2. Liste des fichiers et lignes à toucher
3. Suppression / édition fichier par fichier
4. `flutter clean && flutter pub get && flutter analyze` à chaque app
5. `flutter gen-l10n` après nettoyage des `.arb`
6. Smoke test : signup, login, achat sur chaque app — pas de regression

### 11.3 Admin React (`bigwin-admin`)

Les composants ont déjà été supprimés (cf. diff stat de `version-app`). Vérifier qu'il ne reste **aucune** référence dans :
- Routes (`src/routes/`)
- Sidebar / menu
- Hooks (`src/hooks/`)
- Services (`src/services/`)

Si reste de référence → supprimer. Le nouveau backoffice affiliation sera **séparé** (cf. point ci-dessous).

### 11.4 ✅ Décision verrouillée : 2 projets React distincts

L'architecture frontend est désormais claire :

#### 1. `bigwin-admin` (existant) — backoffice ADMIN

**Rôle** : ce que toi/ton équipe utilisez pour piloter le business.

Ajouts à faire dans le projet existant :
- Section **"Affiliation"** avec selector d'app en haut (BIGWIN / GOAT_TIPS / GOOD_TIPS / STRATEGY_TIPS / WISE_TIPS)
- Sous-sections :
  - **Liste des affiliés** : recherche, filtres par tier, statut, performance
  - **Détail d'un affilié** : ses commissions, ses filleuls, ses payouts passés
  - **Demandes de retrait** : queue à traiter — c'est ICI que l'admin :
    - Voit la demande + les coordonnées de paiement de l'affilié
    - Approuve, fait le virement à la main (mobile money / banque), upload la preuve, marque comme payé
    - Ou rejette avec raison
  - **Configuration affiliation** : config par app (taux, tiers, threshold, bonus, overrides)
  - **Suspendre / réactiver** un affilié manuellement (en cas d'abus détecté)
  - **Indicateurs de qualité** : ratio refund / conversion, top affiliés, affiliés à investiguer

#### 2. `bigwin-affiliate-portal` (nouveau projet) — portail SELF-SERVICE pour les affiliés ✅

**Rôle** : portail web où les **affiliés eux-mêmes** se connectent (alternative au mobile).

Pourquoi un portail web séparé pour les affiliés :
- Les power affiliés veulent un grand écran pour analyser leurs stats
- Plus facile pour copier-coller leur lien, télécharger des assets marketing
- Indépendant de l'app mobile — un affilié sans appareil Android peut quand même piloter son compte
- Permet d'évoluer indépendamment de l'app mobile

**Composition** :
- **Inscription directe** depuis le portail (sans avoir l'app mobile au préalable) :
  - Email + mot de passe + téléphone + numéro mobile money
  - Selector d'app obligatoire au signup (BIGWIN / GOAT TIPS / GOOD TIPS / STRATEGY TIPS / WISE TIPS)
  - Validation OTP par SMS
  - **Aucune approbation admin** — le compte est actif immédiatement
- **Login** : email + mot de passe (ou téléphone + OTP en alternative)
- Si email correspond à un User mobile existant → propose Google Sign-In ou magic link pour set-password (cf. section 10.1.B)
- Selector d'app **figé** : un affilié arrive avec un compte dans une app précise (Option A) → il ne voit que sa propre app
- Dashboard miroir du mobile : balance, filleuls, commissions, demandes de retrait
- Fonctionnalités web-friendly :
  - Export CSV de l'historique
  - Téléchargement direct du marketing kit (images, vidéos)
  - QR code haute résolution pour impression
  - Statements PDF mensuels

**Décisions verrouillées** :
- ✅ 2 projets React distincts
- ✅ `bigwin-admin` existant absorbe la partie gestion admin (affiliés + payouts manuels)
- ✅ `bigwin-affiliate-portal` (nouveau projet) = portail self-service affiliés
- ✅ Nom : `bigwin-affiliate-portal`
- ✅ Création de compte affilié : pas d'approbation admin requise
- ✅ Inscription possible via mobile OU directement via le portail web (avec email)

### 11.5 Vérification post-suppression

- `grep -r "affiliate\|commission\|referredBy\|referral" backend/src/` → aucun résultat
- `grep -r "affiliateCode\|affiliate" mobile-app/lib/` (pour chacune des 5 apps) → aucun résultat
- `flutter analyze` sur chaque app → 0 erreur
- Test smoke : signup, login, achat sur chaque app → fonctionne sans regression
- Migration BD : drop `affiliates`, `affiliatetypes`, `commissions` ; `User.updateMany({}, { $unset: { referredBy: '' } })`

---

## 12. Phases de mise en place (revues — pas de payouts auto, pas de Branch.io)

| Phase | Contenu | Durée |
|-------|---------|-------|
| **Phase 0** | Wipe complet (backend + 5 apps mobile + admin) + vérification | 3-4 jours |
| **Phase 1** | Backend Foundation : modèles `User.affiliate`, `Referral`, `Commission`, `PayoutRequest`, `AffiliateConfig` + endpoints activate, capture à l'inscription, webhooks de commission auto | 1 sem |
| **Phase 2** | Mobile : nouveau service `AffiliateReferrerService` (Play Install Referrer) + écran activation + dashboard + demande de retrait | 1.5 sem |
| **Phase 3** | Backoffice admin (`bigwin-admin`) : section Affiliation — liste affiliés, configuration, demandes de retrait, validation manuelle + upload preuve | 1 sem |
| **Phase 4** | Portail web `bigwin-affiliate-portal` : signup direct, login, dashboard miroir | 1 sem |
| **Phase 5** | Bonus + marketing kit + mini-CRM (selon priorités) | 1 sem |
| **Phase 6** | Beta avec 20 affiliés triés, itération | 2 sem |

**Total** : ~6-7 semaines.

---

## 13. Décisions verrouillées (toutes finalisées)

### ✅ Architecture & scope
1. **Multi-app** : Option A — 1 compte affilié par app, indépendants
2. **Cross-app** : NON, scope strict per-app
3. **Scope pays** : un affilié ne touche de commission **que sur les filleuls de son pays**. Pays figé à vie au signup (copié depuis `User.countryCode` existant). Mismatch → commission non créée.
4. **Plateforme V1** : Android uniquement, iOS hors scope

### ✅ Inscription affilié
5. Création de compte sans approbation admin, actif immédiatement
6. Inscription possible via app mobile OU portail web `bigwin-affiliate-portal`
7. Cas même email : si l'email matche un User existant → propose Google Sign-In ou magic link set-password
8. **Pas de selector pays au signup** — pays imposé par `User.countryCode` (résolution IP, déjà existant)

### ✅ Tracking
9. Google Play Install Referrer natif (pas de Branch.io/AppsFlyer)
10. Liens Play Store directes avec `?referrer=utm_source=CODE`
11. Nouveau service Flutter `AffiliateReferrerService` — réécrit from scratch (pas de réutilisation de l'ancien)

### ✅ Commissions
12. Configurables depuis le backoffice admin (`AffiliateConfig`) — aucune valeur hardcodée
13. Tiers configurables par admin (CRUD complet, peut démarrer avec 1 seul tier flat)
14. Validation auto dès webhook paiement (pas de review humaine, pas de hold)
15. Refund / chargeback → clawback automatique
16. **Taux démarrage : 15 %** sur le prix du forfait
17. **Recurring V1 : NON** (1 commission par achat). V2 si pertinent.
18. **Cap lifetime par filleul : 3× prix du forfait**
19. **Bonus first win : 500 XAF** (activable, configurable)
20. Visibilité parrainage côté filleul : OUI ("Tu as été parrainé par Mehdi")
21. Bonus filleul (réduction 1ᵉʳ forfait) : NON en V1

### ✅ Payouts AfribaPay (architecture pay-on-demand)
22. **Provider : AfribaPay sortant** (`api-payout.afribapay.com`)
23. **Stratégie pay-on-demand** : pas de pré-financement. Affilié peut s'inscrire dans n'importe quel pays AfribaPay supporté ; au 1ᵉʳ retrait, si "insufficient funds" → admin alerté + alimentation manuelle + retry auto.
24. **Démarrage : Cameroun (CM XAF) seul pays alimenté.** Les 13 autres s'activent on-demand.
25. **Transfert vers AfribaPay** : manuel par l'admin (virement bancaire vers IBAN AfribaPay du pays)
26. **Seuil retrait minimum : 100** (min AfribaPay), pas de seuil métier additionnel
27. **Seuil critique balance AfribaPay** : 50 000 XAF (alerte admin), 10 000 (bloque nouveaux retraits)
28. **Limite anti-abus** : 1 payout en cours max + 2 par mois par affilié (configurable par tier)
29. **Webhook signature** : HMAC SHA-256 vérifiée (rejette 403 si invalide)
30. **Idempotency** : `order_id = payout-${PayoutRequest._id}`
31. **Reconciliation cron** : 15 min sur `processing` sans webhook (uniquement pour récupérer les webhooks perdus)
32. **Pas de retry auto sur `awaiting_funds`** : relance déclenchée uniquement par action admin manuelle dans le backoffice, après alimentation du compte AfribaPay

### ✅ Frontend
33. **2 projets React** : `bigwin-admin` (existant + section Affiliation) + `bigwin-affiliate-portal` (nouveau)
34. Domaine portail à choisir (suggéré `affiliate.bigwin.com`)

### ✅ Anti-fraude V1
35. Checks auto : pays mismatch, self-ref par phone, refund clawback, rate-limit code
36. Pas de scoring complexe ni file de review. Détection a posteriori via dashboard admin.

### ✅ Phase 0 (wipe)
37. Suppression complète de l'ancien système amateur (16 fichiers backend + dispersé dans 5 apps mobile)
38. Aucune réutilisation de code legacy

### ✅ Implémentation
39. **Job worker** : cron Node simple + lock atomique MongoDB (pas de BullMQ pour démarrer)
40. **URL webhook** : `https://api-new.proxidream.com/api/afribapay/payout-webhook`
41. **Compte AfribaPay** : creds prod déjà disponibles (Postman fourni)

### 🟡 Reste à fixer (avant Phase 4)

| # | Item | Action |
|---|------|--------|
| 1 | Domaine portail web | À choisir avant Phase 4 |
| 2 | Variables `.env` AfribaPay | Ajouter au backend : `AFRIBAPAY_API_USER`, `AFRIBAPAY_API_KEY`, `AFRIBAPAY_MERCHANT_KEY`, `AFRIBAPAY_BASE_URL`, `AFRIBAPAY_PAYOUT_URL` |
| 3 | Marketing kit + Mini-CRM + Gamification | Phase 5+ après MVP |

---

## 14. On attaque ?

**Tout est verrouillé.** Toutes les décisions techniques sont prises, toutes les questions tranchées.

**Prochaine étape** : Phase 0 — wipe complet de l'ancien système amateur :
- Backend (`c:/DEV/ROLAND/bigwin v2`) : 16 fichiers à supprimer + 7 fichiers à éditer
- 5 apps mobile : `auth_service.dart`, `auth_provider.dart`, `user_model.dart`, `utm_referrer_service.dart` (bigwin), etc.
- Migration BD : drop `affiliates`, `affiliatetypes`, `commissions` ; nettoyer `User.referredBy`
- Vérification : `grep` clean sur 5 repos + `flutter analyze` 0 erreur + smoke test

Estimation Phase 0 : 3-4 jours.

Ensuite Phase 1 (Foundation backend) puis Phase 2 (mobile MVP), Phase 3 (admin), Phase 4 (portail web), Phase 5 (anti-fraude robuste + payout AfribaPay), Phase 6 (beta).

**Tu valides — j'attaque la Phase 0 maintenant ?**
