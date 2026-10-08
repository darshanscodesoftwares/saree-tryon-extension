// The side panel: what is on the shelf, and the wording each kind of garment
// is sent with. That is all it does.
//
// It used to take a photograph and send it too. Both moved - customers are
// photographed at the kiosk, and the extension's own worker does the sending -
// so a second way to do either sat at the top of this panel unused, pushing the
// shelf, which only this panel can edit, below the fold.
//
// Nothing here reaches a generator directly. A garment added here is written to
// the extension's own storage; the worker reads it and publishes it, and that
// is how it arrives on a screen which cannot read extension storage at all.

import { GARMENTS } from "./library.js";
import { GARMENT_KINDS, DEFAULT_KIND, kindOf, promptFor } from "./prompt.js";

const $ = (id) => document.getElementById(id);
const el = {
  status: $("status"),
  garments: $("garments"), addgarment: $("addgarment"), addkind: $("addkind"),
  garmentkind: $("garmentkind"), selectedrow: $("selectedrow"),
  removegarment: $("removegarment"), promptkind: $("promptkind"),
  prompt: $("prompt"), resetprompt: $("resetprompt"),
};

let chosen = null;         // the selected garment { id, kind, name }
let userGarments = [];     // added here, kept in this browser
let currentKind = DEFAULT_KIND;  // which instruction the box is showing

const NOT_AN_IMAGE =
  "That file could not be read as an image. A photograph straight off an " +
  "iPhone is often HEIC, which Chrome cannot decode - export it as JPEG first.";

const RESTING = "Anything added here appears on every screen.";

const say = (text, bad = false) => {
  el.status.textContent = text || RESTING;
  el.status.classList.toggle("bad", Boolean(text) && bad);
};

// ---------------------------------------------------------------- storage

// Garments are blobs and there can be a shelf of them, so they go in IndexedDB
// rather than chrome.storage, which is measured in megabytes.
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

// Tell the worker, so it republishes and the garment reaches the screens while
// the shopkeeper is still looking at it.
const announce = () =>
  chrome.runtime.sendMessage({ type: "garments:changed" }).catch(() => {});

// ----------------------------------------------------------------- shelf

// A garment arrives as whatever a shop's phone produced: HEIC, a 4000px JPEG,
// a generated PNG. All of them have to reach a generator as the same kind of
// file, or comparing two garments is partly comparing two cameras.
//
// Decoding here also catches HEIC at the point the file is chosen. Left raw it
// would travel all the way to the page labelled saree.jpg while still carrying
// image/heic, and be refused there with nothing to explain why.
const GARMENT_MAX = 1536;  // more than a face would get: the weave is the point

async function normalise(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const side = Math.min(GARMENT_MAX / Math.max(bmp.width, bmp.height), 1);
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * side);
  c.height = Math.round(bmp.height * side);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const url = c.toDataURL("image/jpeg", 0.92);
  c.width = c.height = 0;
  return url;
}

function renderGarments() {
  const bundled = GARMENTS.map((g) => ({ ...g, src: chrome.runtime.getURL(g.image), bundled: true }));
  // Anything saved before garments had kinds is a saree, because that is all
  // this panel could offer at the time.
  const mine = userGarments.map((g) => ({ kind: DEFAULT_KIND, ...g, src: g.dataUrl, bundled: false }));
  el.garments.replaceChildren();
  for (const g of [...bundled, ...mine]) {
    const fig = document.createElement("figure");
    fig.dataset.id = g.id;
    if (chosen?.id === g.id) fig.classList.add("on");
    // Built rather than interpolated: a garment's name is its filename, and a
    // filename is not markup.
    const img = document.createElement("img");
    img.src = g.src;
    img.alt = "";
    const cap = document.createElement("figcaption");
    cap.textContent = g.name;
    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = kindOf(g.kind).name;
    cap.appendChild(kind);
    fig.append(img, cap);
    fig.addEventListener("click", () => select(g));
    el.garments.appendChild(fig);
  }
}

async function select(g) {
  chosen = { id: g.id, kind: g.kind ?? DEFAULT_KIND, name: g.name };
  // Only one added here can be changed; a bundled one is a line in library.js
  // and belongs to the repository, not to this browser.
  el.selectedrow.classList.toggle("hidden", g.bundled);
  el.garmentkind.value = chosen.kind;
  // Choosing a garment shows its instruction. A saree prompt sent with a shirt
  // asks the model to drape a pallu that is not there.
  await showPromptFor(chosen.kind);
  renderGarments();
}

// --------------------------------------------------------------- prompts

// One prompt per kind, each separately editable and separately remembered, so
// rewriting the saree instruction does not quietly rewrite the one sent with a
// suit.
async function showPromptFor(kind) {
  currentKind = kind;
  const { prompts } = await chrome.storage.local.get("prompts");
  el.prompt.value = prompts?.[kind] ?? promptFor(kind);
  el.promptkind.textContent = `· ${kindOf(kind).name.toLowerCase()}`;
}

async function rememberPrompt(text) {
  const { prompts } = await chrome.storage.local.get("prompts");
  await chrome.storage.local.set({ prompts: { ...(prompts ?? {}), [currentKind]: text } });
}

// ---------------------------------------------------------------- wiring

el.addgarment.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  let dataUrl;
  try {
    dataUrl = await normalise(file);
  } catch {
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
  announce();
  await select({ ...rec, bundled: false });
  say(`Added ${rec.name}.`);
});

el.removegarment.addEventListener("click", async () => {
  if (!chosen || !chosen.id.startsWith("user-")) return;
  const gone = chosen.name;
  await dropUserGarment(chosen.id);
  userGarments = await loadUserGarments();
  announce();
  chosen = null;
  el.selectedrow.classList.add("hidden");
  renderGarments();
  say(`Removed ${gone}.`);
});

// Changing what a garment IS, after the fact. Without this, anything added
// before kinds existed is stuck being a saree and the only correction is to
// delete it and upload the file again.
el.garmentkind.addEventListener("change", async () => {
  if (!chosen || !chosen.id.startsWith("user-")) return;
  const rec = (await loadUserGarments()).find((g) => g.id === chosen.id);
  if (!rec) return;
  rec.kind = el.garmentkind.value;
  await saveUserGarment(rec);
  userGarments = await loadUserGarments();
  chosen.kind = rec.kind;
  announce();
  await showPromptFor(rec.kind);
  renderGarments();
  say(`${rec.name} is ${kindOf(rec.kind).name.toLowerCase()} now.`);
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
  say("Back to the wording this ships with.");
});

// ------------------------------------------------------------------ boot

(async function boot() {
  for (const select of [el.addkind, el.garmentkind]) {
    for (const k of GARMENT_KINDS) {
      const o = document.createElement("option");
      o.value = k.id;
      o.textContent = k.name;
      select.appendChild(o);
    }
  }
  const saved = await chrome.storage.local.get(["prompt", "prompts"]);
  // There used to be one prompt for everything. Carry it across as the saree's
  // override rather than throwing away someone's rewrite.
  if (saved.prompt && !saved.prompts) {
    await chrome.storage.local.set({ prompts: { [DEFAULT_KIND]: saved.prompt } });
    await chrome.storage.local.remove("prompt");
  }
  await showPromptFor(DEFAULT_KIND);
  userGarments = await loadUserGarments().catch(() => []);
  renderGarments();
})();
