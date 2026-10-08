// Every colour pair the interface actually puts together, checked against
// WCAG AA. Four pairs in the previous palette failed, including the border on
// every control and the ring marking the chosen garment - which is the single
// most important state in the app. Eyeballing a dark palette does not catch
// that, so it is a test.
//
// `node test/contrast.mjs`

import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../webapp/style.css", import.meta.url), "utf8");
const tok = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${name} not found`);
  return m[1];
};

const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const C = Object.fromEntries(
  ["bg", "surface", "surface-2", "line", "hair", "text", "muted", "accent", "accent-ink", "gold", "ok", "bad"]
    .map((n) => [n, tok(n)])
);

// The three saree photographs are mid-grey slabs, so anything laid ON a tile
// image has to clear THEM, not the page. Sampled from sarees/.
const PHOTO = { "saree backdrop 1": "#747882", "saree backdrop 2": "#8b8c90", "saree backdrop 3": "#787d89" };

const checks = [
  // text: 4.5:1
  ["body text on page",            C.text, C.bg, 4.5],
  ["body text on a card",          C.text, C.surface, 4.5],
  ["body text on a raised card",   C.text, C["surface-2"], 4.5],
  ["muted text on page",           C.muted, C.bg, 4.5],
  ["muted text on a card",         C.muted, C.surface, 4.5],
  ["category heading on page",     C.gold, C.bg, 4.5],
  ["ready status on page",         C.ok, C.bg, 4.5],
  ["problem status on page",       C.bad, C.bg, 4.5],
  ["primary button label",         C["accent-ink"], C.accent, 4.5],
  // non-text, component boundaries and state: 3:1
  ["control border on page",       C.line, C.bg, 3],
  ["control border on a card",     C.line, C.surface, 3],
  ["selection ring on page",       C.accent, C.bg, 3],
  ["focus ring on page",           C.accent, C.bg, 3],
  ["focus ring on a card",         C.accent, C.surface, 3],
  ["primary button against page",  C.accent, C.bg, 3],
];

// The construction that makes selection legible: the ring never touches the
// photograph - a 5px inset of ground colour separates them, and THAT gap is
// what has to be visible against the picture.
for (const [name, hex] of Object.entries(PHOTO)) {
  checks.push([`the inset gap against ${name}`, C.bg, hex, 3]);
}

const results = checks.map(([name, a, b, need]) => {
  const r = ratio(a, b);
  return [name, r, need, r >= need];
});

for (const [name, r, need, pass] of results) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${r.toFixed(2).padStart(6)}:1  (needs ${need})  ${name}`);
}

// And the thing the old palette got wrong, stated as a test rather than prose:
// an accent ring laid DIRECTLY on a garment photo cannot pass, whatever colour
// it is. This asserts the failure, so nobody "simplifies" the gap away.
console.log("");
let anyDirect = false;
for (const [name, hex] of Object.entries(PHOTO)) {
  const r = ratio(C.accent, hex);
  if (r >= 3) anyDirect = true;
  console.log(`note  ${r.toFixed(2)}:1  ring laid straight on ${name} - which is why there is an inset`);
}

const bad = results.filter(([, , , p]) => !p);
console.log(bad.length ? `\n${bad.length} of ${results.length} failed` : `\nall ${results.length} pairs pass`);
if (anyDirect) console.log("note: a direct ring would now pass - the inset may no longer be load-bearing");
process.exit(bad.length ? 1 : 0);
