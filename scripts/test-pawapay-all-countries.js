// Test exhaustif sandbox pawaPay : 17 pays × ~36 providers × 3 cas
// Tape directement l'API sandbox (pas notre /initiate), donc rien a nettoyer
// cote DB Atlas. Les transactions restent visibles dans le dashboard sandbox
// pawaPay (bac a sable).

const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const svc = require('../src/api/services/user/PawapayService');

const TOKEN = 'eyJraWQiOiIxIiwiYWxnIjoiRVMyNTYifQ.eyJ0dCI6IkFBVCIsInN1YiI6IjIyMDk5IiwibWF2IjoiMSIsImV4cCI6MjA5NTU4NjU3NywiaWF0IjoxNzc5OTY3Mzc3LCJwbSI6IkRBRixQQUYiLCJqdGkiOiJkMGFkNDEwNi1lYWMwLTRiZWQtOGI2Yi0yMzExNWE5MTEzNGQifQ.R5znckNyvh8pkHAISSkKG4SlCs38xE8PlF3shJMxlUe-xafTCVVqE821x-JdCoC2rPLX2nt2soVjjUBrpjRnGA';
const BASE = 'https://api.sandbox.pawapay.io/v2';

const CCY = {
  BEN:'XOF', BFA:'XOF', CIV:'XOF', CMR:'XAF', COD:'CDF', COG:'XAF', GAB:'XAF',
  GHA:'GHS', KEN:'KES', MOZ:'MZN', MWI:'MWK', RWA:'RWF', SEN:'XOF', SLE:'SLE',
  TZA:'TZS', UGA:'UGX', ZMB:'ZMW'
};

const PROVIDERS = [
  { c:'BEN', p:'MTN_MOMO_BEN',      ok:'22951345789',    ko:'22951345029',    pd:'22951345129' },
  { c:'BEN', p:'MOOV_BEN',          ok:'22995345789',    ko:'22995345679',    pd:'22995345639' },
  { c:'BFA', p:'MOOV_BFA',          ok:'22602345678',    ko:'22602345048',    pd:'22602345138' },
  { c:'BFA', p:'ORANGE_BFA',        ok:'22607345678',    ko:'22607345148',    pd:'22607345128' },
  { c:'CIV', p:'MTN_MOMO_CIV',      ok:'2250503456789',  ko:'2250503456029',  pd:'2250503456129' },
  { c:'CIV', p:'ORANGE_CIV',        ok:'2250734567890',  ko:'2250734567030',  pd:'2250734567130' },
  { c:'CMR', p:'MTN_MOMO_CMR',      ok:'237653456789',   ko:'237653456019',   pd:'237653456129' },
  { c:'CMR', p:'ORANGE_CMR',        ok:'237693456789',   ko:'237693456069',   pd:'237693456129' },
  { c:'COD', p:'VODACOM_MPESA_COD', ok:'243813456789',   ko:'243813456019',   pd:'243813456129' },
  { c:'COD', p:'AIRTEL_COD',        ok:'243973456789',   ko:'243973456069',   pd:'243973456129' },
  { c:'COD', p:'ORANGE_COD',        ok:'243893456789',   ko:'243893456029',   pd:'243893456129' },
  { c:'COG', p:'AIRTEL_COG',        ok:'242053456789',   ko:'242053456039',   pd:'242053456129' },
  { c:'COG', p:'MTN_MOMO_COG',      ok:'242063456789',   ko:'242063456029',   pd:'242063456129' },
  { c:'GAB', p:'AIRTEL_GAB',        ok:'24174345678',    ko:'24174345048',    pd:'24174345128' },
  { c:'GHA', p:'MTN_MOMO_GHA',      ok:'233593456789',   ko:'233593456019',   pd:'233593456129' },
  { c:'GHA', p:'AIRTELTIGO_GHA',    ok:'233273456789',   ko:'233273456069',   pd:'233273456129' },
  { c:'GHA', p:'VODAFONE_GHA',      ok:'233503456789',   ko:'233503456039',   pd:'233503456129' },
  { c:'KEN', p:'MPESA_KEN',         ok:'254703456789',   ko:'254703456019',   pd:'254703456129' },
  { c:'MOZ', p:'MOVITEL_MOZ',       ok:'258100000000',   ko:'258100000010',   pd:null },
  { c:'MWI', p:'AIRTEL_MWI',        ok:'265993456789',   ko:'265993456049',   pd:'265993456129' },
  { c:'MWI', p:'TNM_MWI',           ok:'265883456789',   ko:'265883456049',   pd:'265883456129' },
  { c:'RWA', p:'AIRTEL_RWA',        ok:'250733456789',   ko:'250733456039',   pd:'250733456129' },
  { c:'RWA', p:'MTN_MOMO_RWA',      ok:'250783456789',   ko:'250783456019',   pd:'250783456129' },
  { c:'SEN', p:'FREE_SEN',          ok:'221763456789',   ko:'221763456049',   pd:'221763456129' },
  { c:'SEN', p:'ORANGE_SEN',        ok:'221773456789',   ko:'221773456029',   pd:'221773456129' },
  { c:'SLE', p:'ORANGE_SLE',        ok:'23276123456',    ko:null,             pd:null },
  { c:'TZA', p:'AIRTEL_TZA',        ok:'255683456789',   ko:'255683456019',   pd:'255683456129' },
  { c:'TZA', p:'VODACOM_TZA',       ok:'255763456789',   ko:'255763456039',   pd:'255763456129' },
  { c:'TZA', p:'TIGO_TZA',          ok:'255713456789',   ko:'255713456039',   pd:'255713456129' },
  { c:'TZA', p:'HALOTEL_TZA',       ok:'255623456789',   ko:'255623456029',   pd:'255623456129' },
  { c:'UGA', p:'AIRTEL_OAPI_UGA',   ok:'256753456789',   ko:'256753456019',   pd:'256753456129' },
  { c:'UGA', p:'MTN_MOMO_UGA',      ok:'256783456789',   ko:'256783456019',   pd:'256783456129' },
  { c:'ZMB', p:'AIRTEL_OAPI_ZMB',   ok:'260973456789',   ko:'260973456019',   pd:'260973456129' },
  { c:'ZMB', p:'MTN_MOMO_ZMB',      ok:'260763456789',   ko:'260763456019',   pd:'260763456129' },
  { c:'ZMB', p:'ZAMTEL_ZMB',        ok:'260953456700',   ko:'260953456704',   pd:'260953456789' }
];

