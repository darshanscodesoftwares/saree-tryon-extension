// What does ONE try-on actually cost?
//
// Every figure quoted so far has been arithmetic. The per-image prices OpenAI
// publishes cover the OUTPUT only - their own calculator says so in the small
// print - and at GPT Image 2.5's low token counts the two reference photographs
// we send cost MORE than the picture that comes back. That input number is the
// one thing nobody can look up, because it depends on our photographs and our
// prompt.
//
// So stop estimating and buy one. This makes a single real call with a real
// garment, a real photograph and the real wording from src/prompt.js, then
// prints the exact token split and what it came to. It costs about six rupees
// and it settles the last unknown.
//
//   export OPENAI_API_KEY=sk-...
//   node test/price-a-real-call.mjs person.jpg sarees/red-bridal.jpg
//
// Options:
//   --quality low|medium|high|xhigh|max   (default high)
//   --model   gpt-image-2.5-sunburst | gpt-image-2.5-flare | gpt-image-2 | ...
//   --kind    saree | formals-women | formals-men
//
// Sunburst is the default because it is the variant tuned for editing
// precision, and a drape is nothing but precision. Flare is the faster one -
// worth timing too, since a customer is standing there.

import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { promptFor, DEFAULT_KIND } from "../src/prompt.js";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const files = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));

const [person, garment] = files;
const QUALITY = flag("quality", "high");
const MODEL = flag("model", "gpt-image-2.5-sunburst");
const KIND = flag("kind", DEFAULT_KIND);
const SIZE = flag("size", "1024x1536");   // portrait, the shape a person is

if (!person || !garment) {
  console.error("usage: node test/price-a-real-call.mjs <person.jpg> <garment.jpg> [--quality high]");
  process.exit(1);
}
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
  console.error("Set OPENAI_API_KEY first. This call costs real money - a few rupees.");
  process.exit(1);
}

// Published rates, USD per 1M tokens. If these move, the arithmetic below is
// the only thing that needs correcting - the token counts come from the API.
const RATES = {
  "gpt-image-2.5-sunburst": { imageIn: 8, textIn: 5, imageOut: 30 },
  "gpt-image-2.5-flare":    { imageIn: 8, textIn: 5, imageOut: 30 },
  "gpt-image-2":            { imageIn: 8, textIn: 5, imageOut: 30 },
  "gpt-image-1.5":          { imageIn: 8, textIn: 5, imageOut: 32 },
  "gpt-image-1-mini":       { imageIn: 2.5, textIn: 2, imageOut: 8 },
};
const RUPEES = Number(flag("inr", 96));

const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const asFile = async (path) => {
  const ext = path.split(".").pop().toLowerCase();
  return new File([await readFile(path)], basename(path), {
    type: TYPES[ext] ?? "application/octet-stream",
  });
};

const body = new FormData();
body.append("model", MODEL);
body.append("prompt", promptFor(KIND));
body.append("size", SIZE);
body.append("quality", QUALITY);
// The order matters to the wording: the prompt talks about the person first.
body.append("image[]", await asFile(person));
body.append("image[]", await asFile(garment));

console.log(`asking ${MODEL} for a ${SIZE} ${QUALITY} picture (${KIND})...`);
const began = Date.now();

const res = await fetch("https://api.openai.com/v1/images/edits", {
  method: "POST",
  headers: { authorization: `Bearer ${KEY}` },
  body,
});
const took = ((Date.now() - began) / 1000).toFixed(1);

if (!res.ok) {
  console.error(`\nit refused (${res.status}):\n${await res.text()}`);
  // The two that catch people out, both of which cost nothing to fix.
  if (res.status === 429) console.error("\n429 usually means the account is still on the Free tier, which does not support image models at all. Add credit, then check Usage -> Limits.");
  if (res.status === 400) console.error("\n400 on `quality` usually means this model does not take that tier - xhigh and max are 2.5 only.");
  process.exit(1);
}

const out = await res.json();
const b64 = out.data?.[0]?.b64_json;
if (b64) {
  const name = `tryon-${MODEL}-${QUALITY}.png`;
  await writeFile(name, Buffer.from(b64, "base64"));
  console.log(`\nsaved ${name} - look at the drape, not just the price`);
}

// ---- what it actually cost -------------------------------------------------

const u = out.usage ?? {};
const inTok = u.input_tokens ?? 0;
const outTok = u.output_tokens ?? 0;
const detail = u.input_tokens_details ?? {};
const imgIn = detail.image_tokens ?? null;
const txtIn = detail.text_tokens ?? null;

const rate = RATES[MODEL] ?? RATES["gpt-image-2.5-sunburst"];
// Fall back to charging all input at the image rate when the split is not
// broken out: it is the dearer of the two, so the estimate never flatters.
const inUsd = imgIn !== null && txtIn !== null
  ? (imgIn * rate.imageIn + txtIn * rate.textIn) / 1e6
  : (inTok * rate.imageIn) / 1e6;
const outUsd = (outTok * rate.imageOut) / 1e6;
const usd = inUsd + outUsd;

const money = (d) => `$${d.toFixed(5)}  (₹${(d * RUPEES).toFixed(2)})`;
const share = (d) => `${((d / usd) * 100).toFixed(0)}%`;

console.log(`
  took ${took}s

  INPUT   ${String(inTok).padStart(6)} tokens` +
  (imgIn !== null ? `  (${imgIn} image, ${txtIn} text)` : "  (not broken out)") + `
          ${money(inUsd)}   ${share(inUsd)} of the bill
  OUTPUT  ${String(outTok).padStart(6)} tokens
          ${money(outUsd)}   ${share(outUsd)} of the bill

  ONE TRY-ON   ${money(usd)}

  10 images (one client)   ${money(usd * 10)}
  150 images (the demo)    ${money(usd * 150)}
  2,250 a month (30/day)   ${money(usd * 2250)}
`);

if (inUsd > outUsd) {
  console.log(`  The photographs we SEND cost more than the picture we get back.
  Two things follow, in this order:
    - send smaller reference images (src/panel.js resizes garments to 1536px)
    - cache the garment, which is identical for every customer trying it on -
      cached image input is $2/1M against $8/1M, and only the Responses API
      can do it, which is a decision worth making before the code is written
`);
}
