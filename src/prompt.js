// The instructions, kept in one place because two front ends send them: the
// side panel, where a shopkeeper can edit one, and the kiosk, where nobody can.
//
// One per kind of garment, because the thing a generator gets wrong differs.
// A saree is six metres of cloth and the whole question is how it is DRAPED -
// which shoulder, where the pleats sit, where the border lands. Formals are
// tailored, and the question is the CUT: a collar, a placket, a hemline, a
// fit. The two paragraphs that carry each prompt are the two things the model
// will otherwise drift on, and they are not the same two.
//
// The failure they share is flattery. Left alone a generator smartens a
// garment up - a plain shirt gains a sheen, a modest neckline gets lower, a
// border grows. A customer is then shown something the shop cannot sell her,
// so every prompt here forbids it explicitly rather than hoping.

const PERSON = `Use the two attached images.

IMAGE 1 is a photograph of a person.`;

const KEEP_PERSON = `Keep from image 1: the person's face, hair, skin tone, body shape and height. It must be recognisably the same person.

The face is not to be redrawn: keep its exact structure - face shape, jawline, forehead, cheekbones, eye shape and spacing, nose, lips, ears, eyebrows, and any mole, dimple or mark. Do not slim, smooth, symmetrise, beautify or age it.`;

// The head is the other half of keeping the person, and it goes wrong in a
// specific direction: too big. A generator is trying to keep the face legible
// and recognisable, and the cheapest way to do that is to draw it larger - so
// the result is a correct face on a body it does not belong to.
//
// The worst case is the one customers actually upload: a close-up, a face with
// the hands up, no body in frame at all. The model then takes the SCALE of the
// head from that crop, where the face fills the picture, and builds a body
// around it. So the prompt does three things. It says the scale comes from the
// finished figure and not from image 1. It gives a number rather than an
// adjective - a head is about 13% of a standing figure's height, and "do not
// make it too big" is exactly what the model believes it has already done. And
// it points at image 2, a full-length model, as the thing to measure against,
// because a reference that is in the request is followed more faithfully than a
// proportion that has to be remembered.
const KEEP_PROPORTION = `Proportion: the head must belong to the body. Image 1 may be a close-up with only a face, or a face and shoulders - if so, that crop tells you who the person is, NOT how large their head is. Never take the size of the head from image 1. Build the whole standing figure first at natural adult proportions, then fit the person's face to it, shrinking the face as far as that takes.

The numbers: a standing adult is about seven and a half head-heights tall, so the head, chin to crown, is about 13% of the figure's height - in a full-length picture, roughly one head for every seven and a half of the body. The shoulders are about two head-widths across, the neck is no wider than the jaw, and the hands are about the size of the face. Use image 2 as the scale reference: the head in your picture should take up about the same fraction of the picture's height as the model's head does in image 2.

A bigger head is not a clearer likeness, it is a different person, and it is the commonest way this goes wrong. Take the build from image 1 where it is visible - their height, their shoulder width, the length of their legs against their torso. If the whole figure will not fit the frame at the right proportion, show less background rather than a smaller body.`;

// The failure this exists for: a generator keeps the face it was given and
// then renders the arms, neck and hands a shade or two lighter, so the result
// reads as a face placed on somebody else's body. It is the first thing a
// customer notices and the thing that makes a try-on unusable, and it does not
// go away unless the prompt says so outright.
const KEEP_SKIN = `Skin: the person's complexion in image 1 is their complexion everywhere. Carry the skin tone from their face onto every part of the body the garment leaves visible - neck, shoulders, arms, hands, feet, midriff - so that it reads as one person rather than a face placed on somebody else's body. No lighter shade below the jaw, no join or seam at the neck, and nothing lightened, brightened, whitened or smoothed. Keep their natural skin texture. Light and shadow may of course fall differently across the body; the skin itself does not change.`;

const FRAMING = `Framing: standing square to the camera, arms down at the sides, plain light-grey studio backdrop, soft even lighting, the whole garment in frame from head to hem. No text, no watermark.`;

