# STUDY — Refonte gestion multi-PSP (paiements)

> **Statut** : proposition à valider — aucun code ne sera écrit avant ton GO.
> **Auteur** : Claude, 2026-05-26
> **Contexte** : déclenchée par l'intégration InTouch qui a mis en lumière le manque de scalabilité de la gestion actuelle.

---

## 1. Constat (le problème actuel)

| Symptôme | Fichier | Conséquence |
|---|---|---|
| 8 blocs `payments.<provider>` codés en dur dans le schéma App | `models/common/App.js` | Ajouter un PSP = modifier le schéma + redéployer |
| Champs PSP non normalisés (`apiKey`/`apiPassword`/`secretKey`/`merchantKey`/`basicUser`…) | id. | Pas de validation cross-PSP, pas de chiffrement uniforme, masquage `toJSON` à maintenir à la main |
| `AppConfig.paymentProvider` = string enum | `models/common/AppConfig.js` | Un seul PSP par pays, pas de fallback, pas de A/B, ajouter un PSP = éditer un enum |
| 6 modèles `XxxTransaction` quasi-identiques | `models/user/*Transaction.js` | Duplication code, requêtes cross-PSP impossibles, stats compliquées |
| Chaque `XxxService.js` réimplémente : config-load, validation, error-class, mapStatus, webhook-verify | `services/user/*Service.js` | ~200 LoC dupliquées × 6 = ~1200 LoC, divergence inévitable |
| Pas de notion de priorité / pays-supportés / opérateurs-supportés au niveau intégrateur | partout | Routing pays→PSP fait en dur dans `AppConfig`, pas de fallback automatique |

**Verdict** : architecture qui marche pour 1-2 PSP, qui craque à 8.

---

## 2. Architecture cible (vue 360)

### 2.1. Trois nouvelles collections

```
┌────────────────────────┐
│  PaymentIntegrator     │  ← UNE doc par (app, PSP), remplace App.payments.*
│  ─────────────────     │
│  appId                 │
│  provider     (string) │  ← clé du registry code: 'intouch' | 'cinetpay' | ...
│  label        (string) │  ← affichage BO : "InTouch CMR Proxidream"
│  enabled      (bool)   │
│  priority     (int)    │  ← ordre d'essai (fallback)
│  credentials  (Mixed)  │  ← chiffré at-rest, schéma libre par PSP
│  supportedCountries[]  │  ← ['CM', 'CI', …]
│  supportedCurrencies[] │  ← ['XAF', 'XOF', …]
│  supportedOperators[]  │  ← [{country:'CM', operator:'mtn'}, …]
│  apiUrl                │
│  metadata     (Mixed)  │
└────────────────────────┘

┌────────────────────────┐
│  PaymentRoute          │  ← UNE doc par (app, country), remplace AppConfig.paymentProvider
│  ─────────────────     │
│  appId                 │
│  countryCode           │
│  primary    (ref)      │  → PaymentIntegrator
│  fallbacks  [ref]      │  → [PaymentIntegrator, …]
│  rules     (Mixed)     │  ← ex: { minAmount: 1000, operators: ['mtn'] }
└────────────────────────┘

┌────────────────────────┐
│  Transaction           │  ← UNE collection unifiée, remplace les 6 *Transaction
│  ─────────────────     │
│  appId                 │
│  integrator   (ref)    │  → PaymentIntegrator (identifie le PSP de façon dénormalisée)
│  provider     (string) │  ← copié au moment de la création (immuable même si PSP renommé)
│  transactionId         │  ← notre ID interne
│  providerTransactionId │  ← l'ID externe (variable selon PSP)
│  user, package, amount, currency, status, processed (idempotency)
│  providerData (Mixed)  │  ← payload brut du PSP (debug + audit)
│  timestamps
└────────────────────────┘
```

### 2.2. Registry + interface commune côté code

```
src/payments/
├── registry.js                  ← Map<provider, ProviderModule>
├── PaymentService.js            ← façade : pay() / checkStatus() / handleWebhook()
├── providers/
│   ├── BaseProvider.js          ← interface (classe abstraite ou contrat)
│   ├── intouch.js
│   ├── cinetpay.js
│   ├── afribapay.js
│   └── …
└── transactionService.js        ← CRUD/queries sur la collection Transaction
```

