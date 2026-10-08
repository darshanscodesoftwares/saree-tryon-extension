// The side panel: take a photograph, pick a saree, hand both to whatever
// generator is in the active tab with the prompt already written.
//
// Nothing here is sent anywhere by this extension. The images go into the page
// you are looking at, and what that page then does with them is between you
// and it - which is the whole privacy story, and why the footer says so.

import { GARMENTS } from "./library.js";
import { GARMENT_KINDS, DEFAULT_KIND, kindOf, promptFor } from "./prompt.js";

const $ = (id) => document.getElementById(id);
const el = {
  target: $("target"), shot: document.querySelector(".shot"), video: $("video"), still: $("still"),
  camera: $("camera"), start: $("start"), capture: $("capture"), retake: $("retake"),
  upload: $("upload"), uploadlabel: $("uploadlabel"),
  garments: $("garments"), addgarment: $("addgarment"), addkind: $("addkind"),
  garmentkind: $("garmentkind"), selectedrow: $("selectedrow"),
  removegarment: $("removegarment"), promptkind: $("promptkind"),
  prompt: $("prompt"), resetprompt: $("resetprompt"),
  autosend: $("autosend"), send: $("send"), status: $("status"),
};

// The instruction now lives in its own module: the kiosk front end sends the
// same one, and two copies would drift.

let stream = null;
let capture = null;        // { dataUrl }
let chosen = null;         // the selected garment { id, kind, name, dataUrl }
let userGarments = [];     // added through the panel, kept in this browser
let currentKind = DEFAULT_KIND;  // which instruction the prompt box is showing

const NOT_AN_IMAGE =
  "That file could not be read as an image.\n" +
  "  A photograph straight off an iPhone is often HEIC, which Chrome\n" +
  "  cannot decode - export or share it as JPEG first.";

const say = (text, bad = false) => {
  el.status.textContent = text;
  el.status.classList.toggle("bad", bad);
};

// ---------------------------------------------------------------- storage

// User-added sarees are blobs and there can be a catalogue of them, so they go
// in IndexedDB rather than chrome.storage, which is measured in megabytes.
const db = () =>
  new Promise((ok, no) => {
    const r = indexedDB.open("saree-bridge", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("sarees", { keyPath: "id" });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });

async function store(name, mode, fn) {
  const d = await db();
  return new Promise((ok, no) => {
    const tx = d.transaction(name, mode);
    const out = fn(tx.objectStore(name));
    tx.oncomplete = () => ok(out.result ?? out);
    tx.onerror = () => no(tx.error);
  });
}

// The store is still called "sarees": renaming it would orphan every garment
// added before this file learned that not all of them are sarees.
const loadUserGarments = () => store("sarees", "readonly", (s) => s.getAll());
const saveUserGarment = (rec) => store("sarees", "readwrite", (s) => s.put(rec));
const dropUserGarment = (id) => store("sarees", "readwrite", (s) => s.delete(id));

// ---------------------------------------------------------------- camera

async function listCameras() {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  el.camera.innerHTML = "";
  devices.forEach((d, i) => {
    const o = document.createElement("option");
    o.value = d.deviceId;
    o.textContent = d.label || `Camera ${i + 1}`;
    el.camera.appendChild(o);
  });
  el.camera.classList.toggle("hidden", devices.length < 2);
}

async function startCamera(deviceId) {
  stopCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user", width: { ideal: 1280 } },
      audio: false,
    });
  } catch (e) {
    say(`The camera was refused: ${e.message}`, true);
    return;
  }
  el.video.srcObject = stream;
  await el.video.play();
  el.shot.classList.add("live");
  el.shot.classList.remove("has-still");
  el.start.classList.add("hidden");
  el.capture.classList.remove("hidden");
  el.uploadlabel.classList.remove("hidden");
  el.retake.classList.add("hidden");
  capture = null;
  refresh();
  await listCameras();
  say("");
}

// Letting the tracks go also puts the camera light out, which matters in a
// shop: nobody should have to wonder whether it is still watching.
function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  el.video.srcObject = null;
  el.shot.classList.remove("live");
}