export const GARMENT_KINDS = [
  {
    id: "saree",
    name: "Saree",
    prompt: `${PERSON}
IMAGE 2 is a saree worn by a model.

Generate one photorealistic, full-length image of THE PERSON FROM IMAGE 1 wearing THE EXACT SAREE FROM IMAGE 2.

${KEEP_PERSON}

${KEEP_PROPORTION}

${KEEP_SKIN}

Keep from image 2: the saree's exact fabric, colour and every shade in it, its border, its woven or embroidered motifs, and the way it is draped - including which shoulder the pallu falls over. Do not redesign, recolour, simplify or embellish the garment.

Drape it properly: pleats gathered at the front waist, the pallu over the shoulder and down the back, the border running visibly along the pallu's edge and around the hem.

${FRAMING}`,
  },
  {
    id: "formals-women",
    name: "Formals, women's",
    prompt: `${PERSON}
IMAGE 2 is a women's formal outfit worn by a model.

Generate one photorealistic, full-length image of THE PERSON FROM IMAGE 1 wearing THE EXACT OUTFIT FROM IMAGE 2.

${KEEP_PERSON}

${KEEP_PROPORTION}

${KEEP_SKIN}

Keep from image 2, exactly: every garment shown and nothing added or taken away. The colour, fabric and weave of each piece. The neckline and the collar. The closure, and its buttons. The sleeve length and shape. The fit through the shoulder and the waist. The hem of a skirt, dress or trousers, and where on the leg it falls. Any check, stripe or print at the same scale, running the same way.

Do not change the cut and do not change the fit. Do not restyle it: no jacket that is not there, no change of neckline or hemline, nothing made tighter, shorter, shinier or more decorated than it is.

${FRAMING}`,
  },
  {
    id: "formals-men",
    name: "Formals, men's",
    prompt: `${PERSON}
IMAGE 2 is a men's formal outfit worn by a model.

Generate one photorealistic, full-length image of THE PERSON FROM IMAGE 1 wearing THE EXACT OUTFIT FROM IMAGE 2.

${KEEP_PERSON}

${KEEP_PROPORTION}

${KEEP_SKIN}

Keep from image 2, exactly: every garment shown and nothing added or taken away - the shirt, the trousers, and any jacket, belt or shoes that are in the picture. The shirt's colour and weave, its collar shape, its placket and buttons, its cuffs and sleeve length, and whether it is tucked in. The trousers' colour, fabric, fit and length, and how they break over the shoe. Any check, stripe or print at the same scale, running the same way.

Do not change the cut and do not change the fit. Do not smarten it up: no jacket that is not there, no tie that is not there, no different collar, no slimmer trousers.

Framing: standing square to the camera, arms relaxed at the sides, plain light-grey studio backdrop, soft even lighting, the whole outfit in frame from head to shoe. No text, no watermark.`,
  },
];

// A photo taken on the kiosk itself - a laptop webcam, a phone held at arm's
// length - is the worst input this will ever see, and it goes wrong in one
// consistent way: the face is the sharpest, largest, best-lit thing in the
// frame, and the body is a small, soft, badly lit afterthought. The generator
// builds the figure around the face, so the face comes out too big and too
// sharp for the body, and a different age or build from it. This tells it
// what a webcam does, so it corrects for it instead of copying it.
const CASUAL_CAPTURE = `About image 1: it was taken on a webcam or a phone camera, close up and at arm's length, so expect these faults and correct for them rather than copying them. A wide lens makes the face and shoulders look larger than the body and the legs shorter; the camera is often held low or tilted, which stretches or squashes the head. The face is sharp and well lit while the body is small, soft or partly cropped. The lighting is uneven, and the colours are shifted by the room.

So: take identity from the face - and keep that face's own structure exactly as it is in image 1: the same face shape, jaw, cheekbones, eyes, nose, lips and brows, in the same relation to each other. Correct the head's SIZE by scaling the whole face down uniformly, never by reshaping it; do not slim, lengthen or soften it to undo the lens, and do not swap it for a more typical or more attractive face. Take the age, the hair and the skin tone from image 1 too. Only the body is rebuilt: take it from a natural adult of the same apparent age, build and gender, standing straight, at ordinary proportions - not from the distorted shape in image 1. Do not enlarge the head to match how large the face is in image 1, and do not copy the lens distortion, the tilt, or the shadows of that room. Match the face's sharpness, grain and lighting to the rest of the picture so the head and body look photographed together, in one light, on one day. If the body is out of frame or cropped in image 1, invent a plausible one rather than stretching what is there.`;

export const DEFAULT_KIND = "saree";

export const kindOf = (id) =>
  GARMENT_KINDS.find((k) => k.id === id) ?? GARMENT_KINDS[0];

/**
 * `casual` is true for a picture taken by the kiosk's own camera. It adds the
 * paragraph above after the kind's own prompt, so a photo uploaded from a
 * studio or a good camera is not told to distrust itself.
 */
export const promptFor = (id, { casual = false } = {}) =>
  casual ? `${kindOf(id).prompt}\n\n${CASUAL_CAPTURE}` : kindOf(id).prompt;
