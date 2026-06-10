/* Simulates the n8n task runner's prototype freezing (js-task-runner.js)
   and runs a full fuse — verifies the child-process fallback engages. */
'use strict';
console.log('start'); process.stdout.write('');
Object.getOwnPropertyNames(globalThis)
  .map((n) => Reflect.get(globalThis, n))
  .filter((v) => typeof v === 'function')
  .forEach((fn) => { if (typeof fn.prototype === 'object') Object.freeze(fn.prototype); Object.freeze(fn); });
[Reflect, JSON, Math].forEach(Object.freeze);

const fs = require('fs');
const path = require('path');
const { fuseSite } = require('./fuse.cjs');
const ROOT = path.join(__dirname, '..');

(async () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'sites/configs/1300-findleak.json'), 'utf8'));
  const t0 = Date.now();
  const r = await fuseSite({
    config: cfg,
    domain: 'https://www.1300findleak.com.au',
    bundleJs: fs.readFileSync(path.join(__dirname, 'template/bundle.js'), 'utf8'),
    cssText: fs.readFileSync(path.join(__dirname, 'template/template.css'), 'utf8'),
    siteJs: fs.readFileSync(path.join(__dirname, 'template/site.js'), 'utf8'),
  });
  const home = r.files.find((f) => f.path === 'index.html').content;
  console.log('OK in', Date.now() - t0, 'ms — files:', r.files.length, 'copies:', r.copies.length,
    'warnings:', JSON.stringify(r.warnings),
    '| clamp:', home.split('clamp(').length - 1,
    't-slides:', home.split('data-cd="t-slide"').length - 1,
    'bases:', (home.match(/data-base/g) || []).length,
    'menu:', home.split('data-cd="mobile-menu"').length - 1);
})().catch((e) => { console.log('FAIL:', e.message); process.exit(1); });
