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

L'objectif n'est pas un "petit programme de parrainage". C'est de **transformer chaque user satisfait en commercial actif**, avec un produit affilié digne d'une plateforme SaaS sérieuse (équivalent Dropbox, Shopify, Spotify Premium).

5 piliers :

1. **Architecture clean** : un user devient affilié en 1 tap, pas un compte parallèle
2. **Tracking ultra-précis** : deep links + attribution multi-touch, fini les "j'ai oublié de taper le code"
3. **Programme rémunérateur et progressif** : tiers dynamiques, commission récurrente capée, bonus de performance
4. **Affilié hub mobile premium** : dashboard temps réel, marketing kit prêt à partager, mini-CRM
5. **Anti-fraude + payouts automatisés** : device fingerprinting, mobile money sortant, chargeback handling

Délai estimé : **6 semaines** pour l'ensemble (1 dev temps plein), dont 1 semaine de wipe + foundation.

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

### 3.2 Modèles core (nouveaux)

```
User { ..., affiliate: { isActive, code, tier, payoutMethod, ... } }

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

## 8. Payouts — workflow 100 % manuel par l'admin

> **Décision** : pas d'API mobile money sortant, pas d'automatisation. L'admin reçoit la demande, fait le virement à la main (mobile money / banque), upload une preuve d'envoi, marque le payout comme effectué. Simple, transparent, contrôlable.

### 8.1 Modèle `PayoutRequest`

```
PayoutRequest {
  appId,
  user,                              // affilié qui demande
  amount, currency,
  method: 'mobile_money' | 'bank_transfer' | 'other',
  destination: {                     // remplie par l'affilié à la demande
    mobileMoneyNumber, mobileMoneyOperator,  // si mobile_money
    bankName, bankAccountName, bankAccountNumber, bankRib,  // si bank_transfer
  },
  status: 'requested' | 'approved' | 'processing' | 'paid' | 'rejected',
  commissionsIncluded: [ObjectId],   // les Commission agrégées dans ce payout
  requestedAt,
  processedAt,
  paidAt,
  proofUrl,                          // upload S3 / local — capture du virement
  adminNote,
  rejectionReason,
}
```

### 8.2 Flow côté affilié (mobile)

1. Affilié ouvre l'onglet **Wallet** dans son hub
2. S'il a une balance disponible ≥ seuil configuré (ex: 5 000 XAF), il voit le bouton "Demander un retrait"
3. Tap → modal avec :
   - Montant à retirer (par défaut = balance dispo, modifiable)
   - Méthode : `Mobile money` ou `Virement bancaire`
   - Champs correspondants (numéro mobile money + opérateur, ou RIB)
4. Confirm → `PayoutRequest` créé en statut `requested`
5. Push notif à l'affilié : "Ta demande de retrait de X XAF a bien été enregistrée. Délai indicatif : sous 7 jours."
6. L'affilié peut suivre le statut dans son historique de retraits

### 8.3 Flow côté admin (backoffice)

1. **Tab "Demandes de retrait"** dans le backoffice — liste des `PayoutRequest` triées par ancienneté
2. Clic sur une demande → écran de détail :
   - Infos affilié (nom, téléphone, app)
   - Montant + devise
   - Méthode + coordonnées de paiement (visible en clair pour faire le virement)
   - Liste des commissions incluses (vérifiable)
3. Boutons :
   - **Approuver** → statut passe à `approved` (ou `processing`) — débite le wallet de l'affilié (commissions passent en `paid` côté commission, mais le PayoutRequest reste en `processing`)
   - **Rejeter** → statut `rejected` avec raison obligatoire — réintègre les commissions au wallet
4. L'admin fait le virement à la main (mobile money ou banque) **hors plateforme**
5. Une fois le virement effectué, l'admin :
   - Upload la **preuve de paiement** (screenshot du SMS mobile money / reçu bancaire)
   - Optionnel : saisie d'une référence (numéro de transaction)
   - Marque comme **`paid`**
6. Push notif à l'affilié : "Ton retrait de X XAF a été envoyé. Preuve disponible dans ton historique."

### 8.4 Threshold (seuil minimum)

Configurable par app dans `AffiliateConfig.payoutThreshold`. Défaut suggéré : **5 000 XAF** (ou équivalent).

Affichage côté affilié : "Plus que X pour pouvoir retirer."

### 8.5 Statut wallet — cycle de vie

```
Webhook paiement filleul reçu   → Commission créée + status: available (immédiat)
Self-ref détecté (même phone)   → status: cancelled (auto, pas de validation humaine)
Webhook refund / chargeback     → status: cancelled (auto)
Incluse dans PayoutRequest      → status: locked (en cours de retrait)
PayoutRequest marqué paid       → status: paid
PayoutRequest rejected          → status: available (réintégrée au wallet)
```

> **Décision-clé** : la **commission est créée et validée automatiquement** dès la réception du webhook de paiement réussi. Pas de "review anti-fraude" qui hold les commissions, pas d'attente d'admin. Le seul moment où l'humain intervient, c'est pour **valider le payout** (le retrait de cash demandé par l'affilié).

**Pas d'auto-virement.** Mais validation auto des commissions. L'admin pilote uniquement la sortie d'argent.

---

## 9. Admin power tools

### 9.1 Dashboard live

- Top 20 affiliés du mois
- Funnel temps réel : clics → installs → signups → convertis
- Heatmap géographique des conversions
- LTV moyen par affilié (qualité, pas seulement quantité)
- Alerts en bandeau rouge si fraud rate > seuil

### 9.2 Anti-fraud queue

- Liste des commissions flaggées
- Détail signaux + score
- 3 boutons : Approve, Reject, Investigate
- Bulk actions

### 9.3 Payout queue

- Liste des demandes de payout en attente
- Bouton "Process all eligible" (1 clic → traite toute la queue auto-validable)
- Manual override pour cas spéciaux

### 9.4 Config

- Taux de commission par tier × par app
- Threshold payout par app/devise
- Activation/désactivation par app
- Custom rates par campagne (ex: code spécial influenceur à 30 %)

### 9.5 Analytics export

- CSV des commissions par mois (pour la compta)
- Stats par affilié (pour évaluer top performers et leur proposer Elite/Legend)

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

### 10.4 Mehdi demande son retrait

1. Balance disponible : 12 500 XAF (au-dessus du seuil 5 000)
2. Sur mobile OU portail web : "Demander un retrait"
3. Choisit méthode (mobile money) + montant + confirme
4. `PayoutRequest` créé en statut `requested`
5. Push à Mehdi : "Ta demande de 12 500 XAF est enregistrée. Délai indicatif sous 7 jours."

### 10.5 L'admin traite le retrait

1. Admin ouvre `bigwin-admin` → section Affiliation → Demandes de retrait → voit la demande de Mehdi
2. Vérifie les coordonnées (numéro mobile money + opérateur)
3. Approuve la demande → wallet de Mehdi débité, commissions passent en `locked`
4. **Hors plateforme** : admin ouvre son app Mobile Money / banque, fait le virement de 12 500 XAF
5. Retourne dans le backoffice :
   - Upload la **preuve d'envoi** (screenshot du SMS confirmation mobile money)
   - Saisit la référence transaction (optionnel)
   - Marque comme `paid`
6. Push à Mehdi : "Ton retrait de 12 500 XAF a été envoyé ✅. Preuve disponible dans ton historique."

### 10.6 Sarah refunde son achat — clawback auto

1. Sarah obtient un refund (chargeback ou demande validée)
2. Webhook refund → backend détecte la commission liée
3. Si commission encore `available` ou `locked` → passe à `cancelled`
4. Si commission déjà `paid` → flag pour reconciliation manuelle (rare)
5. Notif transparente à Mehdi : "La commission de Sarah (450 XAF) a été annulée car son achat a été remboursé"
4. Notification push à Mehdi (transparente) : "La commission de Sarah (300 XAF) a été annulée car son achat a été remboursé"
5. Pas de drama, balance reste cohérent

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

## 13. Décisions verrouillées et questions restantes

### ✅ Décisions verrouillées

1. **Architecture multi-app** : Option A — 1 compte affilié par app, totalement indépendants
2. **Tracking** : Google Play Install Referrer natif (pas de Branch.io/AppsFlyer)
3. **Liens** : URL Play Store directes avec `?referrer=utm_source%3DCODE`
4. **Plateforme V1** : **Android uniquement**, iOS hors scope
5. **Commissions** : 100 % configurables depuis le backoffice admin (`AffiliateConfig`) — pas hardcodées
6. **Tiers** : configurables par admin (CRUD complet — peut démarrer avec 1 seul tier flat puis évoluer)
7. **Validation des commissions** : **automatique** dès la réception du webhook de paiement réussi. Pas de review humaine, pas de hold.
8. **Payouts** : 100 % manuels — l'affilié demande, l'admin valide + vire à la main + upload preuve
9. **Création de compte affilié** : pas d'approbation admin, actif immédiatement
10. **Inscription affilié** : possible via app mobile OU directement via le portail web `bigwin-affiliate-portal` (avec même email géré proprement)
11. **2 projets React** : `bigwin-admin` (existant, ajout section Affiliation) + `bigwin-affiliate-portal` (nouveau)
12. **Cross-app** : NON, scope strict per-app
13. **Anti-fraude V1** : checks auto basiques (self-ref par phone, refund clawback). Pas de scoring complexe.

### 🟡 Questions restantes à trancher (paramètres business)

| # | Question | Proposition par défaut |
|---|----------|------------------------|
| 1 | Taux de commission de démarrage (configurable, juste la valeur initiale) | **15 %** sur le prix du forfait |
| 2 | Recurring commissions activées dès le début ? | **Non** — 1 commission par achat. Le recurring sera ajouté en V2 si pertinent |
| 3 | Cap commission lifetime par filleul | **3× prix du forfait** (ex: forfait 3 000 XAF → max 9 000 XAF par filleul) |
| 4 | Threshold payout par défaut | **5 000 XAF** (configurable par app et devise) |
| 5 | Bonus first win | **500 XAF** (activé par défaut, désactivable dans la config) |
| 6 | Visibilité du parrainage côté filleul | **OUI** ("Tu as été parrainé par Mehdi" → social proof) |
| 7 | Bonus filleul (réduction sur 1ᵉʳ forfait) | **Non en V1** — ajout V2 si conversion à booster |
| 8 | Marketing kit (templates WhatsApp pré-faits) | **Phase 5** (après MVP) |
| 9 | Mini-CRM filleuls avec relance | **Phase 5** |
| 10 | Gamification (leaderboard, badges) | **Plus tard** (V2) |
| 11 | Domaine du portail web | À choisir — `affiliate.bigwin.com` ou autre |

---

## 14. Décision

> Tes 7 décisions clés sont verrouillées. Pour les 11 questions restantes, je propose les valeurs par défaut ci-dessus. Tu valides en bloc ou tu ajustes points par points.

**Prochaine étape proposée** : tu valides les 11 défauts (ou tu en ajustes), et j'écris les specs détaillées de la Phase 0 (wipe) + Phase 1 (foundation MVP). On attaque ensuite l'implémentation.

Phase 1 cible : **MVP fonctionnel basique** — un user devient affilié, partage son lien Play Store, capture du code à l'install (Android), commission créée à l'achat, demande de retrait, admin valide manuellement. ≈ 2 semaines.
