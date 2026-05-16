# Diagnostic AfribaPay — initiate COMPLET (tous les combos live)

Date : 2026-05-13T07:55:37Z
Backend : `https://api-new.proxidream.com`  |  App : `bigwin`
User : `(no email)` (`67da8f422bf53554f3511181`)
Package : `Coup sur du jour` (`68e101915d973384fd8350ad`)
Combos testés : **36** sur **16** pays live

---

## 1. Synthèse globale

| Pays | Opérateur | Devise | OTP | Wallet | Phone | HTTP | Code erreur | Verdict |
|---|---|---|---:|---:|---|---:|---|---|
| 🇧🇫 BF | `moov` | XOF | 0 | 0 | `04407608` (past tx) | 201 | — | ✅ 201 initiée |
| 🇧🇫 BF | `orange` | XOF | 1 | 0 | `22656180795` (past tx) | 400 | OTP_REQUIRED | 🔑 OTP requis |
| 🇧🇫 BF | `wligdicash` | XOF | 1 | 1 | `22654617321` (past tx) | 400 | OTP_REQUIRED | 🔑 OTP requis |
| 🇧🇯 BJ | `moov` | XOF | 0 | 0 | `2290163673745` (past tx) | 201 | — | ✅ 201 initiée |
| 🇧🇯 BJ | `mtn` | XOF | 0 | 0 | `2290166853000` (past tx) | 201 | — | ✅ 201 initiée |
| 🇧🇯 BJ | `celtiis` | XOF | 0 | 0 | `2290148518991` (past tx) | 201 | — | ✅ 201 initiée |
| 🇧🇯 BJ | `coris` | XOF | 0 | 1 | `2290148727150` (past tx) | 404 | AFRIBAPAY_ERROR | ⚠️ 404 |
| 🇨🇩 CD | `airtel` | CDF | 0 | 0 | `243983569790` (past tx) | 201 | — | ✅ 201 initiée |
| 🇨🇩 CD | `mpesa` | CDF | 0 | 0 | `829022686` (past tx) | 201 | — | ✅ 201 initiée |
| 🇨🇩 CD | `orange` | CDF | 0 | 0 | `899736959` (past tx) | 201 | — | ✅ 201 initiée |
| 🇨🇩 CD | `afrimoney` | CDF | 0 | 0 | `961076265` (past tx) | 201 | — | ✅ 201 initiée |
| 🇨🇩 CD | `vodacom` | CDF | 0 | 0 | `820444978` (past tx) | 201 | — | ✅ 201 initiée |
| 🇨🇬 CG | `mtn` | XAF | 0 | 0 | `064645549` (past tx) | 201 | — | ✅ 201 initiée |
| 🇨🇲 CM | `mtn` | XAF | 0 | 0 | `678086139` (past tx) | 201 | — | ✅ 201 initiée |
| 🇨🇲 CM | `orange` | XAF | 0 | 0 | `694751162` (past tx) | 201 | — | ✅ 201 initiée |
| 🇨🇲 CM | `expressunion` | XAF | 0 | 0 | `237674683606` (past tx) | 404 | AFRIBAPAY_ERROR | ⚠️ 404 |
| 🇬🇦 GA | `airtel` | XAF | 0 | 0 | `077473799` (past tx) | 201 | — | ✅ 201 initiée |
| 🇬🇦 GA | `moov` | XAF | 0 | 0 | `066335634` (past tx) | 201 | — | ✅ 201 initiée |
| 🇬🇲 GM | `afrimoney` | GMD | 0 | 0 | `2203016537` (past tx) | 401 | AFRIBAPAY_ERROR | ⚠️ 401 |
| 🇬🇳 GN | `mtn` | GNF | 0 | 0 | `224663560629` (past tx) | 201 | — | ✅ 201 initiée |
| 🇬🇳 GN | `orange` | GNF | 1 | 0 | `224626511544` (past tx) | 400 | OTP_REQUIRED | 🔑 OTP requis |
| 🇲🇱 ML | `orange` | XOF | 0 | 0 | `79475204` (past tx) | 201 | — | ✅ 201 initiée |
| 🇳🇪 NE | `airtel` | XOF | 0 | 0 | `22798884563` (past tx) | 201 | — | ✅ 201 initiée |
| 🇹🇩 TD | `airtel` | XAF | 0 | 0 | `23569774659` (past tx) | 201 | — | ✅ 201 initiée |
| 🇹🇩 TD | `moov` | XAF | 0 | 0 | `23586863628` (past tx) | 406 | AFRIBAPAY_ERROR | ⚠️ 406 |
| 🇹🇬 TG | `moov` | XOF | 0 | 0 | `97166673` (past tx) | 201 | — | ✅ 201 initiée |
| 🇹🇬 TG | `tmoney` | XOF | 0 | 0 | `90472284` (past tx) | 201 | — | ✅ 201 initiée |

