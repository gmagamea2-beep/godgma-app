// 마지막으로 받은 데이터를 IndexedDB 에 통째로 저장한다 (오프라인에서도 보이도록).
const DB_NAME = 'godgma';
const STORE = 'kv';
const SNAPSHOT_KEY = 'snapshot';

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function run(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export async function loadSnapshot() {
  try {
    return (await run('readonly', (s) => s.get(SNAPSHOT_KEY))) || null;
  } catch (e) {
    console.warn('[db] 캐시를 읽지 못했다', e);
    return null;
  }
}

export function saveSnapshot(snapshot) {
  return run('readwrite', (s) => s.put(snapshot, SNAPSHOT_KEY));
}

export function clearSnapshot() {
  return run('readwrite', (s) => s.delete(SNAPSHOT_KEY));
}
