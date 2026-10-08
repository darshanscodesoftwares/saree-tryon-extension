# Garment images

Photographs of each garment **being worn by a model**, front on. Sarees,
and formals for men and women - each entry in `src/library.js` says which,
and that chooses the instruction sent with it. Not cut-outs -
the generator does the fitting here, and it reads a draped garment on a body
far better than it reads a flat shape.

Around 800 px on the long side is plenty; a generator gains nothing from more
and the extension has to carry it.

To add one permanently: drop the file here and add a line to `src/library.js`,
with its `kind`.
To add one just for yourself: use the panel's **Add garment** button, which keeps
it in the browser and never touches this folder.
