// The side panel: take a photograph, pick a saree, hand both to whatever
// generator is in the active tab with the prompt already written.
//
// Nothing here is sent anywhere by this extension. The images go into the page
// you are looking at, and what that page then does with them is between you
// and it - which is the whole privacy story, and why the footer says so.

import { SAREES } from "./library.js";

const $ = (id) => document.getElementById(id);
const el = {
  target: $("target"), shot: document.querySelector(".shot"), video: $("video"), still: $("still"),
  camera: $("camera"), start: $("start"), capture: $("capture"), retake: $("retake"),
  sarees: $("sarees"), addsaree: $("addsaree"), removesaree: $("removesaree"),
  prompt: $("prompt"), resetprompt: $("resetprompt"),
  autosend: $("autosend"), send: $("send"), status: $("status"),
};

// Everything learned from cutting these garments by hand, written as an
// instruction instead. The two rules that matter are the two things a
// generator will otherwise drift: the person must stay the same person, and
// the saree must stay the same saree.
const DEFAULT_PROMPT = `Use the two attached images.

IMAGE 1 is a photograph of a person.
IMAGE 2 is a saree worn by a model.

Generate one photorealistic, full-length image of THE PERSON FROM IMAGE 1 wearing THE EXACT SAREE FROM IMAGE 2.

Keep from image 1: the person's face, hair, skin tone, body shape and height. It must be recognisably the same person.

Keep from image 2: the saree's exact fabric, colour and every shade in it, its border, its woven or embroidered motifs, and the way it is draped - including which shoulder the pallu falls over. Do not redesign, recolour, simplify or embellish the garment.

Framing: standing square to the camera, arms down at the sides, plain light-grey studio backdrop, soft even lighting, the whole garment in frame from head to hem. No text, no watermark.`;

let stream = null;
let capture = null;        // { dataUrl }
let chosen = null;         // the selected saree { id, name, dataUrl }
let userSarees = [];       // added through the panel, kept in this browser

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

const loadUserSarees = () => store("sarees", "readonly", (s) => s.getAll());
const saveUserSaree = (rec) => store("sarees", "readwrite", (s) => s.put(rec));
const dropUserSaree = (id) => store("sarees", "readwrite", (s) => s.delete(id));

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
  stream?.getTracks().forEach((t) => t.stop());
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
  el.retake.classList.add("hidden");
  capture = null;
  refresh();
  await listCameras();
  say("");
}

function takeStill() {
  const w = el.video.videoWidth, h = el.video.videoHeight;
  if (!w) return say("The camera has not produced a frame yet.", true);
  // Mirrored on the way out, because the preview is mirrored and the customer
  // picked their pose in a mirror. 1024 is enough for any generator.
  const side = Math.min(1024 / Math.max(w, h), 1);
  const c = document.createElement("canvas");
  c.width = Math.round(w * side);
  c.height = Math.round(h * side);
  const ctx = c.getContext("2d");
  ctx.translate(c.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(el.video, 0, 0, c.width, c.height);
  capture = { dataUrl: c.toDataURL("image/jpeg", 0.92) };
  el.still.src = capture.dataUrl;
  el.shot.classList.add("has-still");
  el.capture.classList.add("hidden");
  el.retake.classList.remove("hidden");
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

async function renderSarees() {
  const bundled = SAREES.map((s) => ({ ...s, src: chrome.runtime.getURL(s.image), bundled: true }));
  const mine = userSarees.map((s) => ({ ...s, src: s.dataUrl, bundled: false }));
  el.sarees.innerHTML = "";
  for (const s of [...bundled, ...mine]) {
    const fig = document.createElement("figure");
    fig.dataset.id = s.id;
    if (chosen?.id === s.id) fig.classList.add("on");
    fig.innerHTML = `<img src="${s.src}" alt=""><figcaption>${s.name}</figcaption>`;
    fig.addEventListener("click", async () => {
      chosen = { id: s.id, name: s.name, dataUrl: s.bundled ? await urlToDataUrl(s.src) : s.dataUrl };
      el.removesaree.classList.toggle("hidden", s.bundled);
      renderSarees();
      refresh();
    });
    el.sarees.appendChild(fig);
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
  el.capture.classList.remove("hidden");
  el.retake.classList.add("hidden");
  refresh();
});

el.addsaree.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const rec = { id: `user-${Date.now()}`, name: file.name.replace(/\.[^.]+$/, ""), dataUrl: await fileToDataUrl(file) };
  await saveUserSaree(rec);
  userSarees = await loadUserSarees();
  chosen = rec;
  el.removesaree.classList.remove("hidden");
  renderSarees();
  refresh();
  e.target.value = "";
});

el.removesaree.addEventListener("click", async () => {
  if (!chosen || chosen.id.startsWith("user-") === false) return;
  await dropUserSaree(chosen.id);
  userSarees = await loadUserSarees();
  chosen = null;
  el.removesaree.classList.add("hidden");
  renderSarees();
  refresh();
});

el.prompt.addEventListener("input", () => chrome.storage.local.set({ prompt: el.prompt.value }));
el.resetprompt.addEventListener("click", () => {
  el.prompt.value = DEFAULT_PROMPT;
  chrome.storage.local.set({ prompt: DEFAULT_PROMPT });
});
el.autosend.addEventListener("change", () => chrome.storage.local.set({ autoSend: el.autosend.checked }));
el.send.addEventListener("click", send);

chrome.tabs.onActivated.addListener(checkTab);
chrome.tabs.onUpdated.addListener((_id, info) => info.url && checkTab());

(async function boot() {
  const saved = await chrome.storage.local.get(["prompt", "autoSend"]);
  el.prompt.value = saved.prompt ?? DEFAULT_PROMPT;
  el.autosend.checked = Boolean(saved.autoSend);
  userSarees = await loadUserSarees().catch(() => []);
  await renderSarees();
  await checkTab();
})();
