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

// ----------------------------------------------------------------- the queue
//
// A phone cannot run a browser extension, so it cannot drive a generator. This
// is how it borrows one: it posts a job here, the desktop - which does have an
// extension - takes the job, does the work, and posts the picture back.
//
// One machine with a generator open therefore serves any number of screens,
// which is also the shape the real thing has: tablets on the shop floor, one
// machine in the back. In memory on purpose; a job outlives nothing.

const jobs = new Map();            // id -> { state, request, image, notes, at }
let workerLastSeen = 0;            // so a screen can say "nobody is listening"
const waiters = new Set();         // long-polling workers, woken by a new job

// What the screens are allowed to offer. The bundled ones are read straight
// from the extension's own library, so there is one list and not two. The rest
// are whatever has been added through the side panel: the extension publishes
// them here, because a kiosk cannot read the extension's storage - different
// origin - and asking a shop to add every garment twice is not a workflow.
let published = [];
const catalogue = () => [
  ...BUNDLED.map((g) => ({ id: g.id, kind: g.kind, name: g.name, src: `/${g.image}` })),
  ...published,
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

  // Is anyone home?
  if (path === "/api/health" && req.method === "GET") {
    return json(res, 200, {
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
  let path = decodeURIComponent((req.url ?? "/").split("?")[0]);

  if (path.startsWith("/api/")) {
    // The phone and the desktop are different origins, so the screens need to
    // be allowed to call this. It serves one LAN and holds nothing private.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    try {
      return await api(req, res, path);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (path === "/") path = "/webapp/";
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

createServer(serve).listen(PORT, () =>
  console.log(`  desktop   http://localhost:${PORT}/webapp/      (the one that generates)`)
);

const lanAddress = () =>
  Object.values(networkInterfaces())
    .flat()
    .find((n) => n && n.family === "IPv4" && !n.internal)?.address;

if (existsSync(join(ROOT, "certs/cert.pem")) && existsSync(join(ROOT, "certs/key.pem"))) {
  createSecureServer(
    {
      cert: readFileSync(join(ROOT, "certs/cert.pem")),
      key: readFileSync(join(ROOT, "certs/key.pem")),
    },
    serve
  ).listen(HTTPS_PORT, () =>
    console.log(`  phone     https://${lanAddress() ?? "localhost"}:${HTTPS_PORT}/webapp/   (layout and camera only)`)
  );
} else {
  console.log(`  phone     no certs/ - see README, "Trying it on a phone"`);
}
