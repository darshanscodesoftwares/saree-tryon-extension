// Take a garment off the permanent shelf.
//
// The cross on the screen only appears on garments a screen ADDED, and that is
// not a half-finished feature - it is the truth. Everything else on the shelf
// is a line in src/library.js and a file in sarees/, both in the repository.
// A server cannot delete those: it would have to edit the repository and
// redeploy itself. A cross on them would be a button that lies.
//
// So removing one permanently is this, and then a commit.
//
//   node tools/remove-garment.mjs pink              <- anything matching "pink"
//   node tools/remove-garment.mjs blush-pink-bridal <- one, by id
//   node tools/remove-garment.mjs --list            <- what is on the shelf
//
// It shows what it is about to do and asks, because a garment removed by a
// typo is a file to fish back out of git.

import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const LIBRARY = join(ROOT, "src", "library.js");

const argv = process.argv.slice(2);
const yes = argv.includes("--yes");
const terms = argv.filter((a) => !a.startsWith("--"));

const library = await readFile(LIBRARY, "utf8");
const ROW = /\{ id: "([^"]+)", kind: "([^"]+)", name: "([^"]+)", image: "([^"]+)" \},?/g;
const rows = [...library.matchAll(ROW)].map((m) => ({
  line: m[0], id: m[1], kind: m[2], name: m[3], image: m[4],
}));

if (argv.includes("--list") || !terms.length) {
  console.log(`${rows.length} on the permanent shelf:\n`);
  for (const r of rows) console.log(`  ${r.id.padEnd(30)} ${r.kind.padEnd(15)} ${r.name}`);
  if (!terms.length && !argv.includes("--list")) {
    console.log(`\nusage: node tools/remove-garment.mjs <id or words to match>...`);
  }
  process.exit(0);
}

// Match on id or name, so "pink" finds what a person means by pink.
const hit = (r, t) =>
  r.id.toLowerCase().includes(t.toLowerCase()) || r.name.toLowerCase().includes(t.toLowerCase());
const doomed = rows.filter((r) => terms.some((t) => hit(r, t)));

if (!doomed.length) {
  console.error(`Nothing matches ${terms.map((t) => `"${t}"`).join(" or ")}. --list shows what is there.`);
  process.exit(1);
}
if (doomed.length === rows.length) {
  console.error("That matches every garment on the shelf. Narrow it, or empty library.js by hand if you mean it.");
  process.exit(1);
}

console.log(`About to remove ${doomed.length} of ${rows.length}:\n`);
for (const r of doomed) console.log(`  ${r.name}  (${r.kind})\n    ${r.image}`);

if (!yes) {
  const ask = createInterface({ input: process.stdin, output: process.stdout });
  const said = (await ask.question(`\nRemove ${doomed.length}? [y/N] `)).trim().toLowerCase();
  ask.close();
  if (said !== "y" && said !== "yes") {
    console.log("Left alone.");
    process.exit(0);
  }
}

let next = library;
for (const r of doomed) next = next.replace(r.line + "\n", "").replace(r.line, "");
await writeFile(LIBRARY, next);

for (const r of doomed) {
  const f = join(ROOT, r.image);
  // Only if nothing else still points at it - two lines can name one file.
  const stillUsed = rows.some((o) => o.image === r.image && !doomed.includes(o));
  if (!stillUsed && existsSync(f)) await unlink(f);
}

const left = [...(await readFile(LIBRARY, "utf8")).matchAll(ROW)].length;
console.log(`
Removed ${doomed.length}. ${left} left on the permanent shelf.

  npm test && git add -A && git commit
  git push        <- Render redeploys and every screen loses them

They are still in this repository's history, so putting one back is a checkout
away.
`);