// The camera and an uploaded file meet here and leave as the same thing: one
// 1024px JPEG, which is enough for any generator and small enough to hand
// across into a page. Only the mirror differs - the preview is mirrored so the
// customer can pose in it, and a photograph is already the right way round.
function toCapture(source, w, h, mirror, max = 1024) {
  const side = Math.min(max / Math.max(w, h), 1);
  const c = document.createElement("canvas");
  c.width = Math.round(w * side);
  c.height = Math.round(h * side);
  const ctx = c.getContext("2d");
  if (mirror) {
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return { dataUrl: c.toDataURL("image/jpeg", 0.92) };
}

function takeStill() {
  const w = el.video.videoWidth, h = el.video.videoHeight;
  if (!w) return say("The camera has not produced a frame yet.", true);
  capture = toCapture(el.video, w, h, true);
  showStill("Retake");
}

// The customer who is not standing in front of you: the photograph that
// arrived by message, or the one taken before the panel was open.
async function usePhoto(file) {
  let bmp;
  try {
    // from-image, because a photograph off a phone carries its rotation in
    // EXIF and a canvas would otherwise lay the customer on their side.
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return say(NOT_AN_IMAGE, true);
  }
  // A photograph on screen and the camera still running is a confusing pair,
  // and the light would stay on for nothing.
  stopCamera();
  capture = toCapture(bmp, bmp.width, bmp.height, false);
  bmp.close();
  say("");
  showStill("Clear");
}

// One photograph is showing, however it arrived. The button beneath offers the
// only thing left to do with it, and that differs: a camera can be pointed
// again, a file can only be taken back off.
function showStill(undoLabel) {
  el.still.src = capture.dataUrl;
  el.shot.classList.add("has-still");
  el.capture.classList.add("hidden");
  el.uploadlabel.classList.add("hidden");
  el.retake.classList.remove("hidden");
  el.retake.textContent = undoLabel;
  refresh();
}

// ---------------------------------------------------------------- sarees

const fileToDataUrl = (file) =>
  new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => no(r.error);
    r.readAsDataURL(file);
  });

// A saree arrives as whatever a shop's phone produced: HEIC, a 4000px JPEG, a
// generated PNG. All of them have to reach the generator as the same kind of
// file, or comparing two sarees is partly comparing two cameras.
//
// Decoding here also catches HEIC at the point the file is chosen. Left raw it
// would travel all the way to the page labelled saree.jpg while still carrying
// image/heic, and be refused there with nothing to explain why.
const SAREE_MAX = 1536; // more than a face gets: the weave is the whole point

async function normaliseSaree(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { dataUrl } = toCapture(bmp, bmp.width, bmp.height, false, SAREE_MAX);
  bmp.close();
  return dataUrl;
}

async function renderGarments() {
  const bundled = GARMENTS.map((g) => ({ ...g, src: chrome.runtime.getURL(g.image), bundled: true }));
  // Anything saved before garments had kinds is a saree, because that is all
  // this panel could offer at the time.
  const mine = userGarments.map((g) => ({ kind: DEFAULT_KIND, ...g, src: g.dataUrl, bundled: false }));
  el.garments.innerHTML = "";
  for (const s of [...bundled, ...mine]) {
    const fig = document.createElement("figure");
    fig.dataset.id = s.id;
    if (chosen?.id === s.id) fig.classList.add("on");
    // Built rather than interpolated: a user saree's name is its filename, and
    // a filename is not markup. The page CSP stops it becoming script, but
    // there is no reason to put someone else's angle brackets in the DOM.
    const img = document.createElement("img");
    img.src = s.src;
    img.alt = "";
    const cap = document.createElement("figcaption");
    cap.textContent = s.name;
    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = kindOf(s.kind).name;
    cap.appendChild(kind);
    fig.append(img, cap);
    fig.addEventListener("click", async () => {
      chosen = {
        id: s.id,
        kind: s.kind ?? DEFAULT_KIND,
        name: s.name,
        dataUrl: s.bundled ? await urlToDataUrl(s.src) : s.dataUrl,
      };
      // Only one added here can be changed; a bundled one is a line in
      // library.js and belongs to the repository, not to this browser.
      el.selectedrow.classList.toggle("hidden", s.bundled);
      el.garmentkind.value = chosen.kind;
      // Choosing a garment chooses its instruction. A saree prompt sent with a
      // shirt asks the model to drape a pallu that does not exist.
      await showPromptFor(chosen.kind);
      renderGarments();
      refresh();
    });
    el.garments.appendChild(fig);
  }
}

