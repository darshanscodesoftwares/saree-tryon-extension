// Serves this folder two ways at once.
//
//   http://localhost:5200   for the desktop, where the extension works. The
//                           manifest's content script matches this origin and
//                           nothing else, so this is the only place a picture
//                           can actually be generated.
//
//   https://<lan ip>:5443   for a phone or a tablet on the same wifi. The
//                           kiosk's layout and its camera can be tried there.
//                           The bridge cannot: a phone browser has no
//                           extensions, so there is nothing to drive ChatGPT
//                           with. The page says so rather than failing quietly.
//
// HTTPS and not plain http for the second one because a browser will not give
// a page the camera from another machine over http - only localhost or https.
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { networkInterfaces } from "node:os";
import { randomUUID } from "node:crypto";
import { GARMENTS as BUNDLED } from "./src/library.js";
import * as imageApi from "./src/image-api.mjs";

// ----------------------------------------------------------------- the queue
//
// A phone cannot run a browser extension, so it cannot drive a generator. This
// is how it borrows one: it posts a job here, the desktop - which does have an
// extension - takes the job, does the work, and posts the picture back.
//
// One machine with a generator open therefore serves any number of screens,
// which is also the shape the real thing has: tablets on the shop floor, one
// machine in the back. In memory on purpose; a job outlives nothing.

// WHICH ROUTE SERVES A JOB.
//
//   extension  a browser with the extension open drives ChatGPT and reads the
//              answer back out of the page. Free, and needs that browser awake.
//   api        this server asks a paid image API directly. No browser at all.
//   auto       the API when there is a key, the extension when there is not -
//              and the extension as a catch if the API refuses mid-job, so a
//              shop does not stop selling because a card expired.
//
// auto is the default because with no key it behaves exactly like extension,
// which is what every existing install already does.
const MODES = ["extension", "api", "auto"];
let mode = MODES.includes(process.env.MODE) ? process.env.MODE : "auto";

// Flipping the switch spends money, so it can be held behind a shared secret.
// Unset, the switch is open - fine on one LAN, and said out loud at startup
// when it is not.
const CONTROL_KEY = process.env.CONTROL_KEY ?? "";
const mayControl = (req) => !CONTROL_KEY || req.headers["x-control-key"] === CONTROL_KEY;
// The history can be opened to everyone for a demo, without opening the route
// switch with it: this only ever relaxes the history's own check. Off unless
// asked for, because it is a list of customers' photographs.
const HISTORY_OPEN = /^(1|true|yes)$/i.test(process.env.HISTORY_OPEN ?? "");
const mayViewHistory = (req) => HISTORY_OPEN || mayControl(req);

// Whether a job should go to the API rather than to the queue.
const apiRoute = () => mode === "api" || (mode === "auto" && imageApi.ready());

const jobs = new Map();            // id -> { state, request, image, notes, at }
let workerLastSeen = 0;            // so a screen can say "nobody is listening"
const waiters = new Set();         // long-polling workers, woken by a new job

// What the screens are allowed to offer. The bundled ones are read straight
// from the extension's own library, so there is one list and not two. The rest
// are whatever has been added through the side panel: the extension publishes
// them here, because a kiosk cannot read the extension's storage - different
// origin - and asking a shop to add every garment twice is not a workflow.
let published = [];
// Added from a screen rather than from the extension. Kept apart from
// `published` on purpose: the extension REPLACES its whole list every time it
// republishes, so anything added here would be wiped by the next poll if the
// two shared a variable.
let addedHere = [];
const catalogue = () => [
  ...BUNDLED.map((g) => ({ id: g.id, kind: g.kind, name: g.name, src: `/${g.image}` })),
  ...published,
  ...addedHere,
];

// Whether the extension is talking to this server is the single most useful
// thing to know while setting this up, and it was invisible: the kiosk could
// only say "not ready" without being able to say why. So the terminal running
// the server says it out loud, and only on a change, so it stays readable.
let workerWasHere = false;
const WORKER_FRESH = 40000;
const workerIsHere = () => Date.now() - workerLastSeen < WORKER_FRESH;

