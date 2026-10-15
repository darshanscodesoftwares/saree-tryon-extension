// What does ONE try-on actually cost?
//
// Every figure quoted so far has been arithmetic. The per-image prices OpenAI
// publishes cover the OUTPUT only - their own calculator says so in the small
// print - and at GPT Image 2.5's token counts the two reference photographs we
// send cost MORE than the picture that comes back. That input number is the one
// thing nobody can look up, because it depends on our photographs and our
// wording.
//
// So stop estimating and buy one. This makes a single real call through the
// SAME module the server uses in api mode, so what it proves about the request
// is true of the live route as well - and when the shape turns out to be wrong
// there is one place to fix, not two.
//
//   export OPENAI_API_KEY=sk-...
//   node test/price-a-real-call.mjs person.jpg sarees/red-bridal.jpg
//
// Options:
//   --quality low|medium|high|xhigh|max   (default high)
//   --model   gpt-image-2.5-sunburst | gpt-image-2.5-flare | gpt-image-2 | ...
//   --kind    saree | formals-women | formals-men
//   --size    1024x1536

import { readFile, writeFile } from "node:fs/promises";
import { promptFor, DEFAULT_KIND } from "../src/prompt.js";
import { generate, MODEL, QUALITY, SIZE, RUPEES } from "../src/image-api.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const files = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));

const [person, garment] = files;
if (!person || !garment) {
  console.error("usage: node test/price-a-real-call.mjs <person.jpg> <garment.jpg> [--quality high]");
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("Set OPENAI_API_KEY first. This call costs real money - a few rupees.");
  process.exit(1);
}

const model = flag("model", MODEL);
const quality = flag("quality", QUALITY);
const size = flag("size", SIZE);
const kind = flag("kind", DEFAULT_KIND);

const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const asDataUrl = async (path) => {
  const ext = path.split(".").pop().toLowerCase();
  return `data:${TYPES[ext] ?? "image/jpeg"};base64,${(await readFile(path)).toString("base64")}`;
};

console.log(`asking ${model} for a ${size} ${quality} picture (${kind})...`);

let out;
try {
  out = await generate(
    { person: await asDataUrl(person), saree: await asDataUrl(garment), prompt: promptFor(kind) },
    { model, quality, size }
  );
} catch (e) {
  console.error(`\n${e.message}`);
  process.exit(1);
}

const name = `tryon-${model}-${quality}.png`;
await writeFile(name, Buffer.from(out.image.split(",")[1], "base64"));
console.log(`\nsaved ${name} - look at the drape, not just the price`);

const p = out.price;
const money = (d) => `$${d.toFixed(5)}  (₹${(d * RUPEES).toFixed(2)})`;
const share = (d) => `${((d / p.usd) * 100).toFixed(0)}%`;

console.log(`
  INPUT   ${String(p.inTok).padStart(6)} tokens` +
  (p.imageIn !== null ? `  (${p.imageIn} image, ${p.textIn} text)` : "  (not broken out)") + `
          ${money(p.inUsd)}   ${share(p.inUsd)} of the bill
  OUTPUT  ${String(p.outTok).padStart(6)} tokens
          ${money(p.outUsd)}   ${share(p.outUsd)} of the bill

  ONE TRY-ON   ${money(p.usd)}

  10 images (one client)   ${money(p.usd * 10)}
  150 images (the demo)    ${money(p.usd * 150)}
  2,250 a month (30/day)   ${money(p.usd * 2250)}
`);

if (p.inUsd > p.outUsd) {
  console.log(`  The photographs we SEND cost more than the picture we get back.
  Two things follow, in this order:
    - send smaller reference images (src/panel.js resizes garments to 1536px)
    - cache the garment, which is identical for every customer trying it on -
      cached image input is $2/1M against $8/1M, and only the Responses API
      can do it, which is a decision worth making before the code is written
`);
}
