const fs = require('fs');
const core = fs.readFileSync('' + require('path').resolve(__dirname, '..', '..') + '/web/console/00-core.js', 'utf8');
const a = core.indexOf('/* ------------------------------------------------------------------ the variable catalog'), b = core.indexOf('/* ------------------------------------------------------------------ experiments and their demo state');
const bundle = JSON.parse(fs.readFileSync('' + require('path').resolve(__dirname, '..', '..') + '/out/console_bundle.json', 'utf8'));
const code = `const esc=s=>String(s);const nf=n=>n;const pct=(x)=>x;let C=${JSON.stringify({ catalog: bundle.catalog })};const DYN={settings:{}};` + core.slice(a, b) + `;return {parseSegment, segDescribe, planStrata, blockFor, segShare, DYN};`;
const lib = new Function(code)();
const cases = [
  ['Mumbai proprietors on UA and PNS leads', 'City = Mumbai AND NOB = Proprietor AND HL IN (UA, PNS)'],
  ['proprietors', 'NOB = Proprietor'],
  ['proprietors but not UA', 'NOB = Proprietor AND HL IN (PUA, ENQR, PNS)'],
  ['leads that are not on UA', 'HL IN (PUA, ENQR, PNS)'],
  ['no UA', 'HL IN (PUA, ENQR, PNS)'],
  ['excluding Pvt Ltd and Partnership', 'NOB IN (Proprietor, Other)'],
  ['proprietors, but not in Mumbai or Delhi', 'City IN (Bengaluru, Pune, Chennai, Other) AND NOB = Proprietor'],
  ['Pvt. Ltd. in Pune', 'City = Pune AND NOB = Pvt Ltd'],
  ['UA/PNS', 'HL IN (UA, PNS)'],
  ['not UA and in Mumbai', 'City = Mumbai AND HL IN (PUA, ENQR, PNS)'],
  ['Delhi, Pune and Other', 'City IN (Delhi, Pune)  [warn: other]'],
  ['All the leads', 'ALL'],
  ['all leads', 'ALL'], ['', 'ALL'],
  ['leads that answered the call', 'ERROR in-call'],
  ['xyz banana', 'ERROR'],
  ['PUA leads', 'HL = PUA'],
  ['mumbai or delhi proprietors', 'City IN (Mumbai, Delhi) AND NOB = Proprietor'],
  ['proprietors in bangalore', 'City = Bengaluru AND NOB = Proprietor'],
];
let bad = 0;
for (const [t, want] of cases) { const r = lib.parseSegment(t); const got = r.errors.length ? 'ERROR ' + r.errors[0].slice(0, 30) : r.rules.length ? lib.segDescribe({ rules: r.rules }) : 'ALL'; const ok = want.startsWith('ERROR') ? got.startsWith('ERROR') : got === want.split('  [')[0]; if (!ok) bad++; console.log((ok ? 'ok  ' : 'BAD ') + JSON.stringify(t) + ' -> ' + got + (r.warnings.length ? '  [warn: ' + r.warnings.join(',') + ']' : '') + (ok ? '' : '   WANT ' + want)); }
console.log(bad ? bad + ' bad' : 'all ok');
