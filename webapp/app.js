// The kiosk.
//
// Three things on <body> drive everything: data-stage (attract | choose-saree
// | you | working | result), data-photo (empty | live | still) and
// data-view (which selected saree's result is on screen). CSS reacts to
// them, so there is no show/hide scattered through here and no state that
// exists only in a class name somewhere.
//
// It knows nothing about extensions, tabs or generators. It asks
// tryon-client.js for a picture and shows what comes back.
//
// The journey is choose-the-saree, then the photograph, then the result -
// that order, not the reverse this app used to have - because the reference
// this was redesigned against is unambiguous about it and a kiosk customer
// arrives with no saree picked yet, so browsing first is the natural thing to
// let her do before asking her to pose for anything.

import { GARMENT_KINDS, DEFAULT_KIND, kindOf, promptFor } from "../src/prompt.js";
import { available, garments, generate, addGarment, dropGarment, dropLibraryGarment,
         history as listHistory, historyPicture, clearHistory } from "./tryon-client.js";
import { progressAt } from "./progress.js";
import { saveResult, clearResult, loadResult } from "./session.js";

const $ = (id) => document.getElementById(id);
const body = document.body;
const el = {
  status: $("status"), staff: $("staff"), debug: $("debug"),
  frame: $("frame"), video: $("video"), still: $("still"),
  start: $("start"), capture: $("capture"), retake: $("retake"),
  cancelcam: $("cancelcam"), upload: $("upload"),
  countdown: $("countdown"), countNum: $("countNum"),
  tabs: $("tabs"),
  addfile: $("addfile"), addlabel: $("addlabel"), addword: $("addword"),
  confirm: $("confirm"), confirmWhat: $("confirm-what"), confirmNote: $("confirm-note"),
  steps: $("steps"),
  heroImg: $("heroImg"), heroDots: $("heroDots"),
  heroPrev: $("heroPrev"), heroNext: $("heroNext"),
  heroName: $("heroName"), heroKind: $("heroKind"), heroSelect: $("heroSelect"),
  garmentsBox: $("garments"),
  goOutfit: $("goOutfit"), go: $("go"),
  chipYou: $("chip-you"), chipYouImg: $("chip-you-img"),
  chipGarment: $("chip-garment"), chipGarmentImg: $("chip-garment-img"),
  waitnote: $("waitnote"), waitsub: $("waitsub"), lottie: $("lottie"),
  pct: $("pct"), meter: $("meter"), meterfill: $("meterfill"),
  result: $("result"), before: $("before"), provenance: $("provenance"),
  selrailList: $("selrailList"), selrailAdd: $("selrailAdd"),
  chooseMore: $("chooseMore"),
  compare: $("compare"), save: $("save"), another: $("another"), restart: $("restart"),
  attract: $("attract"), begin: $("begin"),
  expand: $("expand"), viewer: $("viewer"), vStage: $("v-stage"), vImg: $("v-img"),
  vAfter: $("v-after"), vBefore: $("v-before"), vClose: $("v-close"),
  vIn: $("v-in"), vOut: $("v-out"), vReset: $("v-reset"),
  historyBtn: $("historybtn"), history: $("history"), hClose: $("history-close"),
  hKey: $("history-key"), hKeyIn: $("history-keyin"), hKeyGo: $("history-keygo"),
  hSay: $("history-say"), hGrid: $("history-grid"), hClear: $("history-clear"),
  idlewarn: $("idlewarn"), idlecount: $("idlecount"), stay: $("stay"),
};

// An attract screen and a timeout that erases your photograph are right for a
// shared screen in a shop and wrong for your own phone, where you opened this
// deliberately and nobody else is waiting. Both are therefore kiosk-only:
// forced with ?kiosk=1, or inferred from a big portrait screen.
const KIOSK =
  new URLSearchParams(location.search).has("kiosk") ||
  window.matchMedia("(min-width: 760px) and (orientation: portrait)").matches;

// Which kind of garment the pills and hero are showing. "all" is its own
// value, not one of GARMENT_KINDS, so a customer who does not think in our
// categories does not have to pick one.
const ALL = "all";
let activeKind = ALL;

// Where the hero is pointed, as an index into the CURRENTLY FILTERED list -
// not an id - because the prev/next arrows step through whatever the pills
// are showing right now.
let previewIndex = 0;

let stream = null;
let person = null;      // data URL
let shelf = [];          // every garment the server currently offers

