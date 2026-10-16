// The kiosk.
//
// Two attributes on <body> drive everything: data-stage (attract | choose |
// working | result) and data-photo (empty | live | still). CSS reacts to them,
// so there is no show/hide scattered through here and no state that exists
// only in a class name somewhere.
//
// It knows nothing about extensions, tabs or generators. It asks
// tryon-client.js for a picture and shows what comes back.

import { GARMENT_KINDS, DEFAULT_KIND, promptFor } from "../src/prompt.js";
import { available, garments, generate } from "./tryon-client.js";
import { progressAt } from "./progress.js";

const $ = (id) => document.getElementById(id);
const body = document.body;
const el = {
  status: $("status"), staff: $("staff"), debug: $("debug"),
  frame: $("frame"), video: $("video"), still: $("still"),
  start: $("start"), capture: $("capture"), retake: $("retake"),
  cancelcam: $("cancelcam"), upload: $("upload"),
  garmentsBox: $("garments"), go: $("go"),
  tabs: $("tabs"), pagecount: $("pagecount"),
  prevpage: $("prevpage"), nextpage: $("nextpage"),
  steps: $("steps"),
  chipYou: $("chip-you"), chipYouImg: $("chip-you-img"),
  chipGarment: $("chip-garment"), chipGarmentImg: $("chip-garment-img"),
  waitnote: $("waitnote"), waitsub: $("waitsub"), lottie: $("lottie"),
  pct: $("pct"), meter: $("meter"), meterfill: $("meterfill"),
  result: $("result"), before: $("before"), provenance: $("provenance"),
  compare: $("compare"), save: $("save"), another: $("another"), restart: $("restart"),
  attract: $("attract"), begin: $("begin"),
  idlewarn: $("idlewarn"), idlecount: $("idlecount"), stay: $("stay"),
};

// An attract screen and a timeout that erases your photograph are right for a
// shared screen in a shop and wrong for your own phone, where you opened this
// deliberately and nobody else is waiting. Both are therefore kiosk-only:
// forced with ?kiosk=1, or inferred from a big portrait screen.
const KIOSK =
  new URLSearchParams(location.search).has("kiosk") ||
  window.matchMedia("(min-width: 760px) and (orientation: portrait)").matches;

// Which kind of garment the rack is showing. Null until the shelf arrives,
// then the first kind that actually has something on it - never a tab that
// opens onto nothing.
let activeKind = null;

let stream = null;
let person = null;      // data URL
let garment = null;     // { id, kind, name, dataUrl }
let shelf = [];
let ready = false;
let lastDiagnostic = "nothing has gone wrong yet.";

const stage = (s) => { body.dataset.stage = s; paintSteps(); idle.restart(); };
const photo = (p) => { body.dataset.photo = p; };

// Written for a shopper. Anything that names the extension, the queue or
// chrome://extensions is a message for staff, and lives behind the ? button.
function say(customer, kind = "", diagnostic = null) {
  el.status.textContent = customer;
  el.status.className = `status ${kind}`;
  if (diagnostic) lastDiagnostic = diagnostic;
}

// ------------------------------------------------------------------ photo

function toDataUrl(source, w, h, mirror) {
  const side = Math.min(1024 / Math.max(w, h), 1);
  const c = document.createElement("canvas");
  c.width = Math.round(w * side);
  c.height = Math.round(h * side);
  const ctx = c.getContext("2d");
  if (mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.92);
  c.width = c.height = 0;          // let the bitmap go
  return url;
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  el.video.srcObject = null;
}

async function startCamera() {
  stopCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 } }, audio: false,
    });
  } catch (e) {
    return say("The camera isn't available here - you can still use a photo you already have.",
               "warn", `getUserMedia: ${e.name} ${e.message}`);
  }
  el.video.srcObject = stream;
  await el.video.play();
  photo("live");
}

function keepPhoto(dataUrl) {
  person = dataUrl;
  el.still.src = dataUrl;
  el.chipYouImg.src = dataUrl;
  el.chipYou.dataset.filled = "1";
  photo("still");
  refresh();
}

