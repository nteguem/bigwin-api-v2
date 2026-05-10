# Plan d'implémentation — Système d'affiliation BIGWIN

> Plan détaillé pas à pas. Chaque étape est livrable indépendamment et testable.
> On avance étape par étape, validation utilisateur à chaque livraison.

---

## Vue d'ensemble — 6 phases

| Phase | Contenu | Durée | Livrables |
|-------|---------|-------|-----------|
| **0** | Wipe ancien système | 3-4 j | Backend + 5 mobile + admin clean, BD migrée |
| **1** | Backend foundation | 1 sem | Modèles + endpoints + intégration paiement |
| **2** | Mobile (5 apps) | 1.5 sem | Capture referrer + signup + dashboard + retrait |
| **3** | Admin backoffice | 1 sem | Section Affiliation dans bigwin-admin |
| **4** | Portail web affiliés | 1 sem | bigwin-affiliate-portal |
| **5** | Intégration AfribaPay | 1 sem | Service + worker + webhook + reconciliation |
| **6** | Beta + ajustements | 2 sem | Beta 5-10 affiliés + monitoring |

**Total réaliste : ~7 semaines** (1 dev temps plein).

---

# 📋 Phase 0 — Wipe complet (3-4 jours)

> Suppression totale de l'ancien système amateur. Aucune réutilisation.

## Étape 0.1 — Audit + checklist
- Cataloguer chaque fichier à supprimer / éditer / conserver
- Lister les routes à virer du `routes/index.js`
- Lister les imports cassés à corriger
- Sauvegarder la BD avant migration (snapshot Mongo)

**Livrable** : checklist exhaustive validée par toi.

## Étape 0.2 — Backend — suppression des 16 fichiers
- `src/api/routes/affiliate/` (entier)
- `src/api/routes/admin/affiliateRoutes.js`
- `src/api/routes/admin/affiliateTypeRoutes.js`
- `src/api/routes/admin/commissionRoutes.js`
- `src/api/controllers/affiliate/` (3 fichiers)
- `src/api/controllers/admin/affiliateController.js`, `affiliateTypeController.js`, `commissionController.js`
- `src/api/middlewares/affiliate/affiliateAuth.js`
- `src/api/services/affiliate/dashboardService.js`
- `src/api/services/admin/affiliateManagementService.js`
- `src/api/models/affiliate/Affiliate.js`, `AffiliateType.js`
- `src/api/models/common/Commission.js`

**Livrable** : `git status` montre les suppressions, le serveur **ne démarre plus** (références cassées attendues).

## Étape 0.3 — Backend — édition des 7 fichiers de référence
- `User.js` : retirer `referredBy` + index
- `routes/index.js` : retirer imports + 6 lignes `router.use()`
- `authService.js` : retirer `validateAffiliateCode()` + références
- `authController.js` : retirer paramètre `affiliateCode` du `register()`
- `subscriptionService.js` : retirer création commission au paiement
- `googleAuthService.js` : retirer validation `affiliateCode`
- `multiAuth.js` : retirer méthode `adminOrAffiliate()`

**Livrable** : `node -e "require('./src/api/routes')"` charge sans erreur. Smoke test `npm start` OK.

## Étape 0.4 — Migration BD
```js
// Drop des collections legacy
db.affiliates.drop();
db.affiliatetypes.drop();
db.commissions.drop();

// Cleanup champ User.referredBy
db.users.updateMany({}, { $unset: { referredBy: '' } });
```

**Livrable** : 0 doc dans `affiliates`, `affiliatetypes`, `commissions`. 0 user avec `referredBy`.

## Étape 0.5 — Mobile bigwin
- Nettoyer `auth_service.dart`, `auth_provider.dart`, `api_auth_service.dart`
- Nettoyer `user_model.dart` (retirer `affiliateCode` 8 occurrences)
- Nettoyer `auth_guard.dart`, `app_config.dart`, `app_*.arb`
- **Supprimer** `utm_referrer_service.dart` + `storage_service.dart` (méthodes liées)
- Régénérer l10n