// Chosen sarees, in the order they were chosen - the order the result rail
// numbers them in. Each entry is the full garment record (id, kind, name,
// dataUrl) so a result can still be generated after the shelf itself moves on.
let selected = [];
// What each chosen saree turned into, keyed by garment id. A garment with no
// entry here has not been generated yet.
let results = new Map();   // id -> { image, notes }
let activeId = null;       // which selected saree's result is on screen

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
    stream = await getCamera();
  } catch (e) {
    return say("The camera isn't available here - you can still use a photo you already have.",
               "warn", `getUserMedia: ${e.name} ${e.message}`);
  }
  el.video.srcObject = stream;
  // Show the frame BEFORE asking the video to play. While it is display:none,
  // Chrome on a desktop treats a muted autoplay video as not visible and holds
  // play() pending until it is - so the permission was granted, the camera
  // light came on, and the await below never returned, leaving the chooser on
  // screen. Phones do not apply that rule, which is why iOS worked.
  photo("live");
  try { await el.video.play(); } catch { /* autoplay is already set; a late start is fine */ }
  // A camera that was granted but never delivers a frame (another app holds
  // it, or the lid-camera is disabled) is otherwise a black box and no reason.
  setTimeout(() => {
    if (stream && body.dataset.photo === "live" && !el.video.videoWidth) {
      say("The camera is on but sending no picture. Is another app using it?",
          "warn", "no video frame 4s after getUserMedia resolved");
    }
  }, 4000);
}

// A laptop has no "user" facing mode to speak of, and some webcams refuse a
// width hint outright; ask for the nice thing first and then for anything.
async function getCamera() {
  const asks = [
    { video: { facingMode: "user", width: { ideal: 1280 } }, audio: false },
    { video: true, audio: false },
  ];
  let last;
  for (const ask of asks) {
    try { return await navigator.mediaDevices.getUserMedia(ask); }
    catch (e) {
      last = e;
      if (e.name === "NotAllowedError" || e.name === "SecurityError") break;
    }
  }
  throw last;
}

// "camera" for a picture the kiosk took, "upload" for a file chosen. A webcam
// or phone shot needs the extra prompt paragraph; a good upload does not.
let personSource = "camera";

function keepPhoto(dataUrl, source = "camera") {
  person = dataUrl;
  personSource = source;
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

// --------------------------------------------------------------- countdown
//
// Five seconds, large and central, before the frame is actually taken - the
// reference shows this prominently and nothing in the existing capture logic
// changes underneath it: the same canvas grab this app already did fires once
// the count reaches zero instead of the instant "Take the photo" was pressed.

let countTimer = null;

function cancelCountdown() {
  clearInterval(countTimer);
  countTimer = null;
  el.countdown.hidden = true;
  el.capture.disabled = false;
}

function runCountdown(onDone) {
  let n = 5;
  el.countdown.hidden = false;
  el.countNum.textContent = String(n);
  el.capture.disabled = true;
  countTimer = setInterval(() => {
    n -= 1;
    if (n <= 0) {
      cancelCountdown();
      onDone();
      return;
    }
    el.countNum.textContent = String(n);
  }, 1000);
}

// ----------------------------------------------------------------- shelf
//
// THE CATALOGUE: PILLS, A HERO, AND A RAIL.
//
// One saree shown large at a time - the hero - with prev/next arrows and a
// vertical rail of thumbnails either side by side with it. Both move the same
// state: which item in the currently filtered list is being previewed.
// Selecting is a separate act from previewing, which is what lets a customer
// browse past a dozen sarees while keeping the three she has already chosen.

function filteredList() {
  return activeKind === ALL ? shelf : shelf.filter((g) => (g.kind ?? DEFAULT_KIND) === activeKind);
}

function isSelected(id) {
  return selected.some((g) => g.id === id);
}

// Rebuilds the pills, the hero and the rail from `shelf`. Called whenever the
// catalogue itself changes (added, removed, or the 15-second poll finding a
// difference) - selection and preview position are both preserved across it
// where the thing they pointed at still exists.
function renderGarments() {
  const present = GARMENT_KINDS.filter((k) =>
    shelf.some((g) => (g.kind ?? DEFAULT_KIND) === k.id));

  // "All" first, then each kind actually stocked. One kind is not a choice.
  const choices = present.length > 1 ? [{ id: ALL, name: "All" }, ...present] : [];
  if (choices.length && !choices.some((k) => k.id === activeKind)) activeKind = ALL;

  el.tabs.replaceChildren();
  el.tabs.hidden = choices.length === 0;
  for (const kind of choices) {
    const t = document.createElement("button");
    t.type = "button";
    t.className = "tab";
    t.role = "tab";
    t.id = `tab-${kind.id}`;
    const on = kind.id === activeKind;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    t.textContent = kind.name;
    const n = document.createElement("span");
    n.className = "tab-n";
    n.textContent = String(kind.id === ALL ? shelf.length : shelf.filter((g) => (g.kind ?? DEFAULT_KIND) === kind.id).length);
    t.appendChild(n);
    t.addEventListener("click", () => showKind(kind.id));
    t.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const i = choices.findIndex((k) => k.id === activeKind);
      const next = choices[(i + step + choices.length) % choices.length];
      showKind(next.id);
      el.tabs.querySelector('[aria-selected="true"]')?.focus();
    });
    el.tabs.appendChild(t);
  }

  const list = filteredList();
  if (previewIndex >= list.length) previewIndex = Math.max(0, list.length - 1);
  renderHero(list);
  renderRail(list);
}