function sawWorker() {
  workerLastSeen = Date.now();
  if (!workerWasHere) {
    workerWasHere = true;
    console.log("  + the extension is working the queue");
  }
}
// A long poll lasts 25s, so a worker that has not been seen in 40 has gone.
setInterval(() => {
  if (workerWasHere && !workerIsHere()) {
    workerWasHere = false;
    console.log("  - the extension stopped working the queue");
  }
}, 5000).unref?.();

// Old jobs are dropped rather than accumulated - a kiosk runs all day.
const REAP_AFTER = 10 * 60 * 1000;
const reap = () => {
  const cut = Date.now() - REAP_AFTER;
  for (const [id, j] of jobs) if (j.at < cut) jobs.delete(id);
};

// THE HISTORY: what has been made since this process started.
//
// Memory only, and meant to be. A free Render instance sleeps and redeploys
// and takes it with it, and that is the behaviour wanted: these are
// photographs of customers, so nothing here should outlive the server by any
// longer than it has to. Capped as well, so a busy day cannot fill the
// instance. Newest first.
const HISTORY_MAX = 30;
let history = [];
const remember = (id, j) => {
  if (!j.image || history.some((h) => h.id === id)) return;     // once per job
  const g = j.request?.garment;
  history.unshift({
    id,
    at: Date.now(),
    name: String(g?.name ?? "").slice(0, 80),
    kind: g?.kind ? String(g.kind).slice(0, 40) : null,
    image: j.image,
  });
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
};

// THE SERVER AS ITS OWN WORKER.
//
// A job still goes into the queue and the screen still polls for it, exactly
// as before - only the thing that picks it up changes. That is deliberate: the
// kiosk's waiting screen, its progress meter and its deadline all keep
// working, and none of them had to learn that there are now two routes.
async function runOnApi(id) {
  const j = jobs.get(id);
  if (!j) return;
  j.state = "running";
  j.at = Date.now();                 // or a slow call looks like an old job to reap()
  try {
    const { image, notes } = await imageApi.generate(j.request);
    j.state = "done";
    j.image = image;
    j.notes = notes;
    remember(id, j);
    console.log(`  job ${id.slice(0, 8)} delivered by the API`);
  } catch (e) {
    const why = String(e?.message ?? e);
    // In auto, a refusal is not the customer's problem if a browser is there
    // to take over. Out of credit at four o'clock should not close the shop.
    const canFallBack = mode === "auto" && workerIsHere();
    if (canFallBack) {
      j.notes.push(`the API refused, handing this to the extension - ${why}`);
      j.state = "waiting";
      const first = waiters.values().next().value;
      if (first) {
        j.state = "running";
        first({ id, ...j.request });
      }
      console.log(`  job ${id.slice(0, 8)} API refused, fell back to the extension: ${why}`);
    } else {
      j.state = "failed";
      j.notes.push(why);
      console.log(`  job ${id.slice(0, 8)} failed on the API: ${why}`);
    }
  }
  j.at = Date.now();
}

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

