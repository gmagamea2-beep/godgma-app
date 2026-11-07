// 저장소(또는 개발용 로컬 폴더)에서 최신 데이터를 받아 스냅샷을 만든다.
// 최신 커밋이 캐시와 같으면 아무것도 받지 않고, 바뀐 파일(blob sha 기준)만 다시 받는다.
import { sourceKey } from './settings.js';

const API = 'https://api.github.com';
const CONCURRENCY = 6;
const ALWAYS_FETCH = ['index.json', 'CHANGELOG.md', 'share_rules.json'];

export class SyncError extends Error {
  constructor(message, { status = 0, offline = false } = {}) {
    super(message);
    this.name = 'SyncError';
    this.status = status;
    this.offline = offline;
  }
}

async function request(url, init) {
  try {
    return await fetch(url, { cache: 'no-store', ...init });
  } catch (e) {
    throw new SyncError('네트워크에 연결할 수 없습니다. 마지막으로 받은 내용을 보여 줍니다.', { offline: true });
  }
}

function describeGitHubError(res) {
  switch (res.status) {
    case 401:
      return '토큰이 올바르지 않거나 만료되었습니다. 더보기 → 저장소 연결에서 토큰을 다시 넣어 주세요.';
    case 403:
      return res.headers.get('x-ratelimit-remaining') === '0'
        ? 'GitHub 요청 한도를 넘었습니다. 잠시 뒤 다시 시도해 주세요.'
        : '이 토큰으로는 저장소를 읽을 수 없습니다. 토큰의 Contents 읽기 권한을 확인해 주세요.';
    case 404:
      return '저장소나 브랜치를 찾을 수 없습니다. 저장소 이름·브랜치와 토큰 권한을 확인해 주세요.';
    case 409:
      return '저장소가 비어 있습니다. 데이터를 먼저 푸시해야 합니다.';
    default:
      return `GitHub 응답 오류 (${res.status})`;
  }
}

function githubClient(settings) {
  const base = `${API}/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`;
  const headers = { 'X-GitHub-Api-Version': '2022-11-28' };
  if (settings.token) headers.Authorization = `Bearer ${settings.token}`;

  async function get(path, accept = 'application/vnd.github+json') {
    const res = await request(base + path, { headers: { ...headers, Accept: accept } });
    if (!res.ok) throw new SyncError(describeGitHubError(res), { status: res.status });
    return res;
  }

  return {
    async latestCommit() {
      const res = await get(`/commits/${encodeURIComponent(settings.branch)}`, 'application/vnd.github.sha');
      return (await res.text()).trim();
    },
    async tree(commitSha) {
      const json = await (await get(`/git/trees/${commitSha}?recursive=1`)).json();
      if (json.truncated) console.warn('[sync] 파일 목록이 잘렸다 (저장소가 너무 큼)');
      return json.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha }));
    },
    async blob(sha) {
      const json = await (await get(`/git/blobs/${sha}`)).json();
      const bin = atob(json.content.replace(/\s/g, ''));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    },
  };
}

function localClient() {
  let manifest = null;
  async function loadManifest() {
    const res = await request('/__local-data/manifest');
    if (!res.ok) throw new SyncError(`로컬 데이터 폴더를 읽지 못했습니다 (${res.status})`, { status: res.status });
    manifest = await res.json();
    return manifest;
  }
  return {
    async latestCommit() {
      return (await loadManifest()).commitSha;
    },
    async tree() {
      return (manifest || (await loadManifest())).files;
    },
    async blob(sha, path) {
      const res = await request(`/__local-data/file?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new SyncError(`로컬 파일을 읽지 못했습니다: ${path}`, { status: res.status });
      return res.text();
    },
  };
}

async function pool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

/** index.json 에서 실제로 쓰는 파일 경로를 모은다. */
function referencedFiles(indexText) {
  let index;
  try {
    index = JSON.parse(indexText);
  } catch (e) {
    throw new SyncError(`index.json 형식이 잘못되었습니다: ${e.message}`);
  }
  if (!Array.isArray(index?.tabs)) throw new SyncError('index.json 에 tabs 목록이 없습니다.');
  const paths = [];
  for (const tab of index.tabs) {
    for (const page of tab.pages || []) {
      if (typeof page.file === 'string') paths.push(page.file);
    }
  }
  return paths;
}

// ---------- 공유본: 사이트에 올린 암호화 파일(share.enc.json)을 공유 코드로 연다 ----------

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function decryptBundle(bundle, code) {
  if (bundle?.v !== 1 || bundle.kdf !== 'PBKDF2-SHA256') throw new SyncError('공유본 형식을 알 수 없습니다.');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64(bundle.salt), iterations: bundle.iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(bundle.iv) }, key, b64(bundle.data));
  } catch {
    throw new SyncError('공유 코드가 맞지 않습니다.', { status: 401 });
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

async function syncShared(settings, prev, now) {
  const res = await request(new URL('share.enc.json', document.baseURI).href);
  if (!res.ok) throw new SyncError('공유본이 아직 올라와 있지 않습니다.', { status: res.status });
  const bundle = await res.json();
  if (prev && prev.commitSha === bundle.id) return { snapshot: { ...prev, checkedAt: now }, changed: false };
  const { files: texts } = await decryptBundle(bundle, settings.shareCode);
  const files = {};
  for (const [path, text] of Object.entries(texts)) files[path] = { sha: '', text };
  return {
    snapshot: { sourceKey: 'shared', commitSha: bundle.id, syncedAt: now, checkedAt: now, files, missing: [] },
    changed: true,
  };
}

/**
 * @returns {Promise<{snapshot: object, changed: boolean}>}
 */
export async function sync(settings, previous) {
  if (settings.source === 'shared') {
    const prev = previous?.sourceKey === 'shared' ? previous : null;
    return syncShared(settings, prev, Date.now());
  }
  if (settings.source === 'github' && !settings.token) {
    throw new SyncError('GitHub 토큰이 없습니다. 더보기 → 저장소 연결에서 토큰을 넣어 주세요.');
  }
  const client = settings.source === 'local' && import.meta.env.DEV ? localClient() : githubClient(settings);
  const key = sourceKey(settings);
  const prev = previous && previous.sourceKey === key ? previous : null;
  const now = Date.now();

  const commitSha = await client.latestCommit();
  if (prev && prev.commitSha === commitSha) {
    return { snapshot: { ...prev, checkedAt: now }, changed: false };
  }

  const tree = await client.tree(commitSha);
  const byPath = new Map(tree.map((e) => [e.path, e]));
  const oldFiles = prev?.files || {};

  const fetchOne = async (path) => {
    const entry = byPath.get(path);
    if (!entry) return [path, null];
    const old = oldFiles[path];
    if (old && old.sha === entry.sha) return [path, old];
    return [path, { sha: entry.sha, text: await client.blob(entry.sha, path) }];
  };

  if (!byPath.has('index.json')) throw new SyncError('저장소에 index.json 이 없습니다.');
  const [, indexFile] = await fetchOne('index.json');
  const wanted = [...new Set([...ALWAYS_FETCH, ...referencedFiles(indexFile.text)])].filter((p) => p !== 'index.json');
  const fetched = await pool(wanted, fetchOne);

  const files = { 'index.json': indexFile };
  const missing = [];
  for (const [path, file] of fetched) {
    if (file) files[path] = file;
    else if (!ALWAYS_FETCH.includes(path)) missing.push(path);
  }

  return {
    snapshot: { sourceKey: key, commitSha, syncedAt: now, checkedAt: now, files, missing },
    changed: true,
  };
}