function showKind(id) {
  if (id === activeKind) return;
  activeKind = id;
  previewIndex = 0;
  renderGarments();
}

function renderHero(list) {
  const g = list[previewIndex];
  el.heroPrev.disabled = list.length < 2;
  el.heroNext.disabled = list.length < 2;
  if (!g) {
    el.heroImg.removeAttribute("src");
    el.heroImg.alt = "";
    el.heroName.textContent = "Nothing on this rack yet";
    el.heroKind.textContent = "";
    el.heroSelect.disabled = true;
    el.heroSelect.setAttribute("aria-pressed", "false");
    el.heroDots.replaceChildren();
    return;
  }
  el.heroImg.src = g.src;
  el.heroImg.alt = g.name;
  el.heroName.textContent = g.name;
  el.heroKind.textContent = kindOf(g.kind ?? DEFAULT_KIND).name;
  el.heroSelect.disabled = false;
  const on = isSelected(g.id);
  el.heroSelect.setAttribute("aria-pressed", String(on));

  // One dot per item, capped: a shelf of sixty garments does not need sixty
  // dots, and the rail already offers direct access to any of them.
  el.heroDots.replaceChildren();
  if (list.length > 1 && list.length <= 12) {
    list.forEach((_, i) => {
      const d = document.createElement("span");
      d.className = "hero-dot";
      if (i === previewIndex) d.setAttribute("data-on", "1");
      el.heroDots.appendChild(d);
    });
  }
}

function heroStep(by) {
  const list = filteredList();
  if (list.length < 2) return;
  previewIndex = (previewIndex + by + list.length) % list.length;
  renderHero(list);
  syncRailScroll();
}

function heroTo(id) {
  const list = filteredList();
  const i = list.findIndex((g) => g.id === id);
  if (i === -1) return;
  previewIndex = i;
  renderHero(list);
}

function toggleHeroSelect() {
  const list = filteredList();
  const g = list[previewIndex];
  if (!g) return;
  if (isSelected(g.id)) {
    selected = selected.filter((x) => x.id !== g.id);
    results.delete(g.id);
    if (activeId === g.id) activeId = selected[0]?.id ?? null;
  } else {
    selected.push({ id: g.id, kind: g.kind ?? DEFAULT_KIND, name: g.name, src: g.src });
  }
  renderHero(list);
  renderRail(list);
  renderSelRail();
  refresh();
}

function renderRail(list) {
  // The scrolling strip lives inside #garments (.rail-wrap), which only sets
  // up the container query - the grid/scroll behaviour itself is on this
  // inner element, rebuilt each time exactly as the old shelf's rack was.
  const rail = document.createElement("div");
  rail.className = "rail";
  for (const g of list) {
    // A real button: focusable, operable by keyboard, announced as pressed.
    const b = document.createElement("button");
    b.type = "button";
    b.className = "railtile";
    b.dataset.id = g.id;
    const previewed = g.id === (list[previewIndex]?.id);
    b.setAttribute("aria-current", String(previewed));
    b.setAttribute("aria-pressed", String(isSelected(g.id)));
    const img = document.createElement("img");
    img.src = g.src;
    img.alt = g.name;
    img.loading = "lazy";
    b.appendChild(img);
    b.addEventListener("click", () => heroTo(g.id));

    // Every tile carries a cross now, bundled or screen-added - the two go to
    // different endpoints underneath (askToRemove tells them apart), but a
    // shopkeeper looking at the shelf has no reason to know or care which
    // kind of garment they are looking at.
    const wrap = document.createElement("div");
    wrap.className = "railtile-wrap";
    const x = document.createElement("button");
    x.type = "button";
    x.className = "iconbtn drop";
    x.setAttribute("aria-label", `Remove ${g.name} from the shelf`);
    x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';
    x.addEventListener("click", (e) => { e.stopPropagation(); askToRemove(g); });
    wrap.append(b, x);
    rail.appendChild(wrap);
  }
  el.garmentsBox.replaceChildren(rail);
}

function syncRailScroll() {
  const list = filteredList();
  const g = list[previewIndex];
  if (!g) return;
  el.garmentsBox.querySelector(`[data-id="${CSS.escape(g.id)}"]`)
    ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

// Swipe the hero left or right to move through the rack. A mostly-vertical
// drag is left alone, and a swipe that ends on a button is not also a tap.
{
  let x0 = null, y0 = 0, swiped = false;
  const frame = el.heroImg.parentElement;
  frame.addEventListener("pointerdown", (e) => { x0 = e.clientX; y0 = e.clientY; swiped = false; });
  frame.addEventListener("pointerup", (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiped = true; heroStep(dx < 0 ? 1 : -1); }
  });
  frame.addEventListener("pointercancel", () => { x0 = null; });
  frame.addEventListener("click", (e) => { if (swiped) { e.stopPropagation(); e.preventDefault(); swiped = false; } }, true);
}
el.heroPrev.addEventListener("click", () => heroStep(-1));
el.heroNext.addEventListener("click", () => heroStep(1));
el.heroSelect.addEventListener("click", toggleHeroSelect);

