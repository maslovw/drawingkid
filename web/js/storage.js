// Autosave of the current drawing in IndexedDB (handles image Blobs, unlike localStorage).

const DB_NAME = 'drawingkid';
const STORE = 'documents';
const CURRENT_KEY = 'current';

let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export const loadDrawing = () => run('readonly', (store) => store.get(CURRENT_KEY));
export const saveDrawing = (data) => run('readwrite', (store) => store.put(data, CURRENT_KEY));
