// What the result screen needs to survive a reload: the customer's photograph,
// the garment, and the picture that came back. Pictures are data URLs of a few
// hundred kilobytes each, past what localStorage will hold, so this is
// IndexedDB - one record, replaced every time.
//
// Nothing times out on its own: a visit lasts until somebody closes it. The
// sell-by date here is only a backstop for a screen abandoned for a whole day.
// It holds whatever has been done so far - sarees chosen, the photograph, the
// pictures made and which screen the customer was on - not only a result.

const DB = "saree-kiosk";
const STORE = "session";
const KEY = "result";

const open = () =>
  new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((ok, fail) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => ok(req?.result);
      tx.onerror = tx.onabort = () => fail(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * One or more sarees may be selected now, each generated on its own and kept
 * so switching between them is instant rather than a re-generation. `results`
 * is keyed by garment id; a garment with no entry yet simply has not been
 * tried on.
 *
 * @param {{person: string, selected: object[], results: Record<string, {image: string, notes: string[]}>, activeId: string}} s
 */
export const saveResult = (s) =>
  run("readwrite", (st) => st.put({ ...s, at: Date.now() }, KEY)).catch(() => {});

export const clearResult = () =>
  run("readwrite", (st) => st.delete(KEY)).catch(() => {});

/** @param maxAge milliseconds a saved result stays good for */
export async function loadResult(maxAge) {
  try {
    const s = await run("readonly", (st) => st.get(KEY));
    if (!s || (!s.person && !s.selected?.length)) return null;
    if (Date.now() - s.at > maxAge) { await clearResult(); return null; }
    return s;
  } catch {
    return null;
  }
}
