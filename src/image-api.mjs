// Asking a paid image API for the picture, instead of asking a browser tab.
//
// This is the other half of the switch. The extension route drives ChatGPT's
// website and reads the answer back out of the page; this one asks OpenAI
// directly and is handed the bytes. Everything either side of them - the
// kiosk, the queue, the catalogue, the progress meter - is identical, which is
// the point: a customer cannot tell which one served them.
//
// It lives here, rather than inside server.mjs, because the pricing test uses
// it too. The request shape is the one thing in this file that was written
// from documentation rather than from something that ran, so there is exactly
// one copy of it, and when it turns out to be wrong there is one place to fix.

const API = "https://api.openai.com/v1/images/edits";

// Sunburst over Flare: Flare is the faster of the two, but Sunburst is the one
// tuned for editing precision, and a drape is nothing but precision. Worth
// timing both once there is a key - a customer is standing there.
export const MODEL = process.env.IMAGE_MODEL ?? "gpt-image-2.5-sunburst";
// low until told otherwise. The balance is the only cap on this account - auto
// reload is off deliberately - and at 158 output tokens for a portrait, low
// is about a sixth of high. Enough to prove the route works and to judge
// whether the drape is right at all, which is what is being asked of it now.
// Raise it with IMAGE_QUALITY, or per call with --quality.
export const QUALITY = process.env.IMAGE_QUALITY ?? "low";
export const SIZE = process.env.IMAGE_SIZE ?? "1024x1536";   // a person is portrait
export const RUPEES = Number(process.env.INR_PER_USD ?? 96);

export const ready = () => Boolean(process.env.OPENAI_API_KEY);

// Published rates, USD per 1M tokens. The token COUNTS come from the API, so
// these are the only numbers here that can go stale.
export const RATES = {
  "gpt-image-2.5-sunburst": { imageIn: 8, textIn: 5, imageOut: 30 },
  "gpt-image-2.5-flare":    { imageIn: 8, textIn: 5, imageOut: 30 },
  "gpt-image-2":            { imageIn: 8, textIn: 5, imageOut: 30 },
  "gpt-image-1.5":          { imageIn: 8, textIn: 5, imageOut: 32 },
  "gpt-image-1-mini":       { imageIn: 2.5, textIn: 2, imageOut: 8 },
};

// A job carries its images as data URLs, because that is what travels in JSON.
// multipart wants files, so they go back the way they came.
export function fileFromDataUrl(dataUrl, name) {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma === -1) throw new Error(`${name} is not a data URL`);
  const type = dataUrl.slice(5, dataUrl.indexOf(";")) || "image/jpeg";
  return new File([Buffer.from(dataUrl.slice(comma + 1), "base64")], name, { type });
}

// What a call cost, from the token counts it reported. The split matters more
// than the total: at 2.5's output counts the two photographs we SEND are
// usually the larger half, which points the optimising somewhere unobvious -
// at the size of the uploads, not at the quality setting.
export function priceOf(usage, model = MODEL) {
  const rate = RATES[model] ?? RATES[MODEL];
  const inTok = usage?.input_tokens ?? 0;
  const outTok = usage?.output_tokens ?? 0;
  const d = usage?.input_tokens_details ?? {};
  const imageIn = d.image_tokens ?? null;
  const textIn = d.text_tokens ?? null;
  // When the split is not broken out, charge it all at the image rate: it is
  // the dearer of the two, so this never flatters the number.
  const inUsd = imageIn !== null && textIn !== null
    ? (imageIn * rate.imageIn + textIn * rate.textIn) / 1e6
    : (inTok * rate.imageIn) / 1e6;
  const outUsd = (outTok * rate.imageOut) / 1e6;
  return { inTok, outTok, imageIn, textIn, inUsd, outUsd, usd: inUsd + outUsd };
}

/**
 * One try-on.
 *
 * @param {{person: string, saree: string, prompt: string}} job - data URLs and wording
 * @param {{model?: string, quality?: string, size?: string, signal?: AbortSignal}} [opts]
 * @returns {Promise<{image: string, notes: string[], usage: object, price: object}>}
 *          image is a data URL, so it reaches the kiosk exactly as the
 *          extension's answers do.
 */
export async function generate(job, opts = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("no OPENAI_API_KEY - this server cannot use the API route");

  const model = opts.model ?? MODEL;
  const quality = opts.quality ?? QUALITY;
  const size = opts.size ?? SIZE;

  const body = new FormData();
  body.append("model", model);
  body.append("prompt", job.prompt);
  body.append("size", size);
  body.append("quality", quality);
  // Order matters to the wording: the prompt speaks about the person first.
  body.append("image[]", fileFromDataUrl(job.person, "person.jpg"));
  body.append("image[]", fileFromDataUrl(job.saree, "garment.jpg"));

  const began = Date.now();
  const res = await fetch(API, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body,
    signal: opts.signal,
  });
  const took = (Date.now() - began) / 1000;

  if (!res.ok) {
    const text = (await res.text()).slice(0, 400);
    // The two that catch people out, named where they will be read.
    const hint =
      res.status === 429 ? " (a 429 here is usually the free tier, which does not support image models at any balance - add credit, then check Usage > Limits)"
      : res.status === 400 && /quality/i.test(text) ? " (xhigh and max are 2.5 only)"
      : "";
    throw new Error(`${model} refused with ${res.status}${hint}: ${text}`);
  }

  const out = await res.json();
  const b64 = out.data?.[0]?.b64_json;
  // This family never returns a URL, only base64 - so an empty body here is a
  // shape problem, not a slow CDN, and saying so saves someone a search.
  if (!b64) throw new Error(`${model} returned no image (this family answers in base64, never a URL)`);

  const price = priceOf(out.usage, model);
  const notes = [
    `asked ${model} for a ${size} ${quality} picture`,
    `it answered in ${took.toFixed(1)}s`,
    `${price.inTok} tokens in` +
      (price.imageIn !== null ? ` (${price.imageIn} image, ${price.textIn} text)` : "") +
      `, ${price.outTok} out`,
    `this picture cost $${price.usd.toFixed(4)} (₹${(price.usd * RUPEES).toFixed(2)})`,
  ];

  return { image: `data:image/png;base64,${b64}`, notes, usage: out.usage, price };
}
