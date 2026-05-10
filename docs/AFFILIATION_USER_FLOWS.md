# Système d'affiliation BIGWIN — Flux utilisateurs

> Vue d'ensemble haut niveau. Pour les détails techniques, voir [AFFILIATION_DESIGN.md](AFFILIATION_DESIGN.md).

---

## 1. Vue d'ensemble en un schéma

```
┌──────────────┐   partage      ┌──────────────┐   installe   ┌──────────────┐
│   AFFILIÉ    │ ─────────────> │     LIEN     │ ───────────> │   FILLEUL    │
│ (Mehdi, CM)  │  Play Store    │  unique CODE │  via Store   │ (Sarah, CM)  │
└──────────────┘                └──────────────┘              └──────────────┘
       ▲                                                              │
       │ commission                                                   │ s'abonne
       │  450 XAF                                                     ▼
       │                                                       ┌──────────────┐
       │                                                       │ Subscription │
       │                                                       │   payée      │
       │                                                       └──────────────┘
       │                                                              │
       │   ┌─────────────────────────────────────────────────┐        │
       │   │ Backend : check pays match (CM == CM) ✅        │ <──────┘
       │   │   → crée Commission                             │
       │   │   → notifie l'affilié                           │
       │   └─────────────────────────────────────────────────┘
       │
       │ retrait demandé
       ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  BIGWIN API  │ →│  AfribaPay   │ →│ Mobile money │
│  /payout     │  │   sortant    │  │ Orange / MTN │
└──────────────┘  └──────────────┘  └──────────────┘
```

---

## 2. Les 3 acteurs

| Rôle | Qui | Outils |
|------|-----|--------|
| **Affilié** | Quiconque a un compte mobile + envie de gagner | App mobile + portail web (`affiliate.bigwin.com`) |
| **Filleul** | User normal qui s'inscrit via le lien d'un affilié | App mobile (rien de spécial à savoir) |
| **Admin** | Toi / ton équipe | Backoffice `bigwin-admin` (existant) — section "Affiliation" |

---

## 3. Flux affilié — les 5 cas essentiels

### A. Devenir affilié

```
1. Tap "Gagne de l'argent" dans le menu de l'app
   ↓
2. Écran présentation (3 slides)
   ↓
3. Formulaire : email + numéro mobile money + opérateur
   (le pays est imposé par son IP de signup, pas modifiable)
   ↓
4. Confirm → compte affilié actif IMMÉDIATEMENT
   ↓
5. Code unique BW7K3M2A généré
   Lien Play Store + QR affichés direct
```

⏱ **60 secondes max.** Aucune validation admin.

### B. Partager le lien

```
Tap "Partager mon lien" → share sheet natif
  ↓
WhatsApp / SMS / Telegram / Facebook / etc.
  ↓
Le lien partagé :
https://play.google.com/store/apps/details?id=com.bigwin.app&referrer=utm_source=BW7K3M2A
```

L'affilié peut aussi montrer son **QR code** ou copier le code à dicter à l'oral.

### C. Suivre ses gains en temps réel

Dans l'app ou le portail web, l'affilié voit :

```
┌─────────────────────────────┐
│  💰 Wallet                  │
│  Disponible : 12 500 XAF    │
│  En cours   :    450 XAF    │  ← payouts en traitement
│                             │
│  📊 Ce mois                 │
│  Filleuls actifs : 7        │
│  Commissions    : 3 200 XAF │
│                             │
│  📜 Historique              │
│  • +450 XAF — Sarah, Argent │
│  • +900 XAF — Yves, Or      │
│  • Retrait 8000 XAF ✅      │
└─────────────────────────────┘
```

Notification push à chaque conversion :
> "🎉 Tu as gagné 450 XAF — Sarah s'est abonnée à Argent !"

### D. Demander un retrait

```
1. Balance ≥ 100 XAF (min AfribaPay)
   ↓
2. Tap "Demander un retrait"
   ↓
3. Modal : montant + numéro mobile money pré-rempli
   ↓
4. Confirm
   ↓
5. Backend appelle AfribaPay automatiquement
   ↓
6. ⏱ Quelques minutes plus tard :
   Push notif : "Ton retrait de 12 500 XAF a été envoyé ✅"
   SMS Orange/MTN sur son téléphone avec le crédit
```

**Aucune intervention humaine.** L'affilié n'attend pas l'admin.

### E. Cas spécial — 1ᵉʳ retrait dans un nouveau pays (pay-on-demand + validation admin)

Si un affilié malien demande son 1ᵉʳ retrait alors qu'on n'a pas encore alimenté le compte AfribaPay ML :

```
1. Affilié ML demande retrait 8000 XOF
   ↓
2. AfribaPay refuse → "insufficient funds for ML XOF"
   ↓
3. PayoutRequest passe en "awaiting_funds"
   Une AdminFundingRequest est créée et envoyée à l'admin
   ↓
4. Push à l'affilié : "Ton retrait est en cours de traitement par notre équipe."
   (PAS de bouton réessayer côté affilié)
   ↓
5. Email URGENT à l'admin : "Recharge AfribaPay ML XOF, 8000 en attente"
   ↓
6. Admin alimente le compte AfribaPay (virement bancaire, manuel)
   ↓
7. Admin va dans bigwin-admin → "Demandes de validation"
   → Clique "Valider et relancer" sur la demande
   ↓
8. Backend re-tente AfribaPay avec le solde maintenant dispo
   → AfribaPay accepte → webhook → status: paid
   ↓
9. Push à l'affilié : "Ton retrait a été envoyé ✅"
```

