// The garments the panel offers, as photographs of each one being WORN - not
// cut-outs and not folded. The generator is doing the fitting here, and it
// reads a garment on a body far better than it reads a flat shape, so these
// are the shop's own model shots at the size a generator can use.
//
// `kind` picks which instruction is sent with it (see prompt.js). A saree is
// draped and formals are tailored, and the thing a generator gets wrong is not
// the same for the two.
//
// Add one by dropping a file in sarees/ and adding a line here, or at runtime
// with the panel's "Add garment" button, which keeps it in the browser instead.
export const GARMENTS = [
  { id: "blush-pink", kind: "saree", name: "Blush pink, banarasi silk", image: "sarees/blush-pink.jpg" },
  { id: "red-bridal", kind: "saree", name: "Red, net and sequin bridal", image: "sarees/red-bridal.jpg" },
  { id: "mauve-net", kind: "saree", name: "Mauve, net with thread work", image: "sarees/mauve-net.jpg" },
  { id: "maroon-shirt-black-trousers", kind: "formals-men", name: "Maroon shirt, black trousers", image: "sarees/maroon-shirt-black-trousers.jpg" },
  { id: "black-pinstripe-jumpsuit", kind: "formals-women", name: "Black pinstripe jumpsuit", image: "sarees/black-pinstripe-jumpsuit.jpg" },
  { id: "teal-studio-silk", kind: "saree", name: "Teal, studio silk", image: "sarees/teal-studio-silk.jpg" },
      { id: "mauve-studio", kind: "saree", name: "Mauve, studio", image: "sarees/mauve-studio.jpg" },
  { id: "gold-tissue-plain", kind: "saree", name: "Gold tissue, plain", image: "sarees/gold-tissue-plain.jpg" },
  { id: "studio-bright", kind: "saree", name: "Studio, bright", image: "sarees/studio-bright.jpg" },
  { id: "beige-overcoat", kind: "formals-men", name: "Beige overcoat", image: "sarees/beige-overcoat.jpg" },
  { id: "maroon-overcoat", kind: "formals-women", name: "Maroon overcoat", image: "sarees/maroon-overcoat.jpg" },
];