// ------------------------------------------------------------- selection
//
// THE RESULT RAIL: one entry per chosen saree, in the order chosen, numbered
// the way the reference numbers them. A result is generated the first time
// its entry is reached, not all at once up front - which keeps this on the
// same single-job pipeline the app already had, just invoked once per saree
// instead of once in total.

function renderSelRail() {
  el.selrailList.replaceChildren();
  selected.forEach((g, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "selcard";
    b.dataset.id = g.id;
    const on = g.id === activeId;
    b.setAttribute("aria-current", String(on));
    const img = document.createElement("img");
    img.src = g.src;
    img.alt = g.name;
    const badge = document.createElement("span");
    badge.className = "selcard-n";
    badge.textContent = String(i + 1);
    // A quiet mark for "already tried on", distinct from the numbered badge
    // which only ever says the order chosen.
    if (results.has(g.id)) {
      const tick = document.createElement("span");
      tick.className = "selcard-done";
      tick.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
      b.appendChild(tick);
    }
    b.append(img, badge);
    b.addEventListener("click", () => showResult(g.id));
    el.selrailList.appendChild(b);
  });
  el.selrailList.hidden = selected.length === 0;
}

el.selrailAdd.addEventListener("click", () => goToStep("choose-saree"));
el.chooseMore.addEventListener("click", () => goToStep("choose-saree"));

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
  el.goOutfit.disabled = selected.length === 0;
  el.go.disabled = !(person && selected.length && ready);
  if (selected[0]) {
    el.chipGarmentImg.src = selected[0].src;
    el.chipGarment.dataset.filled = "1";
  } else {
    el.chipGarmentImg.removeAttribute("src");
    delete el.chipGarment.dataset.filled;
  }
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
           : body.dataset.stage === "you" ? "photo"
           : "outfit";
  const state = {
    outfit: !selected.length ? "Needed"
          : selected.length === 1 ? selected[0].name
          : `${selected.length} selected`,
    photo: person ? "Added" : "Needed",
    review: selected.length && person
      ? (body.dataset.stage === "result" ? "Done" : "Ready")
      : "Waiting",
  };
  for (const li of el.steps.querySelectorAll(".step")) {
    const id = li.dataset.step;
    const done = (id === "outfit" && selected.length) || (id === "photo" && person)
              || (id === "review" && body.dataset.stage === "result");
    li.dataset.state = done ? "done" : id === at ? "now" : "todo";
    if (id === at) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
    li.querySelector(".step-state").textContent = state[id];
  }
}

function goToStep(s) {
  if (s === "choose-saree") { stage("choose-saree"); return; }
  if (s === "you") { stage("you"); return; }
}

// Generates the picture for ONE selected saree, by id. Reuses the single
// full-screen wait this app already had - the only thing that changes with
// multiple sarees is that this can be called more than once in a visit.
async function runFor(id) {
  const g = selected.find((x) => x.id === id);
  if (!g) return;
  let started = false;
  stage("working");
  playSewing();
  startMeter();
  el.waitnote.textContent = "Making your picture";
  el.waitsub.textContent = "This usually takes about a minute.";
  try {
    const dataUrl = g.src.startsWith("data:") ? g.src : await urlToDataUrl(g.src);
    const { image, notes } = await generate({
      person,
      saree: dataUrl,
      prompt: promptFor(g.kind, { casual: personSource !== "upload" }),
      garment: { name: g.name, kind: g.kind },
      // The big line stays constant. The small one carries the stage, and the
      // meter's clock only starts once it is really being generated.
      onStage: (s) => {
        if (s === "working" && !started) { started = true; meterFromNow(); }
        el.waitnote.textContent =
          s === "noworker" ? "Waiting for the shop's computer" : "Making your picture";
        el.waitsub.textContent =
          s === "noworker" ? "Nobody there has the extension running."
          : s === "queued" ? "Waiting its turn…"
          : "This usually takes about a minute.";
      },
    });
    await completeMeter();
    results.set(id, { image, notes });
    showResult(id);
    persistSession();
  } catch (e) {
    stopMeter();
    say("That didn't work. Shall we try again?", "bad", e.message);
    stage(selected.length ? "result" : "choose-saree");
    if (!results.has(id)) {
      // Nothing to show for this one - fall back to whatever IS ready, or
      // back to choosing if nothing is.
      const anyReady = selected.find((x) => results.has(x.id));
      if (anyReady) showResult(anyReady.id); else stage("choose-saree");
    }
  }
}

// Puts an already-generated result on screen, or starts generating it if this
// is the first time it has been reached.
function showResult(id) {
  if (!results.has(id)) { runFor(id); return; }
  const g = selected.find((x) => x.id === id);
  const r = results.get(id);
  activeId = id;
  el.result.src = r.image;
  el.before.src = person;
  lastDiagnostic = r.notes.join("\n");
  el.provenance.textContent = r.notes.join("\n");
  renderSelRail();
  paintContinue();
  stage("result");
}

