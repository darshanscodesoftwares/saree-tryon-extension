// The prompts are the product. A generator does what they say, so a wrong word
// in one is a customer shown a garment the shop cannot sell.
//
// Plain node, no browser: `node test/prompts.mjs`.

import { GARMENT_KINDS, DEFAULT_KIND, kindOf, promptFor } from "../src/prompt.js";

const checks = [];
const ok = (name, pass) => checks.push([name, pass]);
const saree = promptFor("saree");
const men = promptFor("formals-men");
const women = promptFor("formals-women");

ok("there are three kinds", GARMENT_KINDS.length === 3);
ok("every kind has an id, a name and a prompt",
   GARMENT_KINDS.every((k) => k.id && k.name && k.prompt?.length > 200));
ok("their ids are distinct", new Set(GARMENT_KINDS.map((k) => k.id)).size === 3);
ok("their prompts are distinct", new Set(GARMENT_KINDS.map((k) => k.prompt)).size === 3);
ok("an unknown kind falls back rather than throwing", kindOf("nonsense").id === DEFAULT_KIND);

// Each prompt must carry the two things its own garment drifts on.
ok("the saree prompt is about the drape",
   /pallu/i.test(saree) && /drape/i.test(saree) && /border/i.test(saree));
ok("the men's prompt is about the cut",
   /collar/i.test(men) && /trousers/i.test(men) && /cuff/i.test(men));
ok("the women's prompt is about the cut",
   /neckline/i.test(women) && /hem/i.test(women) && /sleeve/i.test(women));

// The one that would be hardest to notice: a saree word left in a formals
// prompt makes the model drape cloth that is not there.
ok("no pallu in the men's prompt",   !/pallu|saree|drape/i.test(men));
ok("no pallu in the women's prompt", !/pallu|saree|drape/i.test(women));

// All three must refuse flattery, which is the failure they share.
for (const k of GARMENT_KINDS) {
  ok(`${k.id} forbids embellishing`,
     /do not (redesign|change the cut|restyle|smarten)/i.test(k.prompt));
  ok(`${k.id} keeps the person`,
     /recognisably the same person/i.test(k.prompt));
  ok(`${k.id} asks for the whole garment in frame`,
     /head to (hem|shoe)/i.test(k.prompt));
  ok(`${k.id} names both images`,
     /IMAGE 1/.test(k.prompt) && /IMAGE 2/.test(k.prompt));
}

// The skin instruction, in all three. A generator that keeps the face and
// lightens the arms produces a face on somebody else's body, which is the
// first thing a customer notices and the hardest thing to argue is a feature.
for (const k of GARMENT_KINDS) {
  ok(`${k.id} carries the skin tone to the whole body`,
     /complexion/i.test(k.prompt) &&
     /neck/i.test(k.prompt) && /arms/i.test(k.prompt) && /hands/i.test(k.prompt));
  ok(`${k.id} forbids lightening the skin`,
     /lightened|whitened/i.test(k.prompt) && /no lighter shade/i.test(k.prompt));
  ok(`${k.id} still allows normal lighting`,
     /light and shadow may/i.test(k.prompt));
}

const bad = checks.filter(([, p]) => !p);
for (const [n, p] of checks) console.log(`${p ? "PASS" : "FAIL"}  ${n}`);
console.log(bad.length ? `\n${bad.length} failed` : `\nall ${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