function dropPhoto() {
  person = null;
  // Removed, not emptied: an empty src resolves to the page URL in some
  // browsers and gets requested again.
  el.still.removeAttribute("src");
  el.chipYouImg.removeAttribute("src");
  delete el.chipYou.dataset.filled;
  photo("empty");
  refresh();
}

// ----------------------------------------------------------------- shelf

// The shelf: one kind at a time, in a rack that scrolls sideways.
//
// It used to stack every kind down the page under its own heading, so each
// kind the shop added made the page taller and pushed the next step further
// out of sight. Tabs keep the page the same height whatever is on the shelf,
// and a customer looking for a shirt never scrolls past the sarees.
function renderGarments() {
  const present = GARMENT_KINDS.filter((k) =>
    shelf.some((g) => (g.kind ?? DEFAULT_KIND) === k.id));

  // Never leave the tabs pointing at a kind that is no longer stocked - the
  // shelf is republished while the screen is open.
  if (!present.some((k) => k.id === activeKind)) activeKind = present[0]?.id ?? null;

  // --- the tabs -----------------------------------------------------------
  el.tabs.replaceChildren();
  // One kind is not a choice, and a single tab reads as a disabled control.
  el.tabs.hidden = present.length < 2;
  if (present.length > 1) {
    for (const kind of present) {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "tab";
      t.role = "tab";
      t.id = `tab-${kind.id}`;
      const on = kind.id === activeKind;
      t.setAttribute("aria-selected", String(on));
      // Roving tabindex: the tablist is one stop, and the arrows move within
      // it. Three tabs should not be three stops on the way to the garments.
      t.tabIndex = on ? 0 : -1;
      t.textContent = kind.name;
      const n = document.createElement("span");
      n.className = "tab-n";
      n.textContent = String(shelf.filter((g) => (g.kind ?? DEFAULT_KIND) === kind.id).length);
      t.appendChild(n);
      t.addEventListener("click", () => showKind(kind.id));
      t.addEventListener("keydown", (e) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const i = present.findIndex((k) => k.id === activeKind);
        const next = present[(i + step + present.length) % present.length];
        showKind(next.id);
        el.tabs.querySelector('[aria-selected="true"]')?.focus();
      });
      el.tabs.appendChild(t);
    }
  }

  // --- the rack -----------------------------------------------------------
  const mine = shelf.filter((g) => (g.kind ?? DEFAULT_KIND) === activeKind);
  const rack = document.createElement("div");
  rack.className = "rack";
  rack.role = "tabpanel";
  if (activeKind) rack.setAttribute("aria-labelledby", `tab-${activeKind}`);

  for (const g of mine) {
    // A real button: focusable, operable by keyboard, announced as pressed.
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tile";
    b.setAttribute("aria-pressed", String(garment?.id === g.id));
    const img = document.createElement("img");
    img.src = g.src;
    // Named, not decorative. A screen reader on a shelf of empty images has
    // nothing to choose between.
    img.alt = g.name;
    img.loading = "lazy";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = g.name;
    // Selection is drawn by CSS three ways - ring, tick and the name going
    // solid - so there is nothing to add here.
    b.append(img, name);
    b.addEventListener("click", () => choose(g));
    rack.appendChild(b);
  }

  el.garmentsBox.replaceChildren(rack);
  countShelf(mine.length);
  pagerState();
}

function showKind(id) {
  if (id === activeKind) return;
  activeKind = id;
  renderGarments();
  el.garmentsBox.querySelector(".rack")?.scrollTo({ left: 0 });
}

function countShelf(n) {
  const kind = GARMENT_KINDS.find((k) => k.id === activeKind);
  el.pagecount.textContent = !n
    ? "Nothing on this rack yet"
    : `${n} ${kind ? kind.name.toLowerCase() : "garments"}`;
}

// The arrows are only useful while there is somewhere to go, and a dead
// control a customer can still press is worse than one that is plainly spent.
function pagerState() {
  const rack = el.garmentsBox.querySelector(".rack");
  if (!rack) return;
  const over = rack.scrollWidth - rack.clientWidth;
  const at = rack.scrollLeft;
  const spare = over > 4;
  el.prevpage.disabled = !spare || at <= 2;
  el.nextpage.disabled = !spare || at >= over - 2;
  // Hidden entirely when everything already fits: two permanently dead arrows
  // read as something broken.
  el.prevpage.hidden = el.nextpage.hidden = !spare;
}

