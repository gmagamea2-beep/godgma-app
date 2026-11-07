// 비공개 데이터 저장소(godgma-data)에서 사이트 배포본 두 개를 만든다.
//   public/share.json     두 이름을 가린 공개본 (파일 이름도 f0.md… 로 바꾼다)
//   public/full.enc.json  실명본. SHARE_CODE(실명 보기 코드)로 암호화한다.
//
// 사용: SHARE_CODE=... node tools/build_bundles.mjs <godgma-data 폴더>
// SHARE_CODE 가 없으면 실명본은 건너뛴다(기존 파일 유지).
// 가릴 이름은 데이터 저장소의 share_rules.json 에만 있다. 이 파일에 이름을 쓰지 않는다.
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, webcrypto } from 'node:crypto';
import { createMasker } from '../src/share.js';

const crypto = globalThis.crypto ?? webcrypto;
const ITERATIONS = 600000;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.argv[2];
if (!dataDir) {
  console.error('사용: node tools/build_bundles.mjs <godgma-data 폴더>');
  process.exit(2);
}

const read = (p) => readFile(join(dataDir, p), 'utf8');
const shortHash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const b64 = (buf) => Buffer.from(buf).toString('base64');

const indexText = await read('index.json');
const index = JSON.parse(indexText);
const rulesText = await read('share_rules.json');
const changelog = await read('CHANGELOG.md').catch(() => '');

// index.json 이 가리키는 파일 (순서대로)
const pages = [];
for (const tab of index.tabs || []) for (const page of tab.pages || []) if (typeof page.file === 'string') pages.push(page);
const original = {};
for (const page of pages) original[page.file] ??= await read(page.file);

// ---------- 공개본 ----------
const masker = createMasker(rulesText);
if (!masker) throw new Error('share_rules.json 을 읽지 못했다. 공개본을 만들 수 없다.');

const alias = new Map();
for (const page of pages) if (!alias.has(page.file)) alias.set(page.file, `f${alias.size}.md`);
const shareIndex = structuredClone(index);
for (const tab of shareIndex.tabs || []) for (const page of tab.pages || []) if (alias.has(page.file)) page.file = alias.get(page.file);

const shareFiles = { 'index.json': masker.mask(JSON.stringify(shareIndex, null, 2)), 'CHANGELOG.md': masker.mask(changelog) };
for (const [path, name] of alias) shareFiles[name] = masker.mask(original[path]);

const leftovers = new Set();
for (const text of Object.values(shareFiles)) for (const w of masker.leftovers(text)) leftovers.add(w);
if (leftovers.size) {
  console.error(`공개본에 가려지지 않은 이름이 남아 있다 (${leftovers.size}종). share_rules.json 을 고쳐야 한다.`);
  process.exit(1);
}
const shareBody = JSON.stringify(shareFiles);
await writeFile(join(root, 'public/share.json'), JSON.stringify({ v: 1, id: shortHash('share' + shareBody), files: shareFiles }));
console.log(`share.json: 파일 ${Object.keys(shareFiles).length}개`);

// ---------- 실명본 ----------
const code = process.env.SHARE_CODE;
if (!code) {
  console.warn('SHARE_CODE 가 없어 full.enc.json 은 건너뛴다 (기존 파일 유지).');
} else {
  const fullFiles = { 'index.json': indexText, 'CHANGELOG.md': changelog, 'share_rules.json': rulesText, ...original };
  const plain = new TextEncoder().encode(JSON.stringify({ files: fullFiles }));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  const bundle = {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: b64(salt),
    iv: b64(iv),
    data: b64(data),
    // 내용이 같으면 id 도 같다 → 앱이 다시 받지 않는다
    id: shortHash('full' + JSON.stringify(fullFiles)),
  };
  await writeFile(join(root, 'public/full.enc.json'), JSON.stringify(bundle));
  console.log(`full.enc.json: 파일 ${Object.keys(fullFiles).length}개 (암호화)`);
}