**Livrable** : `flutter analyze` 0 erreur, smoke test signup/login OK.

## Étape 0.6 — Mobile good_tips, goat_tips, strategy_tips, wise_tips
- Dans chaque app : nettoyer `auth_service.dart` + `auth_provider.dart` (retirer paramètre `affiliateCode`)
- Audit `grep` final dans chaque repo

**Livrable** : 4 apps clean, `flutter analyze` 0 erreur sur chacune.

## Étape 0.7 — Admin
- Vérifier qu'aucune référence affiliée ne traîne dans `bigwin-admin`
- Suppression cleanup si reste

**Livrable** : `grep -r "affiliate\|commission\|referredBy" bigwin-admin/src/` → vide.

## Étape 0.8 — Vérification finale
- `grep -r "affiliate\|commission\|referredBy\|referral" backend/src/` → vide
- `flutter analyze` sur les 5 apps → 0 erreur
- Smoke test : signup, login, achat sur chaque app → OK
- Backend : `npm start` + curl `/api/auth/register` → OK

**Livrable** : feu vert pour Phase 1.

---

# 📋 Phase 1 — Backend foundation (1 semaine)

> Modèles + endpoints. AfribaPay arrive en Phase 5.

## Étape 1.1 — Schéma `User.affiliate`
- Ajouter sous-doc `affiliate: { isActive, code, tier, country, payoutMethod, activatedAt, suspended }`
- Index unique sur `(appId, affiliate.code)`
- Helper `User.generateAffiliateCode()` (8 chars random `[A-Z0-9]`)

**Livrable** : User.js mis à jour, test unitaire création/lecture OK.

## Étape 1.2 — Modèles `Referral`, `Commission`, `PayoutRequest`, `AffiliateConfig`, `AdminFundingRequest`
- Schémas complets selon doc design
- Indexes (`appId+user`, `appId+referrer`, `appId+status`)
- Hooks `pre-save` pour validation

**Livrable** : 5 modèles créés, tests unitaires CRUD OK.

## Étape 1.3 — Endpoints affilié (auth user)
```
POST   /api/auth/affiliate/activate       → upgrade User en affilié
GET    /api/auth/affiliate/me             → état + stats
PATCH  /api/auth/affiliate/payout-method  → update mobile money
GET    /api/auth/affiliate/link           → URL Play Store + QR (data URI)
GET    /api/auth/affiliate/referrals      → liste filleuls anonymisés
GET    /api/auth/affiliate/commissions    → historique
POST   /api/auth/affiliate/payout/request → crée PayoutRequest queued
GET    /api/auth/affiliate/payout/list    → historique retraits
```

**Livrable** : endpoints fonctionnels via Postman, JWT user requis.

## Étape 1.4 — Capture du code à l'inscription user
- Modifier `authService.register()` pour accepter `affiliateCode` optionnel
- Validation : code existe + actif + même appId
- Création de `Referral` lié + `User.referredBy`
- Check pays : `User.countryCode === affilié.country` (sinon `Referral.status='country_mismatch'`)

**Livrable** : signup avec/sans `affiliateCode` testé, doc `Referral` créé, mismatch loggé.

## Étape 1.5 — Hook webhook payment → création Commission
- Modifier `paymentMiddleware.handleSuccessfulTransaction()` :
  - Si `User.referredBy` existe ET `Referral.status === 'signed_up'` (pas mismatch) :
    - Charger `AffiliateConfig` de l'app
    - Calculer commission = `subscription.amount × tier.commissionRate / 100`
    - Apply cap `lifetimeCapMultiplier × packagePrice` par filleul
    - Check self-ref (phone) → cancelled
    - Créer Commission `status: 'available'`
    - Push notif à l'affilié

**Livrable** : achat d'un filleul → Commission créée + notif reçue par affilié.

