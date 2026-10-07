# Saree Try-On Bridge

A Chrome side panel that photographs a customer, lets you pick a saree, and
hands both to whatever AI image generator is open in the tab beside it, with
the prompt already written.

It is a bridge, not a generator. The hard part - putting the cloth on the
person - is done by the model you are already paying for. This exists so that
the ten clicks it takes to do that by hand become one.

Separate from the `saree_tryon` viewer next door, and sharing no code with it,
because it answers the opposite question. That one warps a photograph of a
garment onto a live camera frame, on-device, in real time, and never sends a
pixel anywhere. This one sends a still to somebody else's model and waits.
Live and private, or still and photoreal - you cannot have both yet.

## Install

```
chrome://extensions  ->  Developer mode  ->  Load unpacked  ->  pick this folder
```

Chrome, Edge or Brave. Firefox has no `sidePanel` API, so it would need a
different shell.

## Use

1. Open the generator you want in a tab - Gemini, ChatGPT, or anything else.
2. Click the extension's toolbar button. The panel opens beside it.
3. **Turn camera on**, stand the customer in frame, **Capture**.
4. Pick a saree.
5. **Send to the page.**

The first send to a new site asks for permission for that site. Nothing is
granted up front beyond Gemini and ChatGPT.

## Two things to know before you use it on a customer

**Their photograph leaves the machine.** The panel itself sends nothing
anywhere, but it puts the capture into a page belonging to a third party, and
that page uploads it. The viewer next door is built on the opposite promise. If
you show this to customers, that is a consent question, not a technical one.

**It drives somebody else's interface.** Finding the prompt box and the
attach button on a page you do not own is guesswork that breaks whenever that
page is reshipped, and some providers' terms discourage automating their web
interface at all. Nothing here evades anything - it types what you would have
typed - but it is not a supported integration and never will be.

## What it is allowed to do

`sidePanel`, `storage`, `scripting`, `tabs`, and host access to Gemini and
ChatGPT. `tabs` is the broad one: it lets the panel read the address of the tab
in front so it can tell you where Send would go. Every other site is in
`optional_host_permissions` and is asked for one at a time, the first time you
send to it.

## When a site stops working

Every site-specific guess is in one table at the top of `src/inject.js`:

```js
{
  id: "gemini",
  match: (h) => /(^|\.)gemini\.google\.com$/.test(h),
  composer: () => ...,   // where the prompt is typed
  fileInput: () => ...,  // where the images go
  send: () => ...,       // the button
}
```

Add an entry, or fix a selector in one. The last entry, `generic`, is the
fallback for sites with no entry at all: it takes the largest editable area on
the page as the composer, which is right surprisingly often, because
generators put the prompt box in the middle and make it big.

The panel prints what each step managed, so a failure says which of the three
it could not find rather than just failing.

## The sarees

`sarees/` holds photographs of each garment **being worn by a model**, front
on - not cut-outs. The generator does the fitting here, and it reads a draped
garment on a body far better than a flat shape. About 800 px on the long side
is plenty.

- Permanently: drop the file in `sarees/` and add a line to `src/library.js`.
- Just for you: the panel's **Add saree** button, which keeps it in the
  browser's own storage and never touches the folder.

## The prompt

The default is in `src/panel.js` and is editable in the panel, where your
version is remembered. Its two load-bearing paragraphs are the two things a
generator will otherwise drift: the person must stay the same person, and the
saree must stay the same saree. Both are worth keeping if you rewrite it.

## Layout

```
manifest.json      MV3; side panel, no content scripts declared
src/background.js  opens the panel on the toolbar click, and nothing else
src/panel.*        the panel: camera, sarees, prompt, send
src/inject.js      runs in the generator's page; the adapters live here
src/library.js     the bundled sarees
sarees/            their images
```
