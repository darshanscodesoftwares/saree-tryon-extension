// The switch between the two routes.
//
// This is the piece most worth testing and least worth testing by hand: every
// wrong answer here costs either money or a shop full of failed jobs, and the
// bad states are the ones nobody thinks to try - api mode with no key, auto
// falling back when the API refuses, the switch being flipped by someone who
// should not be able to.
//
// It spawns the real server on a spare port and talks to it over HTTP. No key
// is needed and no money is spent: the point is what happens AROUND the API
// call, and the only case that reaches one is proved by it being refused.
//
//   node test/mode.mjs

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFile } from "node:fs/promises";

const PORT = 5411;
const BASE = `http://localhost:${PORT}`;
const checks = [];
const ok = (name, pass, detail = "") => checks.push([name, pass, detail]);

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// A server with whatever environment the case needs. Each one is torn down
// before the next, so no case can be read as passing on the last one's state.
async function withServer(env, fn) {
  const child = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, PORT: String(PORT), OPENAI_API_KEY: "", CONTROL_KEY: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  try {
    for (let i = 0; i < 100; i++) {
      try { await fetch(`${BASE}/api/health`); break; } catch { await sleep(50); }
    }
    return await fn(() => log);
  } finally {
    child.kill();
    await sleep(60);
  }
}

const get = async (p) => (await fetch(BASE + p)).json();
const setMode = (mode, key) =>
  fetch(`${BASE}/api/mode`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "x-control-key": key } : {}) },
    body: JSON.stringify({ mode }),
  });
const postJob = () =>
  fetch(`${BASE}/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ person: PNG, saree: PNG, prompt: "test" }),
  });

// ---------------------------------------------------------------- no key

await withServer({}, async (logOf) => {
  const m = await get("/api/mode");
  ok("with no key it defaults to auto", m.mode === "auto", m.mode);
  // The whole safety of auto as a default: an existing install behaves
  // exactly as it did, because no key means no API.
  ok("and auto with no key serves through the extension", m.serving === "extension", m.serving);
  ok("it says the API is not ready", m.api.ready === false);

  const h = await get("/api/health");
  ok("health reports the route too", h.mode === "auto" && h.serving === "extension");

  // Offering a choice that would fail every job is worse than not offering it.
  const r = await setMode("api");
  ok("choosing api with no key is REFUSED", r.status === 409, `got ${r.status}`);
  ok("and the mode did not change", (await get("/api/mode")).mode === "auto");

  const r2 = await setMode("extension");
  ok("choosing extension is allowed", r2.ok);
  ok("and it stuck", (await get("/api/mode")).mode === "extension");

  ok("nonsense is refused", (await setMode("magic")).status === 400);

  // Nothing in this run should have reached the network.
  ok("the startup banner names the live route", /route\s+auto/.test(logOf()));
  ok("and warns the switch is unlocked", /flip that switch/.test(logOf()));
});

// -------------------------------------------------------------- with a key

await withServer({ OPENAI_API_KEY: "sk-not-a-real-key" }, async () => {
  const m = await get("/api/mode");
  ok("with a key, auto serves through the API", m.serving === "api", m.serving);
  ok("api mode is now choosable", (await setMode("api")).ok);

  // A deliberately bad key: the call is made and refused, which is what
  // proves the failure path is reached rather than skipped.
  const posted = await postJob();
  const body = await posted.json();
  ok("a job posted in api mode says so", body.via === "api", JSON.stringify(body));

  // No extension is connected, so there is nothing to fall back to and the
  // job must FAIL rather than sit waiting for a worker that will never come.
  let job = null;
  for (let i = 0; i < 100; i++) {
    job = await get(`/api/jobs/${body.id}`);
    if (job.state === "failed" || job.state === "done") break;
    await sleep(100);
  }
  ok("a refused call fails the job rather than hanging", job?.state === "failed", job?.state);
  ok("and the reason reaches the screen", (job?.notes ?? []).join(" ").length > 10, (job?.notes ?? []).join(" ").slice(0, 80));
});

// --------------------------------------------- what the SCREEN makes of it
//
// The regression that shipped: health grew a `serving` field and the kiosk
// was never taught to read it, so on the API route - with the server working
// perfectly - every screen said "please ask one of us" and the button stayed
// dead, because the only question it knew how to ask was whether a browser
// extension was connected.

{
  const client = await readFile(new URL("../webapp/tryon-client.js", import.meta.url), "utf8");
  const app = await readFile(new URL("../webapp/app.js", import.meta.url), "utf8");

  ok("the client passes `serving` on from health", /serving:\s*h\.serving/.test(client));
  ok("and defaults it for a server too old to send one", /h\.serving\s*\?\?\s*"extension"/.test(client));
  ok("the screen reads it", /serving/.test(app) && /canServe/.test(app));
  // The actual defect: readiness computed from `worker` alone.
  ok("readiness is NOT decided by the extension alone",
     !/ready\s*=\s*reachable\s*&&\s*worker\s*;/.test(app));
  ok("the API route counts as being able to serve",
     /serving\s*===\s*"api"\s*\|\|\s*worker/.test(app));
}

// Health has to carry it, or none of the above has anything to read.
await withServer({ OPENAI_API_KEY: "sk-not-a-real-key" }, async () => {
  const h = await get("/api/health");
  ok("health says which route is serving", h.serving === "api", h.serving);
  ok("and health still reports the extension separately", h.worker === false);
  // The shape the screen depends on: serving api, no extension, still fine.
  ok("api route + no extension is a servable state", h.serving === "api" && !h.worker);
});

// ------------------------------------------------------------- locked switch

await withServer({ CONTROL_KEY: "shh" }, async (logOf) => {
  ok("a locked switch says so", (await get("/api/mode")).locked === true);
  ok("flipping without the key is refused", (await setMode("extension")).status === 403);
  ok("the mode is unchanged after a refused flip", (await get("/api/mode")).mode === "auto");
  ok("flipping with the key works", (await setMode("extension", "shh")).ok);
  ok("and it stuck", (await get("/api/mode")).mode === "extension");
  ok("no unlocked warning when it is locked", !/flip that switch/.test(logOf()));
});

// -------------------------------------------------------------------- report

for (const [name, pass, detail] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `  -> ${detail}`}`);
}
const bad = checks.filter(([, p]) => !p).length;
console.log(bad ? `\n${bad} of ${checks.length} failed` : `\nall ${checks.length} passed`);
process.exit(bad ? 1 : 0);