const nudge = (by) => {
  const rack = el.garmentsBox.querySelector(".rack");
  if (!rack) return;
  // A tile and a bit, so something new is always half in view to be reached for.
  const tile = rack.querySelector(".tile")?.getBoundingClientRect().width ?? 160;
  rack.scrollBy({ left: by * (tile + 12) * 2, behavior: "smooth" });
};
el.prevpage.addEventListener("click", () => nudge(-1));
el.nextpage.addEventListener("click", () => nudge(1));
el.garmentsBox.addEventListener("scroll", pagerState, { capture: true, passive: true });
addEventListener("resize", pagerState, { passive: true });


async function choose(g) {
  const src = g.src;
  garment = {
    id: g.id,
    kind: g.kind ?? DEFAULT_KIND,
    name: g.name,
    dataUrl: src.startsWith("data:") ? src : await urlToDataUrl(src),
  };
  el.chipGarmentImg.src = src;
  el.chipGarment.dataset.filled = "1";
  renderGarments();
  refresh();
}

const urlToDataUrl = async (url) =>
  new Promise(async (ok) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.readAsDataURL(await (await fetch(url)).blob());
  });

// ------------------------------------------------------------------- run

// The curve lives in progress.js so it can be checked without a browser - see
// test/progress.mjs. Everything here is just painting it.

let ticker = null;
let startedAt = 0;

function setMeter(v) {
  const p = Math.max(0, Math.min(100, v));
  el.pct.textContent = `${Math.round(p)}%`;
  el.meterfill.style.width = `${p}%`;
  el.meter.setAttribute("aria-valuenow", String(Math.round(p)));
}

function tick() {
  setMeter(progressAt((Date.now() - startedAt) / 1000));
}

function startMeter() {
  stopMeter();
  startedAt = Date.now();
  setMeter(0);
  ticker = setInterval(tick, 250);
}

// The clock restarts the moment it is actually being generated, so a wait in
// the queue does not spend the bar before the work has begun.
function meterFromNow() { startedAt = Date.now(); }

function stopMeter() { clearInterval(ticker); ticker = null; }

// Let 100% be seen before the picture replaces it, or the number never
// arrives anywhere and the bar just vanishes mid-climb.
async function completeMeter() {
  stopMeter();
  setMeter(100);
  await new Promise((r) => setTimeout(r, 650));
}

let anim = null;
function playSewing() {
  if (anim || !window.lottie) return;
  anim = window.lottie.loadAnimation({
    container: el.lottie, renderer: "svg", loop: true, autoplay: true,
    path: "anim/sewing.json",
  });
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    anim.addEventListener("DOMLoaded", () => anim.goToAndStop(120, true));
  }
}

function refresh() {
  el.go.disabled = !(person && garment && ready);
  paintSteps();
}

// WHAT EACH STEP STILL WANTS.
//
// Two numbered boxes with no status was the complaint, and it was fair: the
// numbers said there were three things to do and nothing said which one was
// live or what it was waiting for. Each step now carries its own state in
// words, so it does not depend on noticing a colour, and aria-current carries
// the same fact to anyone who cannot see one.
function paintSteps() {
  const at = body.dataset.stage === "result" ? "review"
           : !person ? "photo"
           : !garment ? "outfit"
           : "review";
  const state = {
    photo: person ? "Added" : "Needed",
    outfit: garment ? garment.name : "Needed",
    review: person && garment
      ? (body.dataset.stage === "result" ? "Done" : "Ready")
      : "Waiting",
  };
  for (const li of el.steps.querySelectorAll(".step")) {
    const id = li.dataset.step;
    const done = (id === "photo" && person) || (id === "outfit" && garment)
              || (id === "review" && body.dataset.stage === "result");
    li.dataset.state = done ? "done" : id === at ? "now" : "todo";
    if (id === at) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
    li.querySelector(".step-state").textContent = state[id];
  }
}