// "Continue" moves to the next selected saree that has not been reviewed yet
// if there is one, or simply the next in the ring if everything has been
// seen. With only one saree chosen there is nothing to continue TO, so the
// control is hidden rather than offered and left dead.
function paintContinue() {
  el.another.hidden = selected.length < 2;
  el.compare.hidden = false;
}

function continueToNext() {
  if (selected.length < 2) return;
  const i = selected.findIndex((g) => g.id === activeId);
  const notYet = selected.find((g) => !results.has(g.id));
  const next = notYet ?? selected[(i + 1) % selected.length];
  showResult(next.id);
}

function persistSession() {
  if (!person || !selected.length) return;
  const resultsObj = {};
  for (const [id, r] of results) resultsObj[id] = r;
  saveResult({ person, selected, results: resultsObj, activeId });
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
    KIOSK ? ({ "choose-saree": 45000, you: 45000, result: 90000, working: 0, attract: 0 }[body.dataset.stage] ?? 45000) : 0,
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
  clearResult();
  stopCamera();
  cancelCountdown();
  dropPhoto();
  selected = [];
  results.clear();
  activeId = null;
  previewIndex = 0;
  el.chipGarmentImg.removeAttribute("src");
  delete el.chipGarment.dataset.filled;
  closeViewer();
  closeHistory();
  el.vImg.removeAttribute("src");
  el.result.removeAttribute("src");
  el.before.removeAttribute("src");
  // Otherwise the next customer's picture arrives already wearing a tick.
  el.save.classList.remove("saved");
  body.classList.remove("comparing");
  renderGarments();
  renderSelRail();
  refresh();
  if (KIOSK) { el.attract.hidden = false; stage("attract"); }
  else { stage("choose-saree"); }
}

["pointerdown", "keydown"].forEach((ev) =>
  window.addEventListener(ev, () => { if (!el.idlewarn.hidden) return; idle.restart(); }, { passive: true }));

// ---------------------------------------------------------------- wiring

el.start.addEventListener("click", startCamera);
el.cancelcam.addEventListener("click", () => { stopCamera(); cancelCountdown(); photo(person ? "still" : "empty"); });
el.capture.addEventListener("click", () => {
  const w = el.video.videoWidth, h = el.video.videoHeight;
  if (!w) return say("The camera hasn't started yet - one moment.", "warn", "videoWidth was 0");
  runCountdown(() => {
    const w2 = el.video.videoWidth, h2 = el.video.videoHeight;
    if (!w2) return say("The camera stopped - one moment and try again.", "warn", "videoWidth was 0 at capture");
    keepPhoto(toDataUrl(el.video, w2, h2, true));
    stopCamera();
  });
});
el.retake.addEventListener("click", () => { cancelCountdown(); dropPhoto(); });
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
  keepPhoto(toDataUrl(bmp, bmp.width, bmp.height, false), "upload");
  bmp.close();
});

el.chipGarment.addEventListener("click", () => goToStep("choose-saree"));
el.chipYou.addEventListener("click", () => goToStep("you"));
el.goOutfit.addEventListener("click", () => goToStep("you"));
el.go.addEventListener("click", () => {
  activeId = selected[0]?.id ?? null;
  if (activeId) runFor(activeId);
});

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
  const g = selected.find((x) => x.id === activeId);
  const who = (g?.name ?? "saree").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
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

// Destroying something is worth one question first, and the question has to
// name the thing - "are you sure?" is not an answerable question when there
// are nine sarees on the rack.
//
// Two very different things happen underneath depending on where a garment
// came from, and the dialog says which one is about to happen rather than
// using the same reassuring sentence for both: one of these can be undone by
// adding the garment again, the other removes a line and a file from the
// repository and needs the control key, the same as flipping the API switch.
async function askToRemove(g) {
  const fromScreen = String(g.id).startsWith("screen-");
  el.confirmWhat.textContent = g.name;
  el.confirmNote.textContent = fromScreen
    ? "It will go from every screen. The shop's own list is not affected."
    : "This is on the shop's own permanent shelf. Removing it takes the file and its line in the catalogue - every screen loses it immediately, and it does not come back on its own.";
  el.confirm.showModal();
  const how = await new Promise((done) =>
    el.confirm.addEventListener("close", () => done(el.confirm.returnValue), { once: true }));
  if (how !== "go") return;
  try {
    // Visible from every screen right away either way. `persisted` only says
    // whether that is permanent or whether it returns after a restart -
    // worth knowing, since a shopkeeper who removed something by mistake and
    // watched it "come back" tomorrow deserves to know why.
    const persisted = fromScreen ? true : (await dropLibraryGarment(g.id, keyOf())).persisted;
    if (fromScreen) await dropGarment(g.id);

    selected = selected.filter((x) => x.id !== g.id);
    results.delete(g.id);
    shelf = await garments();
    renderGarments();
    renderSelRail();
    refresh();
    say(persisted
      ? `Removed ${g.name}.`
      : `Removed ${g.name} from every screen, but could not write it to the shop's own list - it may return after a restart.`,
      persisted ? "ready" : "warn");
  } catch (err) {
    // A locked bundled-delete reads exactly like the history panel's own
    // lock, because it is the same key - send them to where that key is
    // already typed in, rather than building a second place to enter it.
    say(err.locked
      ? "This needs the control key. Open History (the clock, top right) and unlock there first."
      : `Could not remove it: ${err.message}`, "warn");
  }
}

