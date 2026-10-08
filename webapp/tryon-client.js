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
const DEADLINE = 240000;
const POLL_EVERY = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Can a picture be made right now? The queue knows whether a worker has asked
 * for anything lately, which is the difference between "the model is slow" and
 * "nobody is running the desktop page" - two waits that look identical from
 * here and need different things done about them.
 *
 * @returns {Promise<{reachable: boolean, worker: boolean, waiting: number}>}
 */
export async function available() {
  try {
    const r = await fetch(api("../api/health"), { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const h = await r.json();
    return { reachable: true, worker: Boolean(h.worker), waiting: h.waiting ?? 0 };
  } catch {
    return { reachable: false, worker: false, waiting: 0 };
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
 * @param onStage called with ("queued"|"working", note)
 * @returns {Promise<{image: string, notes: string[]}>}
 */
export async function generate({ person, saree, prompt, onStage }) {
  const posted = await fetch(api("../api/jobs"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ person, saree, prompt }),
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