## Étape 1.6 — Hook webhook refund → clawback
- Si webhook refund pour transaction qui a généré une Commission :
  - `Commission.status: 'available' | 'locked'` → `'cancelled'`
  - Si `'paid'` → flag `requires_manual_review` + alerte admin

**Livrable** : refund testé, commission annulée auto.

## Étape 1.7 — Endpoints admin (section Affiliation)
```
GET    /api/admin/affiliates                           → liste
GET    /api/admin/affiliates/:userId                   → détail
POST   /api/admin/affiliates/:userId/suspend           → suspendre
POST   /api/admin/affiliates/:userId/unsuspend
GET    /api/admin/payout-requests                      → liste
POST   /api/admin/payout-requests/:id/retry            → relance manuelle
POST   /api/admin/payout-requests/:id/cancel           → annulation
GET    /api/admin/funding-requests                     → demandes awaiting_funds
POST   /api/admin/funding-requests/:id/validate        → relance après alimentation
GET    /api/admin/affiliate-config                     → config courante
PATCH  /api/admin/affiliate-config                     → update tiers/taux
GET    /api/admin/afribapay/balance                    → balance live
```

**Livrable** : endpoints fonctionnels, JWT admin requis, scope par app.

## Étape 1.8 — Tests d'intégration
- Suite de tests E2E : signup avec ref code → achat → commission → demande retrait → admin valide
- Mocks AfribaPay (la vraie intégration arrive en Phase 5)

**Livrable** : suite tests passante, couverture > 70 % sur les services affiliation.

---

# 📋 Phase 2 — Mobile (1.5 semaine, 5 apps)

> Architecture cohérente sur les 5 apps. Code partagé autant que possible (à voir si on factorise).

## Étape 2.1 — Service `AffiliateReferrerService` (par app)
- Nouveau fichier `lib/shared/services/affiliate_referrer_service.dart`
- Capture Play Install Referrer (lib `play_install_referrer`)
- Parse `utm_source=`, regex `^[A-Z0-9]{8}$` → stocke comme `affiliateCode`
- Stockage SharedPreferences clé dédiée `affiliate_code_captured`

**Livrable** : appel au boot, log "code capturé: XXX" si install via lien.

## Étape 2.2 — Modèle Affiliate Flutter (par app)
- `lib/shared/models/affiliate.dart` : classe Affiliate (code, tier, country, balance, etc.)
- `lib/shared/models/referral.dart`, `commission.dart`, `payout_request.dart`
- `fromJson` / `toJson`

**Livrable** : modèles testés (sérialisation OK).

## Étape 2.3 — Provider Riverpod (par app)
- `lib/shared/providers/affiliate_provider.dart` :
  - `myAffiliateProvider` (FutureProvider) → `/auth/affiliate/me`
  - `referralsProvider`, `commissionsProvider`, `payoutsProvider`
  - `activateAffiliateMutation`, `requestPayoutMutation`
- Refresh on demand + invalidation après mutation

**Livrable** : providers testés via mock API.

## Étape 2.4 — Écran "Devenir affilié" (par app)
- Route `/affiliate/activate` (ou modal)
- 3 slides présentation
- Form : email + numéro mobile money + opérateur
- Submit → activate → redirige vers dashboard

**Livrable** : signup affilié fonctionnel, code généré affiché.

## Étape 2.5 — Écran "Affiliate Hub" (dashboard)
- Tab "Wallet" : balance + bouton "Demander retrait"
- Tab "Mon lien" : code + lien + QR + bouton partager
- Tab "Filleuls" : liste anonymisée
- Tab "Commissions" : historique

**Livrable** : 4 tabs fonctionnels, données live depuis API.

## Étape 2.6 — Capture code à l'inscription user
- Sur l'écran de signup user, ajouter champ "Code de parrainage (optionnel)" :
  - Pré-rempli depuis `AffiliateReferrerService` si capturé
  - Modifiable manuellement