async function run() {
  let started = false;
  stage("working");
  playSewing();
  startMeter();
  el.waitnote.textContent = "Making your picture";
  el.waitsub.textContent = "This usually takes about a minute.";
  try {
    const { image, notes } = await generate({
      person,
      saree: garment.dataUrl,
      prompt: promptFor(garment.kind),
      // The big line stays constant. The small one carries the stage, and the
      // meter's clock only starts once it is really being generated.
      onStage: (s) => {
        if (s === "working" && !started) { started = true; meterFromNow(); }
        el.waitnote.textContent =
          s === "noworker" ? "Waiting for the shop's computer" : "Making your picture";
        el.waitsub.textContent =
          s === "noworker" ? "Nobody there has the extension running."
          : s === "queued" ? "Waiting its turn\u2026"
          : "This usually takes about a minute.";
      },
    });
    await completeMeter();
    el.result.src = image;
    el.before.src = person;
    lastDiagnostic = notes.join("\n");
    el.provenance.textContent = notes.join("\n");
    stage("result");
  } catch (e) {
    stopMeter();
    say("That didn't work. Shall we try again?", "bad", e.message);
    stage("choose");
  }
}

// ------------------------------------------------------------------ idle
//
// A kiosk left on a half-filled form looks like something somebody else
// abandoned, and it is showing a stranger's photograph while it does. So it
// times out, warns first (WCAG 2.2.1 wants at least 20 seconds' notice), and
// the reset genuinely erases rather than just navigating away.

const idle = {
  t: null, c: null, left: 20,
  limitFor: () =>
    KIOSK ? ({ choose: 45000, result: 90000, working: 0, attract: 0 }[body.dataset.stage] ?? 45000) : 0,
  restart() {
    clearTimeout(this.t); clearInterval(this.c);
    el.idlewarn.hidden = true;
    const ms = this.limitFor();
    if (!ms) return;                       // never during a generation
    this.t = setTimeout(() => this.warn(), ms);
  },
  warn() {
    this.left = 20;
    el.idlecount.textContent = String(this.left);
    el.idlewarn.hidden = false;
    this.c = setInterval(() => {
      el.idlecount.textContent = String(--this.left);
      if (this.left <= 0) { clearInterval(this.c); wipe(); }
    }, 1000);
  },
};

function wipe() {
  clearTimeout(idle.t); clearInterval(idle.c);
  el.idlewarn.hidden = true;
  stopCamera();
  dropPhoto();
  garment = null;
  el.chipGarmentImg.removeAttribute("src");
  delete el.chipGarment.dataset.filled;
  el.result.removeAttribute("src");
  el.before.removeAttribute("src");
  // Otherwise the next customer's picture arrives already wearing a tick.
  el.save.classList.remove("saved");
  body.classList.remove("comparing");
  renderGarments();
  refresh();
  if (KIOSK) { el.attract.hidden = false; stage("attract"); }
  else { stage("choose"); }
}

["pointerdown", "keydown"].forEach((ev) =>
  window.addEventListener(ev, () => { if (!el.idlewarn.hidden) return; idle.restart(); }, { passive: true }));

// ---------------------------------------------------------------- wiring

el.start.addEventListener("click", startCamera);
el.cancelcam.addEventListener("click", () => { stopCamera(); photo(person ? "still" : "empty"); });
el.capture.addEventListener("click", () => {
  const w = el.video.videoWidth, h = el.video.videoHeight;
  if (!w) return say("The camera hasn't started yet - one moment.", "warn", "videoWidth was 0");
  keepPhoto(toDataUrl(el.video, w, h, true));
  stopCamera();
});
el.retake.addEventListener("click", () => { dropPhoto(); });
// Refusals that say which rule was broken. "That did not work" sends somebody
// back to the same file; naming HEIC, or the size, tells them what to do next.
const TOO_BIG = 15 * 1024 * 1024;   // the server caps a whole job at 24MB of JSON

