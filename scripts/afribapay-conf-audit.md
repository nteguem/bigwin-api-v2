# Audit conf AfribaPay — local JSON vs API live

Date : 2026-05-13T07:37:00Z
Source live : `GET https://api-new.proxidream.com/api/payments/afribapay/countries` avec `x-app-id: bigwin`
Source local : `data/payments/afribapayData.json`

Pays — local : **15** ; live : **16** ; communs : **15**.

> ⚠️ Le cache du serveur est mutualisé entre apps (pas par tenant). Cet audit reflète la conf vue par le serveur (premier app à avoir tapé /countries) — pour bigwin si `cachedCountries` était vide au moment de l'appel.

---

## 1. Pays présents dans le JSON local mais ABSENTS de la conf live

_(aucun)_

## 2. Pays présents dans AfribaPay LIVE mais ABSENTS du JSON local

| Code | Nom | Devises live |
|---|---|---|
| **CF** 🇨🇫 | Central African Republic | XAF |

→ AfribaPay a ouvert ces pays mais ils ne sont pas dans notre JSON local. L'app ne les propose pas → revenus potentiels perdus.

## 3. Différences par pays (opérateurs ajoutés/retirés, `otp_required` / `wallet` qui ont changé)

### 🇧🇫 BF — Burkina Faso

**Champs qui ont changé :**

| Opérateur (devise) | Local | Live | Diff |
|---|---|---|---|
| `orange` (XOF) | otp=0 wallet=0 | otp=1 wallet=0 | otp_required: 0 → 1 |

**Opérateurs nouveaux côté LIVE, absents du JSON local :**

- `wligdicash` (Wallet LigdiCash, XOF) — otp=1 wallet=1

### 🇧🇯 BJ — Benin

**Opérateurs nouveaux côté LIVE, absents du JSON local :**

- `coris` (Coris Money, XOF) — otp=0 wallet=1

### 🇳🇪 NE — Niger

**Opérateurs nouveaux côté LIVE, absents du JSON local :**

- `wligdicash` (Wallet LigdiCash, XOF) — otp=0 wallet=1


## 4. Récap LIVE complet (référence)

| Pays | Devise | Opérateur | otp_required | wallet |
|---|---|---|---:|---:|
| BF | XOF | moov | 0 | 0 |
| BF | XOF | orange | **1** | 0 |
| BF | XOF | wligdicash | **1** | 1 |
| BJ | XOF | moov | 0 | 0 |
| BJ | XOF | mtn | 0 | 0 |
| BJ | XOF | celtiis | 0 | 0 |
| BJ | XOF | coris | 0 | 1 |
| CD | CDF | airtel | 0 | 0 |
| CD | CDF | mpesa | 0 | 0 |
| CD | CDF | orange | 0 | 0 |
| CD | CDF | afrimoney | 0 | 0 |
| CD | CDF | vodacom | 0 | 0 |
| CF | XAF | orange | 0 | 0 |
| CG | XAF | mtn | 0 | 0 |
| CI | XOF | moov | 0 | 0 |
| CI | XOF | mtn | 0 | 0 |
| CI | XOF | orange | **1** | 0 |
| CI | XOF | wave | 0 | 0 |
| CM | XAF | mtn | 0 | 0 |
| CM | XAF | orange | 0 | 0 |
| CM | XAF | expressunion | 0 | 0 |
| GA | XAF | airtel | 0 | 0 |
| GA | XAF | moov | 0 | 0 |
| GM | GMD | afrimoney | 0 | 0 |
| GN | GNF | mtn | 0 | 0 |
| GN | GNF | orange | **1** | 0 |
| GW | XOF | orange | 0 | 0 |
| ML | XOF | orange | 0 | 0 |
| NE | XOF | airtel | 0 | 0 |
| NE | XOF | wligdicash | 0 | 1 |
| SN | XOF | orange | **1** | 0 |
| SN | XOF | wave | 0 | 0 |
| TD | XAF | airtel | 0 | 0 |
| TD | XAF | moov | 0 | 0 |
| TG | XOF | moov | 0 | 0 |
| TG | XOF | tmoney | 0 | 0 |
