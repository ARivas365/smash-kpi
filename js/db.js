// Envoltorio mínimo de IndexedDB.
const DB_NAME = 'smash-kpi';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('games')) {
          const s = db.createObjectStore('games', { keyPath: 'id' });
          s.createIndex('setId', 'setId');
          s.createIndex('ts', 'ts');
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('attackLogs')) db.createObjectStore('attackLogs', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const getAll = store => run(store, 'readonly', s => s.getAll());
export const get = (store, key) => run(store, 'readonly', s => s.get(key));
export const put = (store, val, key) => run(store, 'readwrite', s => (key === undefined ? s.put(val) : s.put(val, key)));
export const del = (store, key) => run(store, 'readwrite', s => s.delete(key));
export const clear = store => run(store, 'readwrite', s => s.clear());
export const putMany = (store, arr) => run(store, 'readwrite', s => { arr.forEach(v => s.put(v)); });
export const delMany = (store, keys) => run(store, 'readwrite', s => { keys.forEach(k => s.delete(k)); });
