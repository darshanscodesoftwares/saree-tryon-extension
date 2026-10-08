// Two jobs. The old one: make the toolbar button open the side panel.
//
// The new one: be the worker. It long-polls the local queue for jobs that
// screens have posted, drives the generator tab, and posts the picture back.
// No page has to be left open for this and no screen has to know it happened,
// which is what lets a phone - a browser with no extensions at all - use the
// kiosk.
//
// Everything here is deliberately the only thing that knows a browser tab is
// involved. The kiosk talks HTTP to a queue and nothing else.

import { DEFAULT_KIND } from "./prompt.js";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ------------------------------------------------------------ the panel

// A side panel is global: once open it follows you from tab to tab, which is
// right for a shopkeeper's tool and wrong for a screen a customer is looking
// at. Disabling it per tab is the only way to keep it off the kiosk, so every
// tab gets told which it is.
const KIOSK = /^https?:\/\/(localhost|127\.0\.0\.1):5200\//;

async function setPanelFor(tab) {
  if (!tab?.id) return;
  try {
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: "src/panel.html",
      enabled: !KIOSK.test(tab.url ?? ""),
    });
  } catch {
    // A tab can be gone by the time this runs; that is not an error worth having.
  }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try { await setPanelFor(await chrome.tabs.get(tabId)); } catch {}
});
// url is only present when it actually changed, which is the moment a tab can
// become - or stop being - the kiosk.
chrome.tabs.onUpdated.addListener((_id, info, tab) => { if (info.url) setPanelFor(tab); });
// Tabs that already existed when the worker started, including after a reload
// of the extension itself.
const sweep = async () => (await chrome.tabs.query({})).forEach(setPanelFor);
chrome.runtime.onInstalled.addListener(sweep);
chrome.runtime.onStartup.addListener(sweep);
sweep();

// --------------------------------------------------------- the generator

const GENERATOR =
  /^https?:\/\/([^/]*\.)?(chatgpt\.com|chat\.openai\.com|gemini\.google\.com)\//;

async function generatorTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => t.url && GENERATOR.test(t.url)) ?? null;
}

// Which jobs are in flight. In session storage rather than a variable because
// this worker is allowed to die mid-generation, and the harvester's message is
// what wakes it up again - by which time a variable would be gone and the
// picture would have nowhere to go.
const remember = (id) => chrome.storage.session.set({ [`req:${id}`]: true });
const recall = async (id) => (await chrome.storage.session.get(`req:${id}`))[`req:${id}`];
const forget = (id) => chrome.storage.session.remove(`req:${id}`);

async function generate({ id, person, saree, prompt }) {
  const tab = await generatorTab();
  if (!tab) {
    return { ok: false, notes: ["no generator tab is open - open ChatGPT or Gemini in another tab"] };
  }
  const target = { tabId: tab.id };
  await chrome.scripting.executeScript({ target, files: ["src/inject.js"] });
  const [{ result: sent }] = await chrome.scripting.executeScript({
    target,
    func: (p) => window.__sareeBridge.run(p),
    args: [{
      images: [
        { name: "person.jpg", dataUrl: person },
        { name: "saree.jpg", dataUrl: saree },
      ],
      prompt,
      autoSend: true,
    }],
  });
  if (!sent?.ok || !sent.sent) {
    return { ok: false, notes: sent?.notes ?? ["the page would not take it"] };
  }
  // Only now start watching, so everything already on screen counts as "the
  // question" and anything new counts as "the answer".
  // Remembered BEFORE the watcher starts. The other way round leaves a gap in
  // which a result can arrive, find nothing remembered, and be dropped without
  // a word.
  await remember(id);
  await chrome.scripting.executeScript({ target, files: ["src/harvest.js"] });
  await chrome.scripting.executeScript({
    target,
    // The two we uploaded go with it, so the page can be asked the only
    // question that has a certain answer: is this picture one of mine?
    func: (rid, mine) => window.__sareeHarvest.start(rid, false, mine),
    args: [id, [person, saree]],
  });
  watch(tab.id, id, [person, saree]);      // not awaited: it outlives this call
  return { ok: true, pending: true, notes: sent.notes };
}

// How long anyone waits for one picture. Laddered on purpose: the watcher in
// the page gives up at 200s, this at 210s, the screen at 260s - so whoever
// gives up first has something to say, and nobody reports their own timeout
// when a real answer was a second away.
const GIVE_UP_AFTER = 210000;

// The watcher inside the page can die without saying so: the tab reloads, the
// page navigates, the injected context goes. Then a job hangs until the screen
// gives up, with the finished picture sitting on screen the whole time. So the
// worker checks back from outside rather than trusting the push.
async function watch(tabId, id, mine) {
  const until = Date.now() + GIVE_UP_AFTER;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 5000));
    if (!(await recall(id))) return;             // already delivered

    let state = null;
    try {
      [{ result: state }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.__sareeHarvest?.peek?.() ?? null,
      });
    } catch {
      return finish(id, { notes: ["the generator's tab was closed"] });
    }

    if (!state) {
      // Script gone but the tab alive: the page reloaded or navigated under
      // it. Put it back, told to take what is already there.
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ["src/harvest.js"] });
        await chrome.scripting.executeScript({
          target: { tabId },
          // Recovery skips the quiet period, so it needs the byte test more
          // than the first run does, not less.
          func: (rid, ours) => window.__sareeHarvest.start(rid, true, ours),
          args: [id, mine],
        });
      } catch { return finish(id, { notes: ["lost the generator's tab"] }); }
      continue;
    }

    if (state.done && state.payload) {
      const p = state.payload;
      const image = p.dataUrl || p.url || null;
      return finish(id, p.ok && image
        ? { image, notes: p.notes ?? [] }
        : { notes: p.notes ?? ["nothing that looked like a picture arrived"] });
    }
  }
  await finish(id, { notes: ["the generator did not finish in time"] });
}