async function urlToDataUrl(url) {
  const blob = await (await fetch(url)).blob();
  return fileToDataUrl(blob);
}

// ---------------------------------------------------------------- the tab

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

const originOf = (url) => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? `${u.origin}/*` : null;
  } catch {
    return null;
  }
};

let tabState = { tab: null, origin: null, granted: false };

async function checkTab() {
  const tab = await activeTab();
  const origin = tab ? originOf(tab.url) : null;
  const granted = origin ? await chrome.permissions.contains({ origins: [origin] }) : false;
  tabState = { tab, origin, granted };
  const host = origin ? new URL(tab.url).host : null;
  el.target.className = "sub";
  if (!origin) {
    el.target.textContent = "Open the generator in a tab (it must be http or https).";
  } else if (granted) {
    el.target.textContent = `Ready to send to ${host}`;
    el.target.classList.add("ready");
  } else {
    el.target.textContent = `${host} - not allowed yet; Send will ask.`;
    el.target.classList.add("warn");
  }
  refresh();
}

// ---------------------------------------------------------------- send

async function send() {
  if (!tabState.origin) return say("No http(s) tab is in front.", true);
  if (!tabState.granted) {
    // Must be asked from a click, which is why it lives here and not in checkTab.
    const ok = await chrome.permissions.request({ origins: [tabState.origin] });
    if (!ok) return say("Without permission for this site the panel cannot reach its page.", true);
    tabState.granted = true;
  }
  const images = [
    { name: "person.jpg", dataUrl: capture.dataUrl },
    { name: "saree.jpg", dataUrl: chosen.dataUrl },
  ];
  say("sending...");
  el.send.disabled = true;
  try {
    const target = { tabId: tabState.tab.id };
    await chrome.scripting.executeScript({ target, files: ["src/inject.js"] });
    const [{ result }] = await chrome.scripting.executeScript({
      target,
      func: (payload) => window.__sareeBridge.run(payload),
      args: [{ images, prompt: el.prompt.value, autoSend: el.autosend.checked }],
    });
    const lines = (result?.notes ?? []).map((n) => `  ${n}`).join("\n");
    if (result?.ok) {
      say(`${result.sent ? "Sent." : "Ready - press send on the page."}\n${lines}`);
    } else {
      say(`Could not do all of it:\n${lines}\n\n  If this site is new, its adapter may need a selector - see src/inject.js.`, true);
    }
  } catch (e) {
    say(`Failed: ${e.message}`, true);
  } finally {
    el.send.disabled = false;
    refresh();
  }
}

// ---------------------------------------------------------------- wiring

function refresh() {
  el.send.disabled = !(capture && chosen && tabState.origin);
}

el.start.addEventListener("click", () => startCamera());
el.camera.addEventListener("change", () => startCamera(el.camera.value));
el.capture.addEventListener("click", takeStill);
el.retake.addEventListener("click", () => {
  capture = null;
  el.shot.classList.remove("has-still");
  el.retake.classList.add("hidden");
  el.uploadlabel.classList.remove("hidden");
  // Back to the live preview if the camera is still on, and to the empty box
  // if the photograph came from a file, which turned it off.
  el.capture.classList.toggle("hidden", !stream);
  el.start.classList.toggle("hidden", Boolean(stream));
  refresh();
});

el.upload.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (file) await usePhoto(file);
  // Cleared so that picking the same file again after a Clear still fires.
  e.target.value = "";
});

// ---------------------------------------------------------------- prompts