⏱ Environ 24h pour le 1ᵉʳ retrait dans un nouveau pays (le temps que l'admin alimente). **Pas de retry automatique** — chaque relance passe par l'admin. Les retraits suivants dans ce pays sont instantanés tant que le solde reste suffisant.

---

## 4. Flux filleul — totalement transparent

### A. Découvrir l'app via un lien

Cas le plus fréquent :

```
WhatsApp : Mehdi envoie le lien "Salut, essaie BIGWIN ! https://play.google.com/..."
  ↓
Sarah clique → Play Store ouvre la fiche BIGWIN
  ↓
Sarah installe l'app (Play Store stocke le code BW7K3M2A en arrière-plan)
  ↓
Sarah ouvre l'app → onboarding normal
  ↓
Sarah s'inscrit (création compte avec son numéro)
  ↓
L'app envoie automatiquement le code au backend → User.referredBy = Mehdi
```

**Sarah ne voit RIEN de spécial.** L'expérience est identique à un install organique.

### B. Acheter un forfait

```
Sarah achète Pack Argent (3 000 XAF)
  ↓
Webhook paiement reçu côté backend
  ↓
Backend vérifie : Sarah.country (CM) == Mehdi.affiliate.country (CM) ✅
  ↓
Commission créée automatiquement → 450 XAF pour Mehdi
  ↓
Notification temps réel à Mehdi
```

Sarah voit (optionnel) une mention discrète :
> "Tu as été parrainé(e) par Mehdi 🎁"

### C. Cas particulier — Sarah refunde son achat

```
Sarah obtient un refund (rare)
  ↓
Webhook refund → Backend annule la commission liée
  ↓
Push à Mehdi (transparent) :
"La commission de Sarah (450 XAF) a été annulée car son achat a été remboursé"
```

Pas de débat, pas de drama. Le wallet de Mehdi reste cohérent.

### D. Cas de blocage — filleul d'un autre pays

```
Cheikh (Sénégalais, country=SN) clique sur le lien de Mehdi (CM)
  ↓
Cheikh s'inscrit, achète un forfait
  ↓
Backend : SN ≠ CM → SKIP (aucune commission créée)
  ↓
Cheikh utilise normalement l'app
Mehdi voit dans son dashboard : "1 install hors zone (non comptabilisé)"
```

**Cheikh ne sait pas qu'il aurait pu être un filleul.** Pas d'erreur, pas de message. Juste pas de commission.

---

## 5. Côté admin — supervision (dans `bigwin-admin`)

L'admin a une nouvelle section "Affiliation" dans le backoffice existant, avec :

| Page | À quoi ça sert |
|------|----------------|
| **Liste affiliés** | Voir qui sont les top performers, leur tier, leur pays |
| **Surveillance AfribaPay** | Voir les soldes par pays/devise, alertes "balance basse" |
| **PayoutRequests** | Suivre les paiements en cours/échoués/réussis, re-tenter manuellement si besoin |
| **Anti-fraude** | Affiliés suspects (taux de refund élevé, patterns douteux) |
| **Configuration** | Taux de commission, tiers, pays activés, seuils |

L'admin **n'a presque rien à faire au quotidien** — l'automatisation gère tout. Sauf :
- Alimenter manuellement le compte AfribaPay quand un nouveau pays démarre (rare)
- Surveiller les balances pour ne pas être à sec

---

## 6. Récap — qu'est-ce qui rend ce système solide

| Pilier | Comment c'est solide |
|--------|----------------------|
| **Tracking** | Google Play natif (gratuit, fiable, déjà éprouvé chez nous) |
| **Scope pays** | Aucune fuite cross-border possible (check au backend, pas falsifiable) |
| **Commissions** | Auto-validées au webhook (pas de file d'attente humaine) |
| **Payouts** | Auto via AfribaPay (pas de virement manuel, pas de preuve à uploader) |
| **Fraude** | Self-ref impossible (check phone), refund = clawback auto |
| **Configuration** | Tout dans `AffiliateConfig` → admin ajuste sans déploiement |
| **Observabilité** | Audit immuable de chaque transition + dashboard live |

---

## 7. Délais réalistes

| Phase | Quoi | Durée |
|-------|------|-------|
| Phase 0 | Wipe ancien système amateur | 3-4 j |
| Phase 1 | Backend foundation (modèles, endpoints, webhook payment) | 1 sem |
| Phase 2 | Mobile : signup affilié + dashboard + retrait | 1.5 sem |
| Phase 3 | Backoffice admin (section Affiliation) | 1 sem |
| Phase 4 | Portail web `affiliate.bigwin.com` | 1 sem |
| Phase 5 | Intégration AfribaPay payout + webhooks + cron | 1 sem |
| Phase 6 | Beta avec 20 affiliés triés, itération | 2 sem |
| **Total** | | **~7 semaines** |

---

## 8. À retenir en 5 points

1. **Affilié actif en 60 sec**, sans approbation admin
2. **Pays figé à la création**, dérivé de l'IP — un Camerounais ne peut commissionner que sur des Camerounais
3. **Liens Play Store directs** avec `referrer=CODE` — capture native Android
4. **Payouts automatiques** via AfribaPay, pas de virement manuel
5. **Démarrage Cameroun seul**, autres pays s'activent à la demande (pay-on-demand)