const allTests = [];
PROVIDERS.forEach(p => {
  if (p.ok) allTests.push({ c: p.c, p: p.p, phone: p.ok, expected: 'SUCCESS' });
  if (p.ko) allTests.push({ c: p.c, p: p.p, phone: p.ko, expected: 'FAILED' });
  if (p.pd) allTests.push({ c: p.c, p: p.p, phone: p.pd, expected: 'INITIATED' });
});

async function runOne(t) {
  const id = uuidv4();
  try {
    await axios.post(BASE + '/deposits', {
      depositId: id,
      payer: { type: 'MMO', accountDetails: { phoneNumber: t.phone, provider: t.p } },
      amount: '1000', currency: CCY[t.c],
      clientReferenceId: 'EXHAUSTIF',
      customerMessage: 'Test sandbox'
    }, { headers: { Authorization: 'Bearer ' + TOKEN }, timeout: 25000 });
    await new Promise(r => setTimeout(r, 5500));
    const sr = await axios.get(BASE + '/deposits/' + id, {
      headers: { Authorization: 'Bearer ' + TOKEN },
      timeout: 20000
    });
    const inner = sr.data?.data || {};
    const mapped = svc.mapApiStatus(inner.status);
    return {
      ...t,
      raw: inner.status,
      mapped,
      ok: mapped === t.expected,
      failure: inner.failureReason?.failureCode
    };
  } catch (e) {
    return {
      ...t,
      err: (e.response?.data?.failureReason?.failureMessage || e.message).slice(0, 80),
      status: e.response?.status,
      ok: false
    };
  }
}

(async () => {
  console.log('=== Test exhaustif sandbox : ' + allTests.length + ' cas ===');
  const results = [];
  for (let i = 0; i < allTests.length; i += 20) {
    const batch = allTests.slice(i, i + 20);
    const batchResults = await Promise.all(batch.map(runOne));
    results.push(...batchResults);
    process.stdout.write('. ');
  }
  console.log('');

  const byCountry = {};
  results.forEach(r => {
    byCountry[r.c] = byCountry[r.c] || [];
    byCountry[r.c].push(r);
  });

  let totalOk = 0, totalKo = 0;
  Object.keys(byCountry).sort().forEach(c => {
    console.log('\n--- ' + c + ' (' + CCY[c] + ') ---');
    byCountry[c].forEach(r => {
      if (r.ok) totalOk++; else totalKo++;
      const icon = r.ok ? '✅' : '❌';
      const detail = r.err
        ? ('ERR ' + r.status + ': ' + r.err)
        : ((r.raw || '?').padEnd(20) + ' → ' + (r.mapped || 'null').padEnd(10) + ' exp=' + r.expected + (r.failure ? ' [' + r.failure + ']' : ''));
      console.log('  ' + icon + ' ' + r.p.padEnd(22) + ' ' + r.phone.padEnd(15) + ' ' + detail);
    });
  });

  console.log('\n=== RESUME ===');
  console.log('Total : ' + totalOk + ' OK / ' + totalKo + ' KO sur ' + results.length);
  process.exit(totalKo === 0 ? 0 : 1);
})();