// Deliver once, whoever gets there first - the push or the watcher.
async function finish(id, body) {
  if (!(await recall(id))) return;
  await forget(id);
  await deliver(id, body);
}

// ---------------------------------------------------------------- the queue

const QUEUE = "http://localhost:5200";

const deliver = (id, body) =>
  fetch(`${QUEUE}/api/jobs/${id}/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});

// ------------------------------------------------------------ the catalogue

// The side panel and this worker are the same origin, so a garment added in
// the panel is in a database this worker can read. It publishes them to the
// queue, which is how they reach a screen: a kiosk cannot read extension
// storage, and a phone has no extension at all. Without this a shopkeeper
// would have to add every garment twice, once for each place, which is not a
// workflow anyone would keep up.
function userGarments() {
  return new Promise((done) => {
    let req;
    try {
      req = indexedDB.open("saree-bridge", 1);
    } catch {
      return done([]);
    }
    req.onupgradeneeded = () => req.result.createObjectStore("sarees", { keyPath: "id" });
    req.onerror = () => done([]);
    req.onsuccess = () => {
      try {
        const all = req.result.transaction("sarees", "readonly").objectStore("sarees").getAll();
        all.onsuccess = () => done(all.result ?? []);
        all.onerror = () => done([]);
      } catch {
        done([]);
      }
    };
  });
}

// What the server last confirmed it holds from us. -1 means "we have never
// successfully told it", which is not the same as "we told it there were none".
let publishedCount = -1;

async function publishCatalogue() {
  const mine = (await userGarments()).map((g) => ({
    id: g.id,
    // Anything added before garments had kinds is a saree; that is all the
    // panel could offer then.
    kind: g.kind ?? DEFAULT_KIND,
    name: g.name,
    src: g.dataUrl,
  }));
  const r = await fetch(`${QUEUE}/api/garments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ garments: mine }),
  }).catch(() => null);
  publishedCount = r?.ok ? mine.length : -1;
}

let looping = false;

// One long poll at a time, forever, restarted by an alarm if it ever stops.
//
// 25 seconds per poll on purpose: Chrome stops an idle extension worker after
// about 30, and a fetch in flight counts as not idle - so the wait is also the
// heartbeat. Bounded iterations because a worker that has been alive for a
// very long time is worth recycling; the alarm picks it straight back up.
async function workLoop() {
  if (looping) return;
  looping = true;
  try {
    for (let i = 0; i < 20; i++) {
      const r = await fetch(`${QUEUE}/api/jobs/next?wait=25`, { cache: "no-store" });
      if (!r.ok) return;
      const job = await r.json();
      // The server holds the catalogue in memory, so restarting it loses ours.
      // Every reply says how much it has; if that disagrees with what we last
      // managed to send, send it again. Publishing only once per loop meant a
      // restarted server could show a kiosk three sarees for eight minutes.
      if (typeof job.published === "number" && job.published !== publishedCount) {
        await publishCatalogue();
      }
      if (!job.id) continue;
      // If sending failed there is nothing to wait for, so say so now rather
      // than leaving someone watching a spinner. If it worked, harvest.js
      // reports back later and the result is delivered from there.
      const out = await generate(job).catch((e) => ({ ok: false, notes: [e.message] }));
      if (!out.ok) await deliver(job.id, { notes: out.notes });
    }
  } catch {
    // The server is not running, or this worker was stopped mid-fetch. Either
    // way the alarm tries again shortly; there is nothing to report to.
  } finally {
    looping = false;
  }
}

chrome.alarms.create("work", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "work") workLoop(); });
chrome.runtime.onInstalled.addListener(workLoop);
chrome.runtime.onStartup.addListener(workLoop);
workLoop();

// The one message this worker receives: harvest.js in the generator's tab,
// saying the picture has arrived - possibly minutes later, and possibly after
// this worker has been stopped and started again.
chrome.runtime.onMessage.addListener((msg) => {
  // The panel, saying a garment was added or removed. Republishing at once
  // rather than on the next poll is what makes it appear on a kiosk while the
  // shopkeeper is still looking at it.
  if (msg?.type === "garments:changed") {
    publishCatalogue();
    return false;
  }

  if (msg?.type !== "tryon:harvested") return false;
  (async () => {
    const image = msg.dataUrl || msg.url || null;
    // The fast path. finish() delivers once, so if the watcher got here first
    // this does nothing.
    await finish(msg.id, msg.ok && image
      ? { image, notes: msg.notes ?? [] }
      : { notes: msg.notes ?? ["nothing that looked like a picture arrived"] });
    workLoop();                            // straight back to waiting
  })();
  return false;
});