---

## 2. Détail par combo (réponse complète de l'API)

### 🇧🇫 BF — `moov` (XOF)

- Pays : **Burkina Faso**
- Opérateur : **Moov Money** (`moov`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `226`
- Téléphone testé : `04407608` (source : past tx)
- **HTTP** : 201 (1042 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075352159854738",
      "orderId": "order-1778658832106",
      "amount": 2412,
      "currency": "XOF",
      "status": "PENDING",
      "operator": "moov",
      "country": "BF",
      "phoneNumber": "04407608",
      "providerId": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpZF9pbnZvaWNlIjoiNzc4NTA4MDAiLCJzdGFydF9kYXRlIjoiMjAyNi0wNS0xMyAwNzo1Mzo1MiIsImV4cGlyeV9kYXRlIjoxNzc4NzQ1MjMyfQ.zvTjKVvE0Zeug8lbC5iYxD5Cukst_oZnvs_YcB4QdlU",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇧🇫 BF — `orange` (XOF)

- Pays : **Burkina Faso**
- Opérateur : **Orange Money** (`orange`)
- Conf live : `otp_required=1`, `wallet=0`, prefix `226`
- Téléphone testé : `22656180795` (source : past tx)
- **HTTP** : 400 (821 ms)
- **Body** :
```json
{
  "success": false,
  "error": {
    "code": "OTP_REQUIRED",
    "message": "Code OTP requis pour orange dans ce pays",
    "details": {
      "operator": "orange",
      "country": "BF",
      "currency": "XOF",
      "requiresOtp": true
    }
  }
}
```

### 🇧🇫 BF — `wligdicash` (XOF)

- Pays : **Burkina Faso**
- Opérateur : **Wallet LigdiCash** (`wligdicash`)
- Conf live : `otp_required=1`, `wallet=1`, prefix `226`
- Téléphone testé : `22654617321` (source : past tx)
- **HTTP** : 400 (684 ms)
- **Body** :
```json
{
  "success": false,
  "error": {
    "code": "OTP_REQUIRED",
    "message": "Code OTP requis pour wligdicash dans ce pays",
    "details": {
      "operator": "wligdicash",
      "country": "BF",
      "currency": "XOF",
      "requiresOtp": true
    }
  }
}
```

### 🇧🇯 BJ — `moov` (XOF)

- Pays : **Benin**
- Opérateur : **Moov Money** (`moov`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `229`
- Téléphone testé : `2290163673745` (source : past tx)
- **HTTP** : 201 (3548 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075355498969503",
      "orderId": "order-1778658835470",
      "amount": 2375,
      "currency": "XOF",
      "status": "PENDING",
      "operator": "moov",
      "country": "BJ",
      "phoneNumber": "2290163673745",
      "providerId": "8A75E3C7-09C7-4F65-AE07-11D97EC886AA",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇧🇯 BJ — `mtn` (XOF)

- Pays : **Benin**
- Opérateur : **MTN Money** (`mtn`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `229`
- Téléphone testé : `2290166853000` (source : past tx)
- **HTTP** : 201 (3488 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075359280972086",
      "orderId": "order-1778658839248",
      "amount": 2375,
      "currency": "XOF",
      "status": "PENDING",
      "operator": "mtn",
      "country": "BJ",
      "phoneNumber": "2290166853000",
      "providerId": "e18c4aee-8564-44ac-8cbd-496c638cb5d9",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇧🇯 BJ — `celtiis` (XOF)

- Pays : **Benin**
- Opérateur : **Celtiis Money** (`celtiis`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `229`
- Téléphone testé : `2290148518991` (source : past tx)
- **HTTP** : 201 (3981 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075403347466736",
      "orderId": "order-1778658843322",
      "amount": 2375,
      "currency": "XOF",
      "status": "PENDING",
      "operator": "celtiis",
      "country": "BJ",
      "phoneNumber": "2290148518991",
      "providerId": "AG_20260513_703e9d04271LF02H95OC",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇧🇯 BJ — `coris` (XOF)

- Pays : **Benin**
- Opérateur : **Coris Money** (`coris`)
- Conf live : `otp_required=0`, `wallet=1`, prefix `229`
- Téléphone testé : `2290148727150` (source : past tx)
- **HTTP** : 404 (1186 ms)
- **Body** :
```json
{
  "success": false,
  "error": {
    "code": "AFRIBAPAY_ERROR",
    "message": "Cannot POST /api/transactions/public/requesttopay/coris_bj - PIM260513075407539513253",
    "details": {
      "request_id": "BJAPM5501481260513075407231",
      "request_time": 1778658847.87803,
      "request_ip": "2a02:4780:41:1234::1",
      "error": {
        "status": "FAILED",
        "code": 404,
        "message": "Cannot POST /api/transactions/public/requesttopay/coris_bj - PIM260513075407539513253",
        "transaction_id": "PIM260513075407539513253",
        "order_id": "order-1778658847504",
        "operator": "coris",
        "phone_number": "2290148727150",
        "original_amount": 2500,
        "net_amount": 2375,
        "amount": 2375,
        "taxes": 0,
        "fees": 125,
        "fees_taxes_ttc": 125,
        "amount_total": 2500,
        "currency": "XOF",
        "country": "BJ",
        "lang": "fr",
        "reference_id": "Coup sur du jour - 1 jours",
        "date_created": "2026-05-13T07:54:07+00:00",
        "date_updated": "2026-05-13T07:54:07+00:00"
      }
    }
  }
}
```

### 🇨🇩 CD — `airtel` (CDF)

- Pays : **R.D.C**
- Opérateur : **Airtel Money** (`airtel`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `243`
- Téléphone testé : `243983569790` (source : past tx)
- **HTTP** : 201 (6269 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075409092195101",
      "orderId": "order-1778658849064",
      "amount": 11937,
      "currency": "CDF",
      "status": "PENDING",
      "operator": "airtel",
      "country": "CD",
      "phoneNumber": "243983569790",
      "providerId": "PIX_36260718",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇨🇩 CD — `mpesa` (CDF)

- Pays : **R.D.C**
- Opérateur : **Mpesa Money** (`mpesa`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `243`
- Téléphone testé : `829022686` (source : past tx)
- **HTTP** : 201 (6082 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075415642727544",
      "orderId": "order-1778658855608",
      "amount": 11937,
      "currency": "CDF",
      "status": "PENDING",
      "operator": "mpesa",
      "country": "CD",
      "phoneNumber": "829022686",
      "providerId": "PIX_36260721",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇨🇩 CD — `orange` (CDF)

- Pays : **R.D.C**
- Opérateur : **Orange Money** (`orange`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `243`
- Téléphone testé : `899736959` (source : past tx)
- **HTTP** : 201 (3263 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075421965889327",
      "orderId": "order-1778658861935",
      "amount": 11937,
      "currency": "CDF",
      "status": "PENDING",
      "operator": "orange",
      "country": "CD",
      "phoneNumber": "899736959",
      "providerId": "PIX_36260725",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇨🇩 CD — `afrimoney` (CDF)

- Pays : **R.D.C**
- Opérateur : **Afri Money** (`afrimoney`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `243`
- Téléphone testé : `961076265` (source : past tx)
- **HTTP** : 201 (3643 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075425464426362",
      "orderId": "order-1778658865434",
      "amount": 11937,
      "currency": "CDF",
      "status": "PENDING",
      "operator": "afrimoney",
      "country": "CD",
      "phoneNumber": "961076265",
      "providerId": "PIX_36260728",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇨🇩 CD — `vodacom` (CDF)

- Pays : **R.D.C**
- Opérateur : **Vodacom** (`vodacom`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `243`
- Téléphone testé : `820444978` (source : past tx)
- **HTTP** : 201 (3098 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075430072626475",
      "orderId": "order-1778658870040",
      "amount": 11937,
      "currency": "CDF",
      "status": "PENDING",
      "operator": "vodacom",
      "country": "CD",
      "phoneNumber": "820444978",
      "providerId": "PIX_36260729",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇨🇬 CG — `mtn` (XAF)

- Pays : **Congo**
- Opérateur : **MTN Money** (`mtn`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `242`
- Téléphone testé : `064645549` (source : past tx)
- **HTTP** : 201 (4211 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075436173758072",
      "orderId": "order-1778658876151",
      "amount": 2351,
      "currency": "XAF",
      "status": "PENDING",
      "operator": "mtn",
      "country": "CG",
      "phoneNumber": "064645549",
      "providerId": "2974ddf8-aff7-4d8c-8054-3e083dcb359f",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇨🇲 CM — `mtn` (XAF)

- Pays : **Cameroon**
- Opérateur : **MTN Money** (`mtn`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `237`
- Téléphone testé : `678086139` (source : past tx)
- **HTTP** : 201 (1433 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075445422697982",
      "orderId": "order-1778658885393",
      "amount": 2412,
      "currency": "XAF",
      "status": "PENDING",
      "operator": "mtn",
      "country": "CM",
      "phoneNumber": "678086139",
      "providerId": "PIX_36260733",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇨🇲 CM — `orange` (XAF)

- Pays : **Cameroon**
- Opérateur : **Orange Money** (`orange`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `237`
- Téléphone testé : `694751162` (source : past tx)
- **HTTP** : 201 (1345 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075447095734169",
      "orderId": "order-1778658887073",
      "amount": 2412,
      "currency": "XAF",
      "status": "PENDING",
      "operator": "orange",
      "country": "CM",
      "phoneNumber": "694751162",
      "providerId": "PIX_36260734",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇨🇲 CM — `expressunion` (XAF)

- Pays : **Cameroon**
- Opérateur : **EU Mobile Money** (`expressunion`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `237`
- Téléphone testé : `237674683606` (source : past tx)
- **HTTP** : 404 (1201 ms)
- **Body** :
```json
{
  "success": false,
  "error": {
    "code": "AFRIBAPAY_ERROR",
    "message": "Cet opérateur n'est pas disponible pour ce pays. Merci de choisir un autre opérateur.",
    "details": {
      "request_id": "DEAPM5501481260513075448404",
      "request_time": 1778658888.887058,
      "request_ip": "2a02:4780:41:1234::1",
      "error": {
        "message": "Operator configuration missing",
        "code": 404
      }
    }
  }
}
```

### 🇬🇦 GA — `airtel` (XAF)

- Pays : **Gabon**
- Opérateur : **Airtel Money** (`airtel`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `241`
- Téléphone testé : `077473799` (source : past tx)
- **HTTP** : 201 (4307 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075450458129392",
      "orderId": "order-1778658890430",
      "amount": 2352,
      "currency": "XAF",
      "status": "PENDING",
      "operator": "airtel",
      "country": "GA",
      "phoneNumber": "077473799",
      "providerId": "5575986345",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇬🇦 GA — `moov` (XAF)

- Pays : **Gabon**
- Opérateur : **Moov Money** (`moov`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `241`
- Téléphone testé : `066335634` (source : past tx)
- **HTTP** : 201 (4295 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075455035681475",
      "orderId": "order-1778658895010",
      "amount": 2352,
      "currency": "XAF",
      "status": "PENDING",
      "operator": "moov",
      "country": "GA",
      "phoneNumber": "066335634",
      "providerId": "5575986346",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇬🇲 GM — `afrimoney` (GMD)

- Pays : **Gambia**
- Opérateur : **Afri Money** (`afrimoney`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `220`
- Téléphone testé : `2203016537` (source : past tx)
- **HTTP** : 401 (8905 ms)
- **Body** :
```json
{
  "success": false,
  "error": {
    "code": "AFRIBAPAY_ERROR",
    "message": "No credentials provided. - PIM260513075504103297279",
    "details": {
      "request_id": "GMAPM5501481260513075508577",
      "request_time": 1778658908.104203,
      "request_ip": "2a02:4780:41:1234::1",
      "error": {
        "status": "FAILED",
        "code": 401,
        "message": "No credentials provided. - PIM260513075504103297279",
        "transaction_id": "PIM260513075504103297279",
        "order_id": "order-1778658900153",
        "operator": "afrimoney",
        "phone_number": "2203016537",
        "original_amount": 556,
        "net_amount": 528,
        "amount": 528,
        "taxes": 0,
        "fees": 27.8,
        "fees_taxes_ttc": 27.8,
        "amount_total": 556,
        "currency": "GMD",
        "country": "GM",
        "lang": "fr",
        "reference_id": "Coup sur du jour - 1 jours",
        "date_created": "2026-05-13T07:55:08+00:00",
        "date_updated": "2026-05-13T07:55:08+00:00"
      }
    }
  }
}
```

### 🇬🇳 GN — `mtn` (GNF)

- Pays : **Guinea Conakry**
- Opérateur : **MTN Money** (`mtn`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `224`
- Téléphone testé : `224663560629` (source : past tx)
- **HTTP** : 201 (2168 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075510157544431",
      "orderId": "order-1778658910069",
      "amount": 36456,
      "currency": "GNF",
      "status": "PENDING",
      "operator": "mtn",
      "country": "GN",
      "phoneNumber": "224663560629",
      "providerId": "85a1ccee-0583-4bfb-8495-84ae760ffb44",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇬🇳 GN — `orange` (GNF)

- Pays : **Guinea Conakry**
- Opérateur : **Orange Money** (`orange`)
- Conf live : `otp_required=1`, `wallet=0`, prefix `224`
- Téléphone testé : `224626511544` (source : past tx)
- **HTTP** : 400 (623 ms)
- **Body** :
```json
{
  "success": false,
  "error": {
    "code": "OTP_REQUIRED",
    "message": "Code OTP requis pour orange dans ce pays",
    "details": {
      "operator": "orange",
      "country": "GN",
      "currency": "GNF",
      "requiresOtp": true
    }
  }
}
```

### 🇲🇱 ML — `orange` (XOF)

- Pays : **Mali**
- Opérateur : **Orange Money** (`orange`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `223`
- Téléphone testé : `79475204` (source : past tx)
- **HTTP** : 201 (1231 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075514436816954",
      "orderId": "order-1778658914413",
      "amount": 2412,
      "currency": "XOF",
      "status": "PENDING",
      "operator": "orange",
      "country": "ML",
      "phoneNumber": "79475204",
      "providerId": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpZF9pbnZvaWNlIjoiNzc4NTA4MTciLCJzdGFydF9kYXRlIjoiMjAyNi0wNS0xMyAwNzo1NToxNCIsImV4cGlyeV9kYXRlIjoxNzc4NzQ1MzE0fQ.7moWNQhonefWf0exGxnof9gxZTZDy-FAsvcG5mdt0Ic",
      "providerLink": "https://mpayment.orange-money.com/ml/mpayment/abstract/v1ev9n1y4micyflxs61xovnjpfyn0ar6wuxwaxjxyxfkgin1272qygyep5vp045f",
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇳🇪 NE — `airtel` (XOF)

- Pays : **Niger**
- Opérateur : **Airtel Money** (`airtel`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `227`
- Téléphone testé : `22798884563` (source : past tx)
- **HTTP** : 201 (3240 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075515937087563",
      "orderId": "order-1778658915914",
      "amount": 2375,
      "currency": "XOF",
      "status": "PENDING",
      "operator": "airtel",
      "country": "NE",
      "phoneNumber": "22798884563",
      "providerId": "5y3qnq4twvdu",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇹🇩 TD — `airtel` (XAF)

- Pays : **Tchad**
- Opérateur : **Airtel Money** (`airtel`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `235`
- Téléphone testé : `23569774659` (source : past tx)
- **HTTP** : 201 (5151 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075525548118325",
      "orderId": "order-1778658925514",
      "amount": 2350,
      "currency": "XAF",
      "status": "PENDING",
      "operator": "airtel",
      "country": "TD",
      "phoneNumber": "23569774659",
      "providerId": "5575986348",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇹🇩 TD — `moov` (XAF)

- Pays : **Tchad**
- Opérateur : **Moov Money** (`moov`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `235`
- Téléphone testé : `23586863628` (source : past tx)
- **HTTP** : 406 (4472 ms)
- **Body** :
```json
{
  "success": false,
  "error": {
    "code": "AFRIBAPAY_ERROR",
    "message": "Not Accepted - PIM260513075530980204322",
    "details": {
      "request_id": "TDAPM5501481260513075534936",
      "request_time": 1778658934.75283,
      "request_ip": "2a02:4780:41:1234::1",
      "error": {
        "status": "FAILED",
        "code": 406,
        "message": "Not Accepted - PIM260513075530980204322",
        "transaction_id": "PIM260513075530980204322",
        "order_id": "order-1778658930942",
        "operator": "moov",
        "phone_number": "23586863628",
        "original_amount": 2500,
        "net_amount": 2350,
        "amount": 2350,
        "taxes": 0,
        "fees": 150,
        "fees_taxes_ttc": 150,
        "amount_total": 2500,
        "currency": "XAF",
        "country": "TD",
        "lang": "fr",
        "reference_id": "Coup sur du jour - 1 jours",
        "date_created": "2026-05-13T07:55:34+00:00",
        "date_updated": "2026-05-13T07:55:34+00:00"
      }
    }
  }
}
```

### 🇹🇬 TG — `moov` (XOF)

- Pays : **Togo**
- Opérateur : **Moov Money** (`moov`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `228`
- Téléphone testé : `97166673` (source : past tx)
- **HTTP** : 201 (1017 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075535698421969",
      "orderId": "order-1778658935673",
      "amount": 2412,
      "currency": "XOF",
      "status": "PENDING",
      "operator": "moov",
      "country": "TG",
      "phoneNumber": "97166673",
      "providerId": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpZF9pbnZvaWNlIjoiNzc4NTA4MjIiLCJzdGFydF9kYXRlIjoiMjAyNi0wNS0xMyAwNzo1NTozNSIsImV4cGlyeV9kYXRlIjoxNzc4NzQ1MzM1fQ.y18KTJGTqeErVImslFEsCU725Q4CtTB2c5HZ8FDKoJ4",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```

### 🇹🇬 TG — `tmoney` (XOF)

- Pays : **Togo**
- Opérateur : **T-Money** (`tmoney`)
- Conf live : `otp_required=0`, `wallet=0`, prefix `228`
- Téléphone testé : `90472284` (source : past tx)
- **HTTP** : 201 (1128 ms)
- **Body** :
```json
{
  "success": true,
  "message": "Paiement initié avec succès",
  "data": {
    "transaction": {
      "transactionId": "PIM260513075537043893867",
      "orderId": "order-1778658937018",
      "amount": 2412,
      "currency": "XOF",
      "status": "PENDING",
      "operator": "tmoney",
      "country": "TG",
      "phoneNumber": "90472284",
      "providerId": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpZF9pbnZvaWNlIjoiNzc4NTA4MjMiLCJzdGFydF9kYXRlIjoiMjAyNi0wNS0xMyAwNzo1NTozNyIsImV4cGlyeV9kYXRlIjoxNzc4NzQ1MzM3fQ.9B9gCsPFdkd87HGUquqJ5URBQfb2QMO8fz3FtQD-P0w",
      "providerLink": null,
      "package": {
        "name": {
          "fr": "Coup sur du jour",
          "en": "Sure bet of the day"
        },
        "description": {
          "fr": "Le coup sur du jour - Cote garantie de 3",
          "en": "Today's sure bet - Guaranteed odds de 3"
        },
        "badge": {
          "fr": "COUP SÛR",
          "en": "SURE BET"
        },
        "_id": "68e101915d973384fd8350ad",
        "pricing": {
          "XAF": 2500,
          "XOF": 2500,
          "USD": 8,
          "GMD": 556,
          "CDF": 12500,
          "GNF": 37975,
          "EGP": 214,
          "GHS": 59,
          "KES": 707,
          "NGN": 7543,
          "TZS": 14167,
          "ZAR": 92
        },
        "duration": 1,
        "categories": [
          "68e101305d973384fd8350ac",
          "688f46a9909020ce94740a52"
        ],
        "isActive": true,
        "createdAt": "2025-10-04T00:00:00.000Z",
        "availableOnGooglePlay": true,
        "googleProductId": "com.bigwin.application.coup_sur",
        "googleProductType": "ONE_TIME_PRODUCT",
        "appId": "bigwin",
        "giftTier": "69f43662b2077ae3171233c3"
      }
    }
  }
}
```