- POST `/auth/register` avec `affiliateCode`

**Livrable** : install via lien → code auto-rempli + envoyé au backend.

## Étape 2.7 — Bouton "Partager" + QR code
- Action share native (Share.share)
- QR code généré côté backend (PNG dataURI)

**Livrable** : tap "Partager" ouvre share sheet avec lien + texte pré-rempli.

## Étape 2.8 — Notifications push affiliation
- Listener OneSignal dédié pour push affiliation (gain commission, retrait paid/failed, awaiting_funds)
- Deep link vers l'écran approprié

**Livrable** : push reçu = navigation correcte.

---

# 📋 Phase 3 — Admin backoffice (1 semaine)

> Section "Affiliation" dans bigwin-admin, scopée par app via le selector existant.

## Étape 3.1 — Setup section Affiliation
- Item "Affiliation" dans le menu sidebar
- Sous-pages : Liste affiliés / Demandes de retrait / Demandes de validation / Configuration / Anti-fraude

**Livrable** : navigation OK, pages vides initialement.

## Étape 3.2 — Liste & détail affiliés
- Table avec recherche, filtres (tier, statut, pays), tri
- Détail : profile, commissions, retraits, filleuls
- Actions : suspendre, unsuspend

**Livrable** : page Liste fonctionnelle.

## Étape 3.3 — Surveillance balance AfribaPay
- Card par pays/devise avec solde live (refresh manuel + auto toutes les heures)
- Indicateurs visuels (vert/orange/rouge selon seuils)
- Bouton "Voir l'IBAN AfribaPay" pour le pays (info recharge)

**Livrable** : balance affichée live.

## Étape 3.4 — Demandes de retrait
- Liste filtrable par statut
- Détail avec audit trail
- Action manuelle : "Re-tenter" (cas error réseau), "Annuler"

**Livrable** : queue retraits fonctionnelle.

## Étape 3.5 — Demandes de validation (`AdminFundingRequest`)
- Liste des `awaiting_funds` à traiter
- Bouton "Valider et relancer" → re-tente AfribaPay
- Bouton "Rejeter" (raison obligatoire)

**Livrable** : workflow validation admin fonctionnel.

## Étape 3.6 — Configuration affiliation
- Form CRUD pour `AffiliateConfig` (taux, tiers, pays, seuils)
- Toggle activation par pays (sync `/v1/countries` AfribaPay)

**Livrable** : admin peut tout configurer sans toucher au code.

## Étape 3.7 — Anti-fraude dashboard
- Liste affiliés à investiguer (refund rate, country mismatch, etc.)
- Action suspendre

**Livrable** : page anti-fraude fonctionnelle.

---

# 📋 Phase 4 — Portail web affiliés (1 semaine)

> Nouveau projet React `bigwin-affiliate-portal`.

## Étape 4.1 — Setup projet
- `bigwin-affiliate-portal` (Vite + React + Tailwind)
- Structure routing, theme cohérent avec bigwin-admin

**Livrable** : projet initialisé, build OK.

## Étape 4.2 — Auth
- Login email + mot de passe
- Cas même email user mobile : Google Sign-In ou magic link
- Selector app au signup

**Livrable** : auth fonctionnelle.

## Étape 4.3 — Dashboard miroir mobile
- Mêmes données que mobile, mais layout desktop
- Graphes (Chart.js / Recharts)

**Livrable** : dashboard live.

## Étape 4.4 — Mon lien + QR + assets
- Affichage lien + QR HD téléchargeable
- Bouton "Copier"

**Livrable** : zone partage fonctionnelle.

## Étape 4.5 — Historique
- Tables paginées des commissions et retraits
- Export CSV

**Livrable** : historique consultable.

## Étape 4.6 — Demande de retrait
- Modal avec montant + opérateur + numéro
- Submit → statut affiché en temps réel

