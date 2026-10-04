// Autosave of the current drawing, and the coloring pages the kid has made for the
// gallery, in IndexedDB (handles image Blobs, unlike localStorage).

const DB_NAME = 'drawingkid';
const STORE = 'documents';
const PAGES = 'pages'; // { id, createdAt, text, blob, thumb }
const CURRENT_KEY = 'current';

const BLOCKED_TIMEOUT = 3000;

let dbPromise;

function openDb() {
  if (dbPromise) return dbPromise;
  const promise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    let timer;
    let gaveUp = false;
    request.onupgradeneeded = (e) => {
      const db = request.result;
      if (e.oldVersion < 1) db.createObjectStore(STORE);
      if (e.oldVersion < 2) db.createObjectStore(PAGES, { keyPath: 'id', autoIncrement: true });
    };
    // Another tab or home-screen instance still has an older version open. Wait a bit
    // for it to close, then fail so callers fall back instead of hanging forever.
    request.onblocked = () => {
      console.warn('Storage upgrade is blocked by another open copy of the app');
      timer ??= setTimeout(() => {
        gaveUp = true;
        reject(new Error('Storage is blocked by another open copy of the app'));
      }, BLOCKED_TIMEOUT);
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      // Too late, a later call opens its own connection.
      if (gaveUp) return db.close();
      // Step aside for a newer version opened elsewhere; the next call reopens.
      db.onversionchange = db.onclose = () => {
        db.close();
        if (dbPromise === promise) dbPromise = undefined;
      };
      resolve(db);
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error);
    };
  });
  // Don't keep a failed open around, so the next call tries again.
  promise.catch(() => {
    if (dbPromise === promise) dbPromise = undefined;
  });
  dbPromise = promise;
  return promise;
}

async function run(mode, fn, storeName = STORE) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export const loadDrawing = () => run('readonly', (store) => store.get(CURRENT_KEY));
export const saveDrawing = (data) => run('readwrite', (store) => store.put(data, CURRENT_KEY));

export const addPage = (page) => run('readwrite', (store) => store.add({ createdAt: Date.now(), ...page }), PAGES);
export const listPages = () => run('readonly', (store) => store.getAll(), PAGES);
export const deletePage = (id) => run('readwrite', (store) => store.delete(id), PAGES);