// ADDING A GARMENT FROM HERE.
//
// Once the API route is serving there is no extension running, so this is the
// only way a garment reaches the shelf without a deploy. It goes onto whichever
// rack is open, which is what gets it the right instruction.
//
// It lives as long as the server process does. On a free instance that is
// until fifteen idle minutes pass. Said out loud, because the alternative is
// a shopkeeper finding out in the morning.
const GARMENT_MAX = 1536;   // the weave is the point, so more than a face gets

el.addfile.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  if (/\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)) {
    return say("That is a HEIC photo, which this browser cannot open. Export it as JPEG first.", "warn");
  }
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return say("That file isn't a picture we can read. A JPEG, PNG or WebP works.", "warn");
  }
  const side = Math.min(GARMENT_MAX / Math.max(bmp.width, bmp.height), 1);
  const dataUrl = toDataUrl(bmp, Math.round(bmp.width * side), Math.round(bmp.height * side), false);
  bmp.close();

  const name = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 80);
  const kind = activeKind === ALL ? DEFAULT_KIND : activeKind;
  try {
    const added = await addGarment({ kind, name, dataUrl });
    shelf = await garments();
    renderGarments();
    heroTo(added.id);
    say(`Added ${name}. It stays until this server restarts - put it in the shop's own list to keep it.`, "ready");
  } catch (err) {
    say(`Could not add that: ${err.message}`, "warn");
  }
});

const compareOn = () => body.classList.add("comparing");
const compareOff = () => body.classList.remove("comparing");
["pointerdown"].forEach((e) => el.compare.addEventListener(e, compareOn));
["pointerup", "pointerleave", "pointercancel"].forEach((e) => el.compare.addEventListener(e, compareOff));

el.another.addEventListener("click", continueToNext);
el.restart.addEventListener("click", wipe);
el.begin.addEventListener("click", () => { el.attract.hidden = true; stage("choose-saree"); });
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
      // Drop any selection the shop itself removed from under us.
      const before = selected.length;
      selected = selected.filter((g) => shelf.some((s) => s.id === g.id));
      if (selected.length !== before) renderSelRail();
      renderGarments();
    }
  }
  ready = canServe;
  refresh();
}

// A reload on the result screen puts the result back. Only the back arrow
// (wipe) or Continue past everything, or the record growing stale, ends it.
const KEEP_FOR = KIOSK ? 3 * 60 * 1000 : 6 * 60 * 60 * 1000;

async function restore() {
  const saved = await loadResult(KEEP_FOR);
  if (!saved) return false;
  person = saved.person;
  selected = saved.selected;
  results = new Map(Object.entries(saved.results));
  activeId = saved.activeId && results.has(saved.activeId) ? saved.activeId : selected[0]?.id;
  el.still.src = person;
  el.chipYouImg.src = person;
  el.chipYou.dataset.filled = "1";
  photo("still");
  renderGarments();
  renderSelRail();
  refresh();
  if (activeId && results.has(activeId)) {
    const r = results.get(activeId);
    el.result.src = r.image;
    el.before.src = person;
    el.provenance.textContent = r.notes.join("\n");
    lastDiagnostic = r.notes.join("\n");
    paintContinue();
    el.attract.hidden = true;
    stage("result");
    return true;
  }
  return false;
}