**Livrable** : demande de retrait fonctionnelle depuis web.

---

# 📋 Phase 5 — Intégration AfribaPay (1 semaine)

> La phase la plus technique. À faire en sandbox d'abord.

## Étape 5.1 — Service `AfribaPayService` backend
- Singleton avec token cache (TTL 23h)
- Méthodes : `triggerPayout`, `getStatus`, `getBalance`, `verifyWebhookSignature`
- HTTP client avec timeout 15s + retry x3 sur erreur réseau

**Livrable** : service testé en sandbox AfribaPay (payout test phone numbers).

## Étape 5.2 — Worker payout
- Cron Node toutes 30s + lock atomique MongoDB (`findOneAndUpdate`)
- Pickup `PayoutRequest.status === 'queued'`
- Appel AfribaPay → save response → transition status

**Livrable** : worker testé bout en bout (queued → processing en sandbox).

## Étape 5.3 — Webhook AfribaPay
- Endpoint `POST /api/afribapay/payout-webhook`
- Vérification HMAC SHA-256
- Traitement transition (paid / failed / awaiting_funds)
- Idempotent (dédoublonnage par order_id)

**Livrable** : webhook reçu en sandbox → transition correcte.

## Étape 5.4 — Cron de réconciliation
- Toutes les 15 min, query AfribaPay /v1/status pour les `processing` orphelins

**Livrable** : payout sans webhook → réconcilié dans les 15 min.

## Étape 5.5 — Cron surveillance balance
- Toutes les 4h, query AfribaPay /v1/balance
- Alerte admin si seuil critique atteint
- Bloque nouveaux payouts si seuil bloquant

**Livrable** : alerte testée (descendre artificiellement le solde sandbox).

## Étape 5.6 — Bascule sandbox → production
- Update `.env` avec creds prod
- Recharge initiale AfribaPay CM XAF (manuel)
- Test payout réel petit montant (100 XAF)

**Livrable** : 1er payout réel reçu sur ton mobile money.

---

# 📋 Phase 6 — Beta + ajustements (2 semaines)

## Étape 6.1 — Documentation utilisateur
- FAQ affiliés (gains, conditions, retraits)
- Conditions générales du programme
- Page d'accueil bigwin-affiliate-portal qui explique tout

**Livrable** : docs publiées sur le portail.

## Étape 6.2 — Beta privée 5-10 affiliés
- Sélectionner des users actifs CM
- Activer leur compte affilié manuellement
- Suivi étroit de leurs actions (logs détaillés)

**Livrable** : 5-10 affiliés actifs avec retours.

## Étape 6.3 — Monitoring
- Dashboard métriques temps réel (conversions, payouts, taux fraude)
- Alertes Slack / email pour anomalies

**Livrable** : dashboard prêt pour ouverture publique.

## Étape 6.4 — Ouverture publique
- Mise en avant dans l'app mobile (banner "Gagne avec nos amis")
- Annonce sur les réseaux

**Livrable** : programme ouvert à tous.

---

# 🎯 Comment on avance

À chaque étape :

1. **Avant** : je te résume ce que je vais faire
2. **Pendant** : j'implémente + push code (avec dry-run en BD si applicable)
3. **Après** : je te montre les livrables (curl test, screenshot, log)
4. **Validation** : tu valides → on passe à l'étape suivante. Tu ajustes → on itère.

Tu peux à tout moment :
- Mettre en pause pour tester en condition réelle
- Demander un changement de spec (on documente, on ajuste)
- Skip une étape si pas urgent (ex: anti-fraude advanced)

---

# ▶️ Démarrage immédiat

**Quand tu dis "go Phase 0 étape 0.1"**, je commence par :
1. Audit + checklist exhaustive des fichiers à toucher
2. Backup BD recommandé (snapshot Mongo) — je te dis comment faire
3. Présenter la checklist pour validation avant tout `rm`

Aucun code supprimé sans ton OK. On y va ?