// One prompt per kind, each separately editable and separately remembered, so
// rewriting the saree instruction does not quietly rewrite the one sent with a
// suit.
async function showPromptFor(kind) {
  currentKind = kind;
  const { prompts } = await chrome.storage.local.get("prompts");
  el.prompt.value = prompts?.[kind] ?? promptFor(kind);
  el.promptkind.textContent = `\u00b7 ${kindOf(kind).name.toLowerCase()}`;
}

async function rememberPrompt(text) {
  const { prompts } = await chrome.storage.local.get("prompts");
  await chrome.storage.local.set({ prompts: { ...(prompts ?? {}), [currentKind]: text } });
}

el.addgarment.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  let dataUrl;
  try {
    dataUrl = await normaliseSaree(file);
  } catch {
    e.target.value = "";
    return say(NOT_AN_IMAGE, true);
  }
  const rec = {
    id: `user-${Date.now()}`,
    kind: el.addkind.value || DEFAULT_KIND,
    name: file.name.replace(/\.[^.]+$/, ""),
    dataUrl,
  };
  await saveUserGarment(rec);
  userGarments = await loadUserGarments();
  // So it reaches the kiosk screens too, which cannot read this storage.
  chrome.runtime.sendMessage({ type: "garments:changed" }).catch(() => {});
  chosen = rec;
  el.selectedrow.classList.remove("hidden");
  el.garmentkind.value = rec.kind;
  await showPromptFor(rec.kind);
  renderGarments();
  refresh();
  e.target.value = "";
});

el.removegarment.addEventListener("click", async () => {
  if (!chosen || chosen.id.startsWith("user-") === false) return;
  await dropUserGarment(chosen.id);
  userGarments = await loadUserGarments();
  chrome.runtime.sendMessage({ type: "garments:changed" }).catch(() => {});
  chosen = null;
  el.selectedrow.classList.add("hidden");
  renderGarments();
  refresh();
});

// Changing what a garment IS, after the fact. Without this, anything added
// before kinds existed is stuck being a saree, and the only way to correct a
// mistake is to delete it and upload the file again.
el.garmentkind.addEventListener("change", async () => {
  if (!chosen || !chosen.id.startsWith("user-")) return;
  const rec = (await loadUserGarments()).find((g) => g.id === chosen.id);
  if (!rec) return;
  rec.kind = el.garmentkind.value;
  await saveUserGarment(rec);
  userGarments = await loadUserGarments();
  chosen.kind = rec.kind;
  chrome.runtime.sendMessage({ type: "garments:changed" }).catch(() => {});
  await showPromptFor(rec.kind);
  renderGarments();
});

el.prompt.addEventListener("input", () => rememberPrompt(el.prompt.value));
el.resetprompt.addEventListener("click", async () => {
  // Forgets the override rather than storing the default, so a later change to
  // the shipped wording reaches anyone who has not deliberately rewritten it.
  const { prompts } = await chrome.storage.local.get("prompts");
  const kept = { ...(prompts ?? {}) };
  delete kept[currentKind];
  await chrome.storage.local.set({ prompts: kept });
  el.prompt.value = promptFor(currentKind);
});
el.autosend.addEventListener("change", () => chrome.storage.local.set({ autoSend: el.autosend.checked }));
el.send.addEventListener("click", send);

chrome.tabs.onActivated.addListener(checkTab);
chrome.tabs.onUpdated.addListener((_id, info) => info.url && checkTab());

(async function boot() {
  for (const select of [el.addkind, el.garmentkind]) {
    for (const k of GARMENT_KINDS) {
      const o = document.createElement("option");
      o.value = k.id;
      o.textContent = k.name;
      select.appendChild(o);
    }
  }
  const saved = await chrome.storage.local.get(["prompt", "prompts", "autoSend"]);
  // There used to be one prompt for everything. Carry it across as the saree's
  // override rather than throwing away someone's rewrite.
  if (saved.prompt && !saved.prompts) {
    await chrome.storage.local.set({ prompts: { [DEFAULT_KIND]: saved.prompt } });
    await chrome.storage.local.remove("prompt");
  }
  el.autosend.checked = Boolean(saved.autoSend);
  await showPromptFor(DEFAULT_KIND);
  userGarments = await loadUserGarments().catch(() => []);
  await renderGarments();
  await checkTab();
})();