el.upload.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  if (/\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)) {
    return say("That is a HEIC photo, which this browser cannot open. Export it as JPEG and try again.",
               "warn", `HEIC refused before decoding: ${file.name}`);
  }
  if (file.size > TOO_BIG) {
    return say(`That photo is ${Math.round(file.size / 1024 / 1024)}MB, which is too big to send. Around 15MB is the limit.`,
               "warn", `${file.size} bytes > ${TOO_BIG}`);
  }
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return say("That file isn't a picture we can read. A JPEG, PNG or WebP works.", "warn", "createImageBitmap threw");
  }
  stopCamera();
  keepPhoto(toDataUrl(bmp, bmp.width, bmp.height, false));
  bmp.close();
});

el.chipYou.addEventListener("click", () => $("you").scrollIntoView({ behavior: "smooth", block: "center" }));
el.chipGarment.addEventListener("click", () => $("shelf").scrollIntoView({ behavior: "smooth", block: "start" }));
el.go.addEventListener("click", run);

// "Does that look like me" is the only question, and it is answered by a
// glance at the original rather than by any amount of copy.
// Taking the picture away.
//
// The job hands back a data URL whenever the harvester could read the bytes,
// and falls back to the generator's own CDN link only when it could not - so
// this has to cope with both. The download attribute is ignored outright on a
// cross-origin link, and the browser navigates to the picture instead, which
// on a phone loses the page the customer was looking at. Fetching to a blob
// first makes the saved file same-origin, and keeps the real file type rather
// than guessing .jpg over a PNG.
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

async function save() {
  const src = el.result.getAttribute("src");
  if (!src) return;
  const who = (garment?.name ?? "garment").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const when = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, "");
  try {
    const blob = await (await fetch(src)).blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `tryon-${who}-${when}.${EXT[blob.type] ?? "jpg"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked late: Safari reads the URL after click() has already returned.
    setTimeout(() => URL.revokeObjectURL(href), 10000);
    // The icon becomes a tick for a moment: a saved file is otherwise silent
    // on iOS, which shows no download shelf, and the customer presses again.
    el.save.classList.add("saved");
    setTimeout(() => el.save.classList.remove("saved"), 2500);
  } catch {
    // CORS refused us the bytes. Opening it is all that is left, and a long
    // press on the picture still saves it from there.
    window.open(src, "_blank", "noopener");
  }
}
el.save.addEventListener("click", save);

const compareOn = () => body.classList.add("comparing");
const compareOff = () => body.classList.remove("comparing");
["pointerdown"].forEach((e) => el.compare.addEventListener(e, compareOn));
["pointerup", "pointerleave", "pointercancel"].forEach((e) => el.compare.addEventListener(e, compareOff));

el.another.addEventListener("click", () => { garment = null; renderGarments(); refresh(); stage("choose"); });
el.restart.addEventListener("click", wipe);
el.begin.addEventListener("click", () => { el.attract.hidden = true; stage("choose"); });
el.stay.addEventListener("click", () => idle.restart());
el.staff.addEventListener("click", () => {
  el.debug.hidden = !el.debug.hidden;
  el.debug.textContent = lastDiagnostic;
});

// ------------------------------------------------------------------ boot

async function check() {
  const { reachable, worker, serving } = await available();
  // On the API route the server does the work itself, so whether a browser
  // with the extension is connected says nothing at all about whether a
  // customer can be served.
  const canServe = reachable && (serving === "api" || worker);
  if (!canServe) {
    say("This screen is having a moment - please ask one of us.", "warn",
        reachable ? "the server is up but no extension is working the queue"
                  : "cannot reach the server - is `npm start` running?");
  } else {
    say("Ready when you are", "ready", serving === "api" ? "all good - serving through the API" : "all good");
  }
  if (reachable) {
    const next = await garments().catch(() => shelf);
    if (next.length !== shelf.length || next.some((g, i) => g.id !== shelf[i]?.id)) {
      shelf = next;
      if (garment && !shelf.some((g) => g.id === garment.id)) garment = null;
      renderGarments();
    }
  }
  ready = canServe;
  refresh();
}

(async function boot() {
  if (KIOSK) { body.dataset.kiosk = "1"; el.attract.hidden = false; stage("attract"); }
  else { el.attract.hidden = true; stage("choose"); }
  await check();
  setInterval(check, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
})().catch((e) => say("This screen failed to start - please ask one of us.", "bad", String(e?.stack ?? e)));