// The two images are data URLs, so a job is a few hundred kilobytes.
const BODY_LIMIT = 24 * 1024 * 1024;
async function readJson(req) {
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error("too big");
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

async function api(req, res, path) {
  reap();

  // A screen asks for a picture.
  if (path === "/api/jobs" && req.method === "POST") {
    const request = await readJson(req);
    if (!request?.person || !request?.saree) return json(res, 400, { error: "need person and saree" });
    const id = randomUUID();
    jobs.set(id, { state: "waiting", request, notes: [], at: Date.now() });

    // The switch. In api mode this server does the work itself, and does not
    // wait for the answer before replying - the screen polls for it, the same
    // way it polls for the extension's.
    if (apiRoute()) {
      runOnApi(id);
      console.log(`  job ${id.slice(0, 8)} posted - going to the API`);
      return json(res, 201, { id, worker: true, via: "api" });
    }

    const seen = workerIsHere();
    // Hand it straight to whoever is already waiting, so a job starts the
    // moment it arrives rather than on the next poll.
    const first = waiters.values().next().value;
    if (first) {
      const j = jobs.get(id);
      j.state = "running";
      first({ id, ...request });
    }
    console.log(`  job ${id.slice(0, 8)} posted${seen ? "" : " - but no extension is listening"}`);
    return json(res, 201, { id, worker: seen });
  }

  // The worker asks whether there is anything to do. Answering also records
  // that a worker exists, which is what lets a screen tell "nobody is running
  // the extension" apart from "the model is slow".
  //
  // With ?wait=N this HOLDS the request open until a job turns up or N seconds
  // pass. That is not just politeness: the worker is an extension service
  // worker, which Chrome stops a few seconds after it goes idle, and a fetch
  // in flight is what keeps it alive. A long poll therefore gives it a
  // heartbeat as a side effect of waiting.
  if (path === "/api/jobs/next" && req.method === "GET") {
    sawWorker();
    const take = () => {
      for (const [id, j] of jobs) {
        if (j.state === "waiting") {
          j.state = "running";
          j.at = Date.now();
          return { id, ...j.request };
        }
      }
      return null;
    };

    const now = take();
    if (now) return json(res, 200, { ...now, published: published.length });

    const wait = Math.min(Number(new URL(req.url, "http://x").searchParams.get("wait")) || 0, 55);
    if (!wait) return json(res, 200, { id: null, published: published.length });

    // Woken by the next POST /api/jobs rather than by polling in here.
    return new Promise((done) => {
      const give = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        waiters.delete(give);
        sawWorker();
        json(res, 200, payload ?? { id: null, published: published.length });
        done();
      };
      let settled = false;
      const timer = setTimeout(() => give(null), wait * 1000);
      // If the screen gives up and goes away, let go of the handler.
      req.on("close", () => give(null));
      waiters.add(give);
    });
  }

  // The worker hands back a picture, or says why there is not one.
  const done = path.match(/^\/api\/jobs\/([0-9a-f-]{36})\/result$/);
  if (done && req.method === "POST") {
    const j = jobs.get(done[1]);
    if (!j) return json(res, 404, { error: "no such job" });
    const body = await readJson(req);
    console.log(`  job ${done[1].slice(0, 8)} ${body.image ? "delivered" : "failed: " + (body.notes ?? []).join("; ")}`);
    j.state = body.image ? "done" : "failed";
    j.image = body.image ?? null;
    j.notes = body.notes ?? [];
    j.at = Date.now();
    remember(done[1], j);
    return json(res, 200, { ok: true });
  }

  // A screen asks whether its picture is ready.
  const one = path.match(/^\/api\/jobs\/([0-9a-f-]{36})$/);
  if (one && req.method === "GET") {
    const j = jobs.get(one[1]);
    if (!j) return json(res, 404, { error: "no such job" });
    return json(res, 200, {
      state: j.state,
      image: j.image ?? null,
      notes: j.notes,
      worker: workerIsHere(),
    });
  }

  // What a screen may offer.
  if (path === "/api/garments" && req.method === "GET") {
    return json(res, 200, { garments: catalogue() });
  }

  // The extension publishing what the shopkeeper has added.
  if (path === "/api/garments" && req.method === "POST") {
    const body = await readJson(req);
    const next = (body.garments ?? []).filter((g) => g && g.id && g.src);
    const changed = next.length !== published.length;
    published = next;
    if (changed) console.log(`  catalogue: ${catalogue().length} garments (${published.length} added in the panel)`);
    return json(res, 200, { ok: true, total: catalogue().length });
  }

  // A screen adds one garment. The extension cannot do this any more once the
  // API route is serving - there is no extension running - so this is the only
  // way a shopkeeper puts a saree on the shelf without a deploy.
  //
  // It lives only as long as this process: free instances sleep after fifteen
  // idle minutes and lose everything in memory. The screen says so rather
  // than letting somebody find out in the morning. tools/add-garment.mjs is
  // the permanent shelf.
  if (path === "/api/garments/add" && req.method === "POST") {
    const g = await readJson(req);
    if (!g?.dataUrl?.startsWith("data:image/")) return json(res, 400, { error: "need an image" });
    if (!g?.name?.trim()) return json(res, 400, { error: "need a name" });
    const kind = String(g.kind ?? "saree");
    const one = {
      id: `screen-${randomUUID().slice(0, 8)}`,
      kind,
      name: g.name.trim().slice(0, 80),
      src: g.dataUrl,
    };
    addedHere.push(one);
    console.log(`  catalogue: + ${one.name} (${kind}) from a screen - ${catalogue().length} in all, until this process restarts`);
    return json(res, 201, { ...one, temporary: true, total: catalogue().length });
  }

  // And takes one off again.
  const drop = path.match(/^\/api\/garments\/(screen-[0-9a-f]{8})$/);
  if (drop && req.method === "DELETE") {
    const before = addedHere.length;
    addedHere = addedHere.filter((g) => g.id !== drop[1]);
    // Only ones added from a screen: the bundled shelf is in the repository
    // and a DELETE here must not look like it can change that.
    if (addedHere.length === before) return json(res, 404, { error: "not one of this screen's" });
    return json(res, 200, { ok: true, total: catalogue().length });
  }

  // THE HISTORY. Behind the control key when there is one: it is a list of
  // customers' photographs, and the page that shows it is a staff page.
  if (path === "/api/history" && req.method === "GET") {
    if (!mayViewHistory(req)) return json(res, 403, { error: "wrong or missing control key" });
    return json(res, 200, { history: history.map(({ id, at, name, kind }) => ({ id, at, name, kind })) });
  }
  if (path === "/api/history" && req.method === "DELETE") {
    if (!mayViewHistory(req)) return json(res, 403, { error: "wrong or missing control key" });
    const n = history.length;
    history = [];
    console.log(`  history cleared (${n})`);
    return json(res, 200, { ok: true, cleared: n });
  }
  const pic = path.match(/^\/api\/history\/([0-9a-f-]{36})$/);
  if (pic && req.method === "GET") {
    if (!mayViewHistory(req)) return json(res, 403, { error: "wrong or missing control key" });
    const h = history.find((x) => x.id === pic[1]);
    if (!h) return json(res, 404, { error: "no such picture" });
    const m = /^data:([^;,]+)(;base64)?,/.exec(h.image);
    // The bytes themselves, so a thumbnail is an ordinary image and the list
    // above stays small. A picture the extension could only hand over as a
    // link is passed on as one.
    if (!m) return json(res, 200, { url: h.image });
    const bytes = m[2] ? Buffer.from(h.image.slice(m[0].length), "base64") : Buffer.from(decodeURIComponent(h.image.slice(m[0].length)));
    res.writeHead(200, { "content-type": m[1], "cache-control": "no-store" });
    return res.end(bytes);
  }

  // Is anyone home?
  // THE SWITCH. Read by anything, flipped by anyone holding the key.
  if (path === "/api/mode" && req.method === "GET") {
    return json(res, 200, {
      mode, modes: MODES,
      serving: apiRoute() ? "api" : "extension",
      api: { ready: imageApi.ready(), model: imageApi.MODEL, quality: imageApi.QUALITY, size: imageApi.SIZE },
      worker: workerIsHere(),
      locked: Boolean(CONTROL_KEY),
    });
  }
  if (path === "/api/mode" && req.method === "POST") {
    if (!mayControl(req)) return json(res, 403, { error: "wrong or missing control key" });
    const body = await readJson(req);
    if (!MODES.includes(body?.mode)) return json(res, 400, { error: `mode must be one of ${MODES.join(", ")}` });
    // Refused rather than accepted quietly: picking api with no key would
    // fail every job from here on, and the failure would arrive one customer
    // at a time instead of now.
    if (body.mode === "api" && !imageApi.ready()) {
      return json(res, 409, { error: "no OPENAI_API_KEY on this server, so api mode would fail every job" });
    }
    mode = body.mode;
    console.log(`  mode is now ${mode} (serving via the ${apiRoute() ? "API" : "extension"})`);
    return json(res, 200, { mode, serving: apiRoute() ? "api" : "extension" });
  }

  if (path === "/api/health" && req.method === "GET") {
    return json(res, 200, {
      mode,
      // What a screen actually needs to know: in api mode "no extension" is
      // not a fault, and saying "please ask one of us" would be a lie.
      serving: apiRoute() ? "api" : "extension",
      apiReady: imageApi.ready(),
      worker: workerIsHere(),
      garments: catalogue().length,
      // How stale, not just whether - "seen 90 seconds ago" and "never seen"
      // are different problems, and null says the extension has not once
      // spoken to this server since it started.
      workerSeenSecondsAgo: workerLastSeen ? Math.round((Date.now() - workerLastSeen) / 1000) : null,
      waiting: [...jobs.values()].filter((j) => j.state === "waiting").length,
    });
  }

  return json(res, 404, { error: "no such endpoint" });
}

