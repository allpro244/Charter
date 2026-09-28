// Where the game is saved in the browser (D71). The save is still
// JSON.stringify(state) (CLAUDE.md rule 9); it lives in IndexedDB, which
// holds hundreds of megabytes, because a long game's save outgrows the
// five megabytes localStorage allows. A save left in localStorage by an
// older build is read once and moved over. Plain functions, no library.

const DB = 'charter';
const STORE = 'saves';
const KEY = 'current';
const LEGACY_KEY = 'charter.save';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('could not open the save store'));
  });
}

async function idbGet(): Promise<string | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
    req.onerror = () => reject(req.error ?? new Error('could not read the save'));
  });
}

async function idbPut(text: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(text, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('could not write the save'));
    tx.onabort = () => reject(tx.error ?? new Error('the save was aborted'));
  });
}

// The saved game as text, or null when there is none.
export async function loadSaveText(): Promise<string | null> {
  try {
    const text = await idbGet();
    if (text) return text;
  } catch {
    // Fall through to the legacy store.
  }
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      // Move it over; the legacy copy goes once the move succeeds.
      try {
        await idbPut(legacy);
        localStorage.removeItem(LEGACY_KEY);
      } catch {
        // Keep it where it is.
      }
      return legacy;
    }
  } catch {
    // Storage blocked.
  }
  return null;
}

// Saves the text. Resolves true when it is stored somewhere, false when
// neither store would take it (the export on Debug still works).
export async function storeSaveText(text: string): Promise<boolean> {
  try {
    await idbPut(text);
    return true;
  } catch {
    try {
      localStorage.setItem(LEGACY_KEY, text);
      return true;
    } catch {
      return false;
    }
  }
}
