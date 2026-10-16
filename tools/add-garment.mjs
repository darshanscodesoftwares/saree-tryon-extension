// Put a garment on the shelf PERMANENTLY.
//
// There are two shelves and only one of them survives anything. A garment
// added through the side panel lives in that browser's IndexedDB, is pushed to
// the server by the extension, and is held there in a plain variable - so it
// is gone the moment the server restarts, which on Render's free plan is every
// time the service sleeps for fifteen minutes. The shopkeeper adds a saree,
// sees it on every screen, and finds three sarees again the next morning.
//
// The other shelf is src/library.js, which is in the repository. It survives
// restarts, redeploys and sleeping, needs no extension running, and is the
// only one that can be trusted for a demo. This moves a garment onto it.
//
//   node tools/add-garment.mjs --kind formals-men ~/Downloads/snitch-formals.jpg
//   node tools/add-garment.mjs --kind saree --name "Teal, silk" ~/Downloads/teal.png
//   node tools/add-garment.mjs --kind saree ~/Downloads/*.png        (names from filenames)
//
// Pictures are converted to jpeg and capped at 1200px on the long side, which
// is what the three bundled ones are. That is not only for the repository's
// sake: the reference photographs we send cost about three times what a `low`
// picture costs to generate, so the size of this file is the larger half of
// every try-on's bill.

import { copyFile, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { basename, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { GARMENT_KINDS, kindOf } from "../src/prompt.js";

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "..");
const SHELF = join(ROOT, "sarees");
const LIBRARY = join(ROOT, "src", "library.js");
const LONG_SIDE = 1200;

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};
const files = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));

const kind = flag("kind") ?? "saree";
const givenName = flag("name");

if (!files.length) {
  console.error(`usage: node tools/add-garment.mjs [--kind <kind>] [--name "Pretty name"] <image>...

  kinds: ${GARMENT_KINDS.map((k) => k.id).join(", ")}`);
  process.exit(1);
}
if (!GARMENT_KINDS.some((k) => k.id === kind)) {
  console.error(`"${kind}" is not a kind. One of: ${GARMENT_KINDS.map((k) => k.id).join(", ")}`);
  process.exit(1);
}
if (givenName && files.length > 1) {
  console.error("--name names one garment; with several, the names come from the filenames.");
  process.exit(1);
}

// "Elegant Mauve Saree Portrait.png" -> "elegant-mauve-saree-portrait"
const slug = (s) =>
  s.replace(/\.[^.]+$/, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

// "elegant-mauve-saree" -> "Elegant mauve saree"
const pretty = (id) => id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

let library = await readFile(LIBRARY, "utf8");
const taken = new Set([...library.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]));
await mkdir(SHELF, { recursive: true });

// sips ships with macOS, so this needs nothing installed. Anywhere else the
// file is copied as it is and the size is reported rather than fixed - a
// warning beats refusing to work on a machine that is otherwise fine.
let canResize = true;
try { await run("sips", ["--version"]); } catch { canResize = false; }

const added = [];
for (const path of files) {
  const from = resolve(path.replace(/^~/, process.env.HOME ?? "~"));
  if (!existsSync(from)) { console.error(`skipped, not found: ${path}`); continue; }

  let id = slug(givenName ?? basename(from));
  if (!id) { console.error(`skipped, cannot make a name from: ${path}`); continue; }
  if (taken.has(id)) {
    let n = 2;
    while (taken.has(`${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }
  taken.add(id);

  const to = join(SHELF, `${id}.jpg`);
  if (canResize) {
    await run("sips", ["-s", "format", "jpeg", "-Z", String(LONG_SIDE), from, "--out", to]);
  } else {
    await copyFile(from, to);
    console.warn(`  ! copied as-is (${extname(from) || "no extension"}); no sips to convert or shrink it`);
  }

  const size = (await readFile(to)).length;
  const name = givenName ?? pretty(slug(basename(from)));
  added.push({ id, kind, name, image: `sarees/${id}.jpg`, size });
}

if (!added.length) { console.error("nothing added"); process.exit(1); }

// Written in before the closing bracket, in the same shape as the lines that
// are already there - this file is read by people far more often than by code.
const lines = added
  .map((g) => `  { id: "${g.id}", kind: "${g.kind}", name: "${g.name.replace(/"/g, "'")}", image: "${g.image}" },`)
  .join("\n");
const close = library.lastIndexOf("];");
if (close === -1) { console.error(`cannot find the end of the list in ${LIBRARY}`); process.exit(1); }
library = library.slice(0, close) + lines + "\n" + library.slice(close);
await writeFile(LIBRARY, library);

console.log(`added ${added.length} to the permanent shelf as ${kindOf(kind).name.toLowerCase()}:\n`);
for (const g of added) {
  console.log(`  ${g.name}\n    ${g.image}  (${Math.round(g.size / 1024)} KB)`);
}
console.log(`
These are in the repository now, so they survive a restart, a redeploy and a
sleeping free instance, and they need no extension running to appear.

  npm test && git add -A && git commit
  git push        <- Render redeploys and every screen has them
`);
