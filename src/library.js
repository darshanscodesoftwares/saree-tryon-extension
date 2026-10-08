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
];
