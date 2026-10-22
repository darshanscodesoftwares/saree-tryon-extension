// THE SEAM.
//
// The kiosk's whole view of the back end. It posts a job to a queue and waits
// for a picture - which is exactly the shape of an API call, deliberately, so
// that when there is a key to spend this file is rewritten against the real
// thing and nothing else moves.
//
// Nothing here knows what fulfils the job. Today it is a desktop browser with
// an extension, driving ChatGPT in another tab. Tomorrow it is an image API.
// A phone can use this file either way, which is the point of it existing:
// a phone browser has no extensions, so the kiosk must not need one.
//
// Keep that true. Anything the kiosk learns about tabs or extensions is a line
// that has to be unpicked later.

// Same origin: the queue is served by the same process that served this page,
// so a phone on the LAN and the desktop both reach their own copy of it.
const api = (path) => new URL(path, window.location.href).href;

// Long, because the wait is a real image model. A kiosk that gave up early
// would look broken more often than the model is slow.
const DEADLINE = 260000;
const POLL_EVERY = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Can a picture be made right now? The queue knows whether a worker has asked
 * for anything lately, which is the difference between "the model is slow" and
 * "nobody is running the desktop page" - two waits that look identical from
 * here and need different things done about them.
 *
 * `serving` is which route is live - "api" or "extension". It matters here
 * because "no extension is connected" is a fault on one route and completely
 * normal on the other, and a screen that cannot tell them apart tells a
 * customer to go and find a member of staff about a server that is working
 * perfectly.
 *
 * @returns {Promise<{reachable: boolean, worker: boolean, serving: string, waiting: number}>}
 */
export async function available() {
  try {
    const r = await fetch(api("../api/health"), { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const h = await r.json();
    return {
      reachable: true,
      worker: Boolean(h.worker),
      // Older servers do not send this. Reading it as the extension route
      // keeps them behaving exactly as they did.
      serving: h.serving ?? "extension",
      waiting: h.waiting ?? 0,
    };
  } catch {
    return { reachable: false, worker: false, serving: "extension", waiting: 0 };
  }
}

/**
 * What the screen may offer. It comes from the back end rather than from a
 * file here, so a garment the shopkeeper adds in the side panel appears on
 * every screen - including a phone, which has no way to read that storage.
 *
 * @returns {Promise<Array<{id: string, kind: string, name: string, src: string}>>}
 */
export async function garments() {
  const r = await fetch(api("../api/garments"), { cache: "no-store" });
  if (!r.ok) throw new Error(`could not load the garments (${r.status})`);
  return (await r.json()).garments ?? [];
}

/**
 * @param person  data URL of the customer
 * @param saree   data URL of the garment
 * @param prompt  the instruction
 * @param garment {name, kind}, so the history can say what each picture was of
 * @param onStage called with ("queued"|"working", note)
 * @returns {Promise<{image: string, notes: string[]}>}
 */
export async function generate({ person, saree, prompt, garment, onStage }) {
  const posted = await fetch(api("../api/jobs"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ person, saree, prompt, garment }),
  });
  if (!posted.ok) throw new Error(`the queue would not take it (${posted.status})`);
  const { id, worker } = await posted.json();
  // Said once, up front: if nobody is polling, the wait below is pointless and
  // the person in front of the screen should be told now rather than in four
  // minutes.
  onStage?.(worker ? "queued" : "noworker", id);

  const until = Date.now() + DEADLINE;
  let said = null;
  for (;;) {
    await sleep(POLL_EVERY);
    const r = await fetch(api(`../api/jobs/${id}`), { cache: "no-store" });
    if (!r.ok) throw new Error(`the job was lost (${r.status})`);
    const j = await r.json();

    if (j.state === "done" && j.image) return { image: j.image, notes: j.notes ?? [] };
    if (j.state === "failed") throw new Error((j.notes ?? ["it did not work"]).join("; "));

    // Only on a change, so the screen is not rewritten every poll.
    const stage = j.state === "running" ? "working" : j.worker ? "queued" : "noworker";
    if (stage !== said) { said = stage; onStage?.(stage, id); }

    if (Date.now() > until) throw new Error("no picture after four minutes");
  }
}

/**
 * Put a garment on the shelf from a screen.
 *
 * The extension used to be the only way, and once the API route is serving
 * there is no extension running at all - so without this a shopkeeper cannot
 * add a saree without a deploy.
 *
 * `kind` decides which instruction is sent with it, so it has to be the
 * category the shopkeeper was looking at, not a guess from the filename.
 *
 * It lasts as long as the server process: a free instance sleeps after fifteen
 * idle minutes and loses it. The caller is expected to say so.
 *
 * @param {{kind: string, name: string, dataUrl: string}} g
 * @returns {Promise<{id: string, temporary: boolean, total: number}>}
 */
export async function addGarment(g) {
  const r = await fetch(api("../api/garments/add"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(g),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `the server refused it (${r.status})`);
  return body;
}

/** Take one off again. Only ones added from a screen can be removed. */
export async function dropGarment(id) {
  const r = await fetch(api(`../api/garments/${id}`), { method: "DELETE" });
  if (!r.ok) throw new Error(`could not remove it (${r.status})`);
  return r.json();
}

// ---------------------------------------------------------------- history
//
// What this server has made since it last started. Memory on the server, so a
// restart or a redeploy empties it - which is the intent, not a limitation.
// Behind the control key when the server has one; `locked` says it asked.

const withKey = (key) => (key ? { "x-control-key": key } : {});
const locked = () => Object.assign(new Error("needs the control key"), { locked: true });

/** @returns {Promise<Array<{id: string, at: number, name: string, kind: string|null}>>} */
export async function history(key) {
  const r = await fetch(api("../api/history"), { cache: "no-store", headers: withKey(key) });
  if (r.status === 403) throw locked();
  if (!r.ok) throw new Error(`could not load the history (${r.status})`);
  return (await r.json()).history ?? [];
}

/**
 * One picture, as something an <img> can show. Fetched rather than linked
 * because the control key travels as a header, which an <img> cannot send.
 * The caller revokes the URL it gets back.
 */
export async function historyPicture(id, key) {
  const r = await fetch(api(`../api/history/${id}`), { cache: "no-store", headers: withKey(key) });
  if (r.status === 403) throw locked();
  if (!r.ok) throw new Error(`could not load that picture (${r.status})`);
  if ((r.headers.get("content-type") ?? "").includes("json")) return { src: (await r.json()).url, revoke: false };
  return { src: URL.createObjectURL(await r.blob()), revoke: true };
}

export async function clearHistory(key) {
  const r = await fetch(api("../api/history"), { method: "DELETE", headers: withKey(key) });
  if (r.status === 403) throw locked();
  if (!r.ok) throw new Error(`could not clear the history (${r.status})`);
}
