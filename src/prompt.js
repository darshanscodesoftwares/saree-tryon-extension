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

const KEEP_PERSON = `Keep from image 1: the person's face, hair, skin tone, body shape and height. It must be recognisably the same person.`;

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

${KEEP_SKIN}

Keep from image 2, exactly: every garment shown and nothing added or taken away - the shirt, the trousers, and any jacket, belt or shoes that are in the picture. The shirt's colour and weave, its collar shape, its placket and buttons, its cuffs and sleeve length, and whether it is tucked in. The trousers' colour, fabric, fit and length, and how they break over the shoe. Any check, stripe or print at the same scale, running the same way.

Do not change the cut and do not change the fit. Do not smarten it up: no jacket that is not there, no tie that is not there, no different collar, no slimmer trousers.

Framing: standing square to the camera, arms relaxed at the sides, plain light-grey studio backdrop, soft even lighting, the whole outfit in frame from head to shoe. No text, no watermark.`,
  },
];

export const DEFAULT_KIND = "saree";

export const kindOf = (id) =>
  GARMENT_KINDS.find((k) => k.id === id) ?? GARMENT_KINDS[0];

export const promptFor = (id) => kindOf(id).prompt;
