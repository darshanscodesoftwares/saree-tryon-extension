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
  chipYou: $("chip-you"), chipYouImg: $("chip-you-img"),
  chipGarment: $("chip-garment"), chipGarmentImg: $("chip-garment-img"),
  waitnote: $("waitnote"), waitsub: $("waitsub"), lottie: $("lottie"),
  pct: $("pct"), meter: $("meter"), meterfill: $("meterfill"),
  result: $("result"), before: $("before"),
  compare: $("compare"), another: $("another"), restart: $("restart"),
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

let stream = null;
let person = null;      // data URL
let garment = null;     // { id, kind, name, dataUrl }
let shelf = [];
let ready = false;
let lastDiagnostic = "nothing has gone wrong yet.";

const stage = (s) => { body.dataset.stage = s; idle.restart(); };
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

function renderGarments() {
  el.garmentsBox.replaceChildren();
  const present = GARMENT_KINDS.filter((k) =>
    shelf.some((g) => (g.kind ?? DEFAULT_KIND) === k.id));
  for (const kind of present) {
    const section = document.createElement("section");
    if (present.length > 1) {
      // A heading over the only kind on the shelf tells a customer nothing.
      const h = document.createElement("h3");
      h.className = "group";
      h.textContent = kind.name;
      section.appendChild(h);
    }
    const rack = document.createElement("div");
    rack.className = "rack";
    for (const g of shelf.filter((x) => (x.kind ?? DEFAULT_KIND) === kind.id)) {
      // A real button: focusable, operable by keyboard, announced as pressed.
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tile";
      b.setAttribute("aria-pressed", String(garment?.id === g.id));
      const img = document.createElement("img");
      img.src = g.src;
      img.alt = "";
      img.loading = "lazy";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = g.name;
      b.append(img, name);
      b.addEventListener("click", () => choose(g));
      rack.appendChild(b);
    }
    section.appendChild(rack);
    el.garmentsBox.appendChild(section);
  }
}

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
el.upload.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return say("That file isn't a picture we can read. A JPEG works best.", "warn", "createImageBitmap threw - likely HEIC");
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
  const { reachable, worker } = await available();
  if (!reachable || !worker) {
    say("This screen is having a moment - please ask one of us.", "warn",
        reachable ? "the server is up but no extension is working the queue"
                  : "cannot reach the server - is `npm start` running?");
  } else {
    say("Ready when you are", "ready", "all good");
  }
  if (reachable) {
    const next = await garments().catch(() => shelf);
    if (next.length !== shelf.length || next.some((g, i) => g.id !== shelf[i]?.id)) {
      shelf = next;
      if (garment && !shelf.some((g) => g.id === garment.id)) garment = null;
      renderGarments();
    }
  }
  ready = reachable && worker;
  refresh();
}

(async function boot() {
  if (KIOSK) { el.attract.hidden = false; stage("attract"); }
  else { el.attract.hidden = true; stage("choose"); }
  await check();
  setInterval(check, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
})().catch((e) => say("This screen failed to start - please ask one of us.", "bad", String(e?.stack ?? e)));
