// Autosave of the current drawing, and the coloring pages the kid has made for the
// gallery, in IndexedDB (handles image Blobs, unlike localStorage).

const DB_NAME = 'drawingkid';
const STORE = 'documents';
const PAGES = 'pages'; // { id, createdAt, text, blob, thumb }
const CURRENT_KEY = 'current';

let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = (e) => {
      const db = request.result;
      if (e.oldVersion < 1) db.createObjectStore(STORE);
      if (e.oldVersion < 2) db.createObjectStore(PAGES, { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
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