const ROOT = new URL(".", import.meta.url).pathname;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

async function serve(req, res) {
  // A malformed percent-escape - "/%" is enough - makes decodeURIComponent
  // throw. That happens before either try block below, and createServer does
  // not await this function, so Node turns the rejection into an uncaught
  // exception and the process exits. On one LAN that was a curiosity; served
  // from the internet it is one request that takes the shop down and empties
  // the queue, repeatable by anyone who finds the address.
  let path;
  try {
    path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  } catch {
    res.writeHead(400);
    return res.end("bad path");
  }

  if (path.startsWith("/api/")) {
    // The phone and the desktop are different origins, so the screens need to
    // be allowed to call this. Note what this now means: deployed, these
    // endpoints are open to anyone who has the address, and a job carries a
    // customer's photograph. See the note on /api/jobs/next.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type, x-control-key");
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    try {
      return await api(req, res, path);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // Render serves this at the bare root, but the app lives in /webapp/.
  // Rewriting the path here would hand back the right page while the browser
  // still believed it was at "/", so every relative href in it - style.css,
  // app.js, the Lottie, the garment pictures - would be asked for one
  // directory too high and 404. The page arrived; nothing it needed did.
  // Redirect instead, so the address bar and the page agree.
  if (path === "/") {
    res.writeHead(302, { location: "/webapp/" });
    return res.end();
  }
  if (path.endsWith("/")) path += "index.html";
  const file = join(ROOT, normalize(path));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("no");
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

const PORT = Number(process.env.PORT) || 5200;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 5443;

// Which route is live is the first thing worth knowing from a terminal, and
// the one thing nobody thinks to check when every job is suddenly failing.
console.log(
  `  route     ${mode}` +
  (mode === "auto" ? (imageApi.ready() ? " -> the API (a key is set)" : " -> the extension (no key set)") : "") +
  (mode === "api" && !imageApi.ready() ? "  !! no OPENAI_API_KEY: every job will fail" : "")
);
if (!CONTROL_KEY) {
  console.log("            anyone who can reach this server can flip that switch - set CONTROL_KEY to hold it shut");
}

createServer(serve).listen(PORT, () =>
  console.log(`  desktop   http://localhost:${PORT}/webapp/      (the one that generates)\n  switch    http://localhost:${PORT}/webapp/control.html`)
);

const lanAddress = () =>
  Object.values(networkInterfaces())
    .flat()
    .find((n) => n && n.family === "IPv4" && !n.internal)?.address;

if (existsSync(join(ROOT, "certs/cert.pem")) && existsSync(join(ROOT, "certs/key.pem"))) {
  const secure = createSecureServer(
    {
      cert: readFileSync(join(ROOT, "certs/cert.pem")),
      key: readFileSync(join(ROOT, "certs/key.pem")),
    },
    serve
  );
  // The https listener is a convenience - it exists so a phone can reach the
  // camera, which browsers only allow over https. It is not the service. A
  // second copy of this server, or anything else already holding the port,
  // used to take the whole process down with it AFTER http had bound happily,
  // which reads as "the server will not start" when in fact it had.
  secure.on("error", (e) => {
    console.log(
      e.code === "EADDRINUSE"
        ? `  phone     port ${HTTPS_PORT} is taken - http is still serving (set HTTPS_PORT for a second copy)`
        : `  phone     https did not start: ${e.message}`
    );
  });
  secure.listen(HTTPS_PORT, () =>
    console.log(`  phone     https://${lanAddress() ?? "localhost"}:${HTTPS_PORT}/webapp/   (layout and camera only)`)
  );
} else {
  console.log(`  phone     no certs/ - see README, "Trying it on a phone"`);
}