**Contrat `BaseProvider`** (chaque fichier `providers/<name>.js` doit l'implémenter) :

```
async initiate(integrator, { user, package, phoneNumber, operator, amount, currency, callbackUrl }) → { transaction }
async checkStatus(integrator, transaction) → transaction (statut normalisé)
async parseWebhook(integrator, req) → { transactionId, rawStatus }   // jamais d'effet de bord
mapStatus(rawStatus) → 'PENDING' | 'INITIATED' | 'SUCCESS' | 'FAILED' | 'EXPIRED'
validateCredentials(credentials) → throws si invalide
```

**Façade `PaymentService.pay()`** (utilisée par les controllers user) :

```
1. PaymentRoute.findOne({ appId, countryCode })           ← détermine la route
2. tente route.primary
3. en cas d'erreur transitoire → tente route.fallbacks[0], puis [1]…
4. délègue à registry.get(integrator.provider).initiate(integrator, ...)
5. persist Transaction
```

### 2.3. Webhook unifié

Une seule route publique au lieu de N : `POST /api/payments/webhook/:provider`
- Le controller récupère le provider via `registry.get(req.params.provider)`
- Délègue à `provider.parseWebhook(integrator, req)`
- Re-vérifie via `checkStatus` (mitigation absence de signature côté InTouch — pattern déjà adopté)
- Dispatch vers `paymentMiddleware.processTransactionUpdate`

→ ajouter un PSP = **0 modif route**.

---

## 3. Plan de migration (sans rien casser)

| Phase | Durée | Risque | Contenu |
|---|---|---|---|
| **P0 — préparation** | ~1j | nul | Créer `PaymentIntegrator` / `PaymentRoute` / `Transaction` (vides). Ajouter BO "Intégrateurs". |
| **P1 — backfill** | ~1j | nul (idempotent) | Script `scripts/migrate-payments-to-integrators.js` : pour chaque app, lit `app.payments.*` → crée 1 doc `PaymentIntegrator` par PSP enabled. Lit `AppConfig.paymentProvider` → crée 1 doc `PaymentRoute` par pays. **Ne touche pas l'ancien.** |
| **P2 — adapter** | ~1-2j | faible | Chaque `XxxService.js` actuel reçoit une 2ᵉ source de config : si `PaymentIntegrator` existe pour cette app+PSP, on prend celle-là, sinon fallback sur `app.payments.xxx`. Code legacy continue de tourner. |
| **P3 — nouveau registry** | ~2-3j | moyen | Création `src/payments/{registry,PaymentService,providers/*}`. Refacto des controllers user pour appeler `PaymentService.pay()` au lieu d'instancier directement un `XxxService`. |
| **P4 — Transaction unifié** | ~2j | moyen | Backfill : copier toutes les `*Transaction` dans la collection `Transaction` (avec `provider` set). Garder les anciennes en read-only (`processed` figé). |
| **P5 — cleanup** | ~1j | nul si P0-P4 validés | Supprimer `App.payments.*` (devient legacy), supprimer `AppConfig.paymentProvider`, supprimer les 6 modèles `*Transaction`, supprimer les 6 services `*Service.js`. |

**Rollback à chaque phase** : possible jusqu'à P4 inclus, car l'ancien code reste branché. P5 = point de non-retour, on le fait quand P0-P4 sont stables ≥ 2 semaines en prod.

---

## 4. Bénéfices concrets

- **Ajouter un PSP** = 1 fichier `providers/<name>.js` (~100 LoC) + 1 ligne dans le registry. **0 modif schéma**, **0 migration**.
- **Multi-PSP par pays / fallback automatique** — natif via `PaymentRoute.fallbacks`.
- **Stats / reporting cross-PSP** — une seule collection `Transaction` à requêter.
- **BO unifié** — un seul écran "Intégrateurs" avec liste filtrable + form générique (le credentials-schema vient du provider lui-même).
- **Chiffrement at-rest des credentials** — centralisé sur `PaymentIntegrator.credentials` (mongoose plugin `mongoose-encryption` ou `field-encryption`).
- **Tests** — on peut mocker `BaseProvider` une fois pour tous les tests de la façade, au lieu de mocker 6 services indépendants.
- **Doc Swagger** — endpoints `/payments/initiate` / `/payments/webhook/:provider` au lieu de 6 × 3 routes.

---

## 5. Points à valider avec toi avant que je code

1. **Chiffrement des credentials** : `mongoose-encryption` (ajoute une dep, transparent) vs chiffrement manuel via `crypto` à la lecture/écriture ?
2. **Collection `Transaction` unifiée** (P4) : on garde ou on simplifie en gardant les 6 collections séparées pour pas casser les analytics existantes ? Mon avis : on unifie, mais c'est la phase la plus risquée.
3. **`PaymentRoute` ou logique dans le code** : tu préfères que le routing pays→PSP soit dans une collection éditable depuis le BO, ou en dur dans le registry ? Mon avis : collection (plus flexible pour ops).
4. **Périmètre v1** : on refactorise les 6 PSP existants d'un coup, ou bien on commence par migrer juste InTouch + CinetPay et on étend après ? Mon avis : InTouch+CinetPay d'abord (P0-P3 sur 2 PSP), puis on étend.
5. **Branche** : on fait ça sur une branche dédiée `feature/payments-refactor` séparée de `feature/intouch-integration`, ou on l'intègre à la branche InTouch actuelle ? Mon avis : branche séparée, on merge InTouch tel quel d'abord.

---

## 6. Ce qui ne change PAS

- Le `paymentMiddleware.processTransactionUpdate` reste tel quel (`isSuccessful()` / `processed`).
- Le `subscriptionService.createSubscription` reste tel quel.
- Les routes Flutter (`/payments/cinetpay/initiate`, etc.) continuent de fonctionner pendant P0-P4 grâce à l'adapter.
- Aucune modif du back-office tant que les phases ne sont pas livrées.