(async function boot() {
  if (KIOSK) body.dataset.kiosk = "1";
  shelf = await garments().catch(() => []);
  renderGarments();
  if (await restore()) { /* straight back to the picture */ }
  else if (KIOSK) { el.attract.hidden = false; stage("attract"); }
  else { el.attract.hidden = true; stage("choose-saree"); }
  await check();
  setInterval(check, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
})().catch((e) => say("This screen failed to start - please ask one of us.", "bad", String(e?.stack ?? e)));


// ---------------------------------------------------------------- viewer
//
// Full screen, and zoomable: wheel or +/- on a desktop, pinch and drag on a
// phone. The picture is transformed about its centre; zooming about a point
// (the cursor, or the middle of a pinch) is just keeping that point still,
// which is the one line in zoomAt.

const Z_MIN = 1, Z_MAX = 6;
let zoom = { s: 1, x: 0, y: 0 };
let viewing = "after";
const pointers = new Map();
let pinch = null;

function paintZoom() {
  if (zoom.s <= Z_MIN) { zoom.x = 0; zoom.y = 0; }
  el.vImg.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`;
  el.vReset.textContent = `${Math.round(zoom.s * 100)}%`;
  el.vOut.disabled = zoom.s <= Z_MIN;
  el.vIn.disabled = zoom.s >= Z_MAX;
}

// Keep the picture from being dragged entirely off the stage: it may move only
// as far as its zoomed edge would leave the stage.
function clampPan() {
  const st = el.vStage.getBoundingClientRect();
  const w = el.vImg.offsetWidth * zoom.s, h = el.vImg.offsetHeight * zoom.s;
  const mx = Math.max(0, (w - st.width) / 2), my = Math.max(0, (h - st.height) / 2);
  zoom.x = Math.max(-mx, Math.min(mx, zoom.x));
  zoom.y = Math.max(-my, Math.min(my, zoom.y));
}

// (cx, cy) in client coordinates; the point under it stays under it.
function zoomAt(next, cx, cy) {
  next = Math.max(Z_MIN, Math.min(Z_MAX, next));
  const st = el.vStage.getBoundingClientRect();
  const px = cx - (st.left + st.width / 2), py = cy - (st.top + st.height / 2);
  const k = next / zoom.s;
  zoom.x = px - (px - zoom.x) * k;
  zoom.y = py - (py - zoom.y) * k;
  zoom.s = next;
  clampPan();
  paintZoom();
}

function zoomBy(factor) {
  const st = el.vStage.getBoundingClientRect();
  zoomAt(zoom.s * factor, st.left + st.width / 2, st.top + st.height / 2);
}

function showInViewer(which) {
  delete el.viewer.dataset.solo;
  viewing = which;
  const src = (which === "before" ? el.before : el.result).getAttribute("src");
  el.vImg.src = src ?? "";
  el.vImg.alt = which === "before" ? "The photograph you gave" : "You, wearing the saree you chose";
  el.vAfter.setAttribute("aria-pressed", String(which === "after"));
  el.vBefore.setAttribute("aria-pressed", String(which === "before"));
  zoom = { s: 1, x: 0, y: 0 };
  paintZoom();
}

function openViewer(which) {
  if (!(which === "before" ? el.before : el.result).getAttribute("src")) return;
  showInViewer(which);
  if (!el.viewer.open) el.viewer.showModal();
}

// One picture on its own, for the history: there is no "your photo" to switch
// to, so the switch is hidden rather than offered and left dead.
function openPicture(src, alt) {
  el.viewer.dataset.solo = "1";
  el.vImg.src = src;
  el.vImg.alt = alt;
  zoom = { s: 1, x: 0, y: 0 };
  paintZoom();
  if (!el.viewer.open) el.viewer.showModal();
}

function closeViewer() {
  if (el.viewer.open) el.viewer.close();
}

el.expand.addEventListener("click", () => openViewer("after"));
el.result.addEventListener("click", () => openViewer("after"));
el.before.addEventListener("click", () => openViewer("before"));
el.vAfter.addEventListener("click", () => showInViewer("after"));
el.vBefore.addEventListener("click", () => showInViewer("before"));
el.vClose.addEventListener("click", closeViewer);
el.vIn.addEventListener("click", () => zoomBy(1.5));
el.vOut.addEventListener("click", () => zoomBy(1 / 1.5));
el.vReset.addEventListener("click", () => { zoom = { s: 1, x: 0, y: 0 }; paintZoom(); });
// The backdrop is the dialog itself; the stage and controls fill it, so a
// click that lands on the dialog element is outside everything.
el.viewer.addEventListener("click", (e) => { if (e.target === el.viewer) closeViewer(); });
el.viewer.addEventListener("close", () => { el.vImg.removeAttribute("src"); pointers.clear(); pinch = null; });

el.vStage.addEventListener("wheel", (e) => {
  e.preventDefault();
  // ctrlKey is a trackpad pinch; the factor is gentler there.
  const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
  zoomAt(zoom.s * k, e.clientX, e.clientY);
}, { passive: false });

el.vStage.addEventListener("dblclick", (e) => {
  zoomAt(zoom.s > 1.01 ? 1 : 2.5, e.clientX, e.clientY);
});

const gap = () => {
  const [a, b] = [...pointers.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
};

el.vStage.addEventListener("pointerdown", (e) => {
  el.vStage.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  el.vStage.classList.add("dragging");
  if (pointers.size === 2) pinch = { ...gap(), s: zoom.s };
});

el.vStage.addEventListener("pointermove", (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (pointers.size === 2 && pinch) {
    p.x = e.clientX; p.y = e.clientY;
    const g = gap();
    zoomAt(pinch.s * (g.d / pinch.d), g.cx, g.cy);
    return;
  }
  if (zoom.s > 1) {
    zoom.x += e.clientX - p.x;
    zoom.y += e.clientY - p.y;
    clampPan();
    paintZoom();
  }
  p.x = e.clientX; p.y = e.clientY;
});

const lift = (e) => {
  pointers.delete(e.pointerId);
  pinch = null;
  if (!pointers.size) el.vStage.classList.remove("dragging");
};
el.vStage.addEventListener("pointerup", lift);
el.vStage.addEventListener("pointercancel", lift);

el.viewer.addEventListener("keydown", (e) => {
  if (e.key === "+" || e.key === "=") zoomBy(1.5);
  else if (e.key === "-" || e.key === "_") zoomBy(1 / 1.5);
  else if (e.key === "0") { zoom = { s: 1, x: 0, y: 0 }; paintZoom(); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    showInViewer(viewing === "after" ? "before" : "after");
  }
});


// --------------------------------------------------------------- history
//
// What the server has made since it last started, for staff. The server keeps
// it in memory and a restart empties it, so nothing here is stored: the
// pictures are fetched when the sheet opens and let go when it closes.
// Not on a kiosk - see the button in index.html.

const KEY_NAME = "saree-control-key";      // shared with control.html
const keyOf = () => { try { return localStorage.getItem(KEY_NAME) ?? ""; } catch { return ""; } };

let held = [];            // object URLs to give back
let loadRun = 0;          // a later open or a close cancels an earlier load

function releasePictures() {
  for (const u of held) URL.revokeObjectURL(u);
  held = [];
}

function closeHistory() {
  if (el.history.open) el.history.close();
}

const whenLabel = (at) => {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
};

async function loadHistory() {
  const run = ++loadRun;
  releasePictures();
  el.hGrid.replaceChildren();
  el.hKey.hidden = true;
  el.hClear.hidden = true;
  el.hSay.textContent = "Loading…";

  let items;
  try {
    items = await listHistory(keyOf());
  } catch (e) {
    if (run !== loadRun) return;
    if (e.locked) {
      el.hKey.hidden = false;
      el.hSay.textContent = keyOf() ? "That key was not accepted." : "This server asks for its control key.";
      el.hKeyIn.focus();
    } else {
      el.hSay.textContent = "Could not load the history. Try again in a moment.";
    }
    return;
  }
  if (run !== loadRun) return;

  if (!items.length) {
    el.hSay.textContent = "Nothing yet. Pictures made from now on will appear here.";
    return;
  }
  el.hSay.textContent = `${items.length} ${items.length === 1 ? "picture" : "pictures"}`;
  el.hClear.hidden = false;

  for (const it of items) {
    const card = document.createElement("button");
    card.className = "hcard";
    card.type = "button";
    const kind = GARMENT_KINDS.find((k) => k.id === it.kind);
    const what = it.name || (kind ? kind.name : "Picture");
    card.setAttribute("aria-label", `${what}, ${whenLabel(it.at)}. Open full screen.`);
    const img = document.createElement("img");
    img.alt = "";
    const cap = document.createElement("span");
    cap.className = "hcap";
    cap.textContent = what;
    const when = document.createElement("span");
    when.className = "hwhen";
    when.textContent = whenLabel(it.at);
    card.append(img, cap, when);
    el.hGrid.append(card);

    // One at a time, so thirty full-size pictures are not asked for at once.
    historyPicture(it.id, keyOf()).then(({ src, revoke }) => {
      if (run !== loadRun) { if (revoke) URL.revokeObjectURL(src); return; }
      if (revoke) held.push(src);
      img.src = src;
      card.addEventListener("click", () => openPicture(src, `${what}, made at ${whenLabel(it.at)}`));
    }).catch(() => { card.classList.add("missing"); });
  }
}

async function openHistory() {
  if (!el.history.open) el.history.showModal();
  await loadHistory();
}

el.historyBtn.addEventListener("click", openHistory);
el.hClose.addEventListener("click", closeHistory);
el.history.addEventListener("click", (e) => { if (e.target === el.history) closeHistory(); });
el.history.addEventListener("close", () => {
  loadRun++;
  releasePictures();
  el.hGrid.replaceChildren();
  armClear(false);
});

el.hKeyGo.addEventListener("click", () => {
  try { localStorage.setItem(KEY_NAME, el.hKeyIn.value.trim()); } catch {}
  loadHistory();
});
el.hKeyIn.addEventListener("keydown", (e) => { if (e.key === "Enter") el.hKeyGo.click(); });

// Clearing everything asks twice, in the button itself: the first press
// changes what it says, the second does it, and it relaxes on its own.
let armed = null;
function armClear(on) {
  clearTimeout(armed);
  el.hClear.textContent = on ? "Press again to clear all" : "Clear all";
  el.hClear.classList.toggle("danger-solid", on);
  if (on) armed = setTimeout(() => armClear(false), 3500);
}
el.hClear.addEventListener("click", async () => {
  if (!el.hClear.classList.contains("danger-solid")) return armClear(true);
  armClear(false);
  try { await clearHistory(keyOf()); } catch { el.hSay.textContent = "Could not clear it."; return; }
  loadHistory();
});
