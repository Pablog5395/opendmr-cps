// The page's JS as a module with a jsdom document: the flasher tab renders, the four cards are there, no i18n key
// leaks in any of the three languages. jsdom does not run <script type="module">, so the bundle from
// opendmr-cps-debug.html is imported as a module here.
//
//   py build.py && node tools/web/tests/test-page.mjs      (needs jsdom: npm i jsdom)
import {readFileSync, writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

let JSDOM;
try {
    ({JSDOM} = await import('jsdom'));
} catch (e) {
    console.log('test skipped: jsdom is not installed (npm i jsdom)');
    process.exit(0);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const page = readFileSync(join(ROOT, 'opendmr-cps-debug.html'), 'utf8');
const script = page.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const bundle = join(mkdtempSync(join(tmpdir(), 'cps-test-')), 'bundle.mjs');
writeFileSync(bundle, script);

const shell = readFileSync(join(ROOT, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(shell, {url: 'http://localhost/'});
const {window} = dom;

const define = (name, value) => Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
define('window', window);
define('document', window.document);
define('navigator', window.navigator);
define('localStorage', window.localStorage);
define('location', window.location);
define('isSecureContext', true);
define('confirm', () => true);
define('Node', window.Node);
define('Element', window.Element);
define('Event', window.Event);
define('getComputedStyle', window.getComputedStyle.bind(window));
window.isSecureContext = true;
window.navigator.serial = {
    requestPort: async () => {
        throw new Error('no port in the test');
    },
};

await import(bundle);
await new Promise((resolve) => setTimeout(resolve, 100));

const errors = [];
window.document.querySelector('.tab[data-tab="flasher"]').click();
await new Promise((resolve) => setTimeout(resolve, 100));

const main = window.document.getElementById('content');
let text = main.textContent;
const cards = [...main.querySelectorAll('.card-title')].map((h) => h.textContent.trim());
const buttons = [...main.querySelectorAll('button')].map((b) => b.textContent.trim());
console.log('cards:', JSON.stringify(cards));
console.log('buttons:', JSON.stringify(buttons));
if (cards.length !== 5) {
    errors.push('expected 5 cards, got ' + cards.length);
}
if (!buttons.some((b) => b.includes('updater.bin')) || !buttons.some((b) => b.includes('dumper.bin'))) {
    errors.push('the two program downloads are missing');
}
if (!main.querySelector('a[href*="OpenDMR/releases"]')) {
    errors.push('the releases link is missing');
}

// los dos botones de descarga: pulsan y bajan el archivo (en jsdom, como data URL)
const before = main.querySelectorAll('a[download]').length;
for (const name of ['updater.bin', 'dumper.bin']) {
    const b = [...main.querySelectorAll('button')].find((x) => x.textContent.includes(name));
    b.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
}
const links = [...document.querySelectorAll('a[download]')];
console.log('descargas:', links.map((a) => a.download + ' ' + a.getAttribute('href').slice(0, 24)).join(' | '));
if (links.length < before + 2) {
    errors.push('the download links were not made');
}
const updaterLink = links.find((a) => a.download === 'updater.bin');
if (!updaterLink || !/^(blob:|data:)/.test(updaterLink.getAttribute('href'))) {
    errors.push('updater.bin did not download');
} else if (updaterLink.getAttribute('href').startsWith('blob:')) {
    // el blob de Node: los bytes tienen que ser los del .bin
    const bytes = new Uint8Array(await (await fetch(updaterLink.getAttribute('href'))).arrayBuffer());
    const disk = readFileSync(new URL('../../../assets/updater.bin', import.meta.url));
    if (bytes.length !== disk.length || !bytes.every((v, i) => v === disk[i])) {
        errors.push('updater.bin downloaded different bytes');
    }
}
if (buttons.length < 7) {
    errors.push('not enough buttons');
}
if (!text.includes('opendmr.bin')) {
    errors.push('the firmware hint is missing');
}
if (/fl[A-Z]\w+/.test(text)) {
    errors.push('untranslated keys: ' + text.match(/fl[A-Z]\w+/g).join(', '));
}

for (const lang of ['es', 'zh', 'en']) {
    for (let i = 0; i < 4 && window.localStorage.getItem('lang') !== lang; i++) {
        window.document.getElementById('btnLang').click();
    }
    window.document.querySelector('.tab[data-tab="flasher"]').click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    text = window.document.getElementById('content').textContent;
    const leaked = text.match(/fl[A-Z]\w+/g) || [];
    console.log(lang, '→', leaked.length ? 'untranslated: ' + leaked.join(', ') : 'texts OK');
    if (leaked.length) {
        errors.push(`${lang}: ${leaked.join(', ')}`);
    }
}

console.log(errors.length ? 'PAGE: ' + errors.join(' | ') : 'PAGE OK');
process.exit(errors.length ? 1 : 0);
