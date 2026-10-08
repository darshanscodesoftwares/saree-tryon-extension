# Saree Try-On Bridge

A Chrome side panel that photographs a customer, lets you pick a saree, and
hands both to whatever AI image generator is open in the tab beside it, with
the prompt already written.

It is a bridge, not a generator. The hard part - putting the cloth on the
person - is done by the model you are already paying for. This exists so that
the ten clicks it takes to do that by hand become one.

**The generator has to accept two reference images.** That is the real ceiling
here, and it is a limit of the model rather than of this extension. Gemini and
ChatGPT's image model both condition on a subject and a garment at once;
several well-known generators take one reference or none, and on those the
images will arrive, the prompt will be typed, and the result will be a stranger
in a different saree. If output looks wrong, check that before blaming the
prompt.

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
3. Get a photograph of the customer, either way round:
   - **Turn camera on**, stand them in frame, **Capture**; or
   - **Upload a photo** - the one that arrived by message, or was taken
     before the panel was open.
4. Pick a saree.
5. **Send to the page.**

The first send to a new site asks for permission for that site. Nothing is
granted up front beyond Gemini and ChatGPT.

## Two things to know before you use it on a customer

**A photograph of the customer leaves the machine.** The panel itself sends nothing
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

It also waits rather than guesses, which is most of what makes it usable on a
site nobody has written an adapter for:

- **Attaching is confirmed, not assumed.** Setting `input.files` throws nothing
  when the input belongs to an avatar picker or a closed dialog, so the old
  code reported those pages as a success. It now watches for the thumbnail the
  page draws when it accepts an image, falls back to pasting if none appears,
  and says plainly when neither worked.
- **Send waits for the button.** Generators disable send while an upload is
  running. The old code pressed after a fixed 600ms and lost that race on
  anything larger than a small photo; it now waits up to 15s for the button to
  become pressable, and `aria-disabled` counts as disabled.
- **The prompt is read back.** A composer belonging to someone else's framework
  can accept the text and drop it on the next render, so it is typed, checked,
  and typed again if it did not stay.

## Any screen, one browser

The kiosk does not talk to the extension. It posts a job to a queue and polls
for a picture; the extension's own service worker takes the job and does the
work. That indirection is why a phone can run it: **no phone browser has
extensions**, so a kiosk that needed one could only ever have been a desktop.

```
  phone / tablet / desktop          this machine            ChatGPT tab
  webapp/              POST -->   server.mjs
  tryon-client.js                 (the queue)
        |                              ^  |  long poll
        +-- polls for the picture -----+  v
                                src/background.js --> src/inject.js    send it
                                (the worker)          src/harvest.js   wait for it
```

**`webapp/tryon-client.js` is the seam**, and it is already an HTTP client.
When there is an API key to spend it is rewritten against the real image API
and nothing else moves.

### Running it

```
npm start
```

prints both addresses:

```
  desktop   http://localhost:5200/webapp/      (the one that generates)
  phone     https://192.168.1.23:5443/webapp/  (same, over the wifi)
```

Load the extension, leave a signed-in generator tab open, and open the kiosk
wherever you like. There is no third page to open. **If you change
`manifest.json`, reload the extension at `chrome://extensions`.**

## The screen itself

Three shapes from one stylesheet, and the breakpoints key on **orientation,
not width** - a kiosk panel is 1080 CSS px wide, wider than a laptop, so any
width-only rule sends it down the desktop branch.

| | layout |
|---|---|
| phone | one column, fixed dock; tiles become rows below a 380px container |
| kiosk, portrait >=760px | one column, fixed dock, and a dead plinth below it |
| desktop, >=1000px landscape | two panes: your photo sticky left, shelf scrolling right |
| short landscape | header gone, dock becomes a right rail |

**The bottom of a kiosk is unreachable.** A 32-inch portrait panel mounted at
standing height puts its top edge near 1600mm, and ADA 308 caps forward reach
at 1220mm - so only the lower half is usable, and a button at the very bottom
is near knee height. The shell gives the bottom `26vh` away as an empty plinth,
which lands the primary action at about 69% of screen height.

**Nothing required ever scrolls.** The dock is fixed at every size; only the
shelf scrolls. A touch panel has no scrollbar, no wheel and no PageDown, and a
customer using this once has no reason to go looking.

### Why the interface is not gold any more

The garments own the colours between 330 and 45 degrees - pinks, reds, zari -
and the UI was using them too. Measured against the three saree photographs a
gold selection ring scores **1.18:1 to 1.55:1**: the most important state in
the app, invisible on the very thing it marks. The primary button reached
3.67:1, quieter than the product.

So the UI speaks in peacock, and gold stays as *light* - a warm wash from above
in `body::before` - never as ink.

That alone is not enough, and the fix is a construction rather than a colour:
**no accent meets 3:1 laid directly on a garment photograph**; jade scores 1.77
to 2.33 on these three. Each tile keeps a 5px inset of page colour around its
image and the ring sits outside that, on the ground, at 9.96:1.
`node test/contrast.mjs` checks all 18 pairs including the inset, and prints
the direct-ring numbers so nobody later simplifies the gap away.

Selection is never colour alone - a ring, a tick, and the name turning solid -
and tiles are real `<button aria-pressed>` elements. They were `<figure>`s with
click listeners, reachable by no keyboard and no screen reader.

### What a customer sees when something is wrong

Nothing about extensions, queues or `chrome://extensions`. A shopper gets
"This screen is having a moment - please ask one of us". The real diagnostic is
behind the **?** in the corner, for staff.

### On a kiosk only

`?kiosk=1`, or a large portrait screen, turns on two behaviours that would be
hostile on a personal phone: an **attract screen** when idle, and a **timeout**
that warns at 45 seconds, counts down 20 more, then wipes. The wipe is literal:
it stops the camera, drops the canvas and *removes* the `src` attributes rather
than emptying them, because this screen is holding a photograph of a stranger.

## The garments, and the three prompts

A garment carries a **kind**, and the kind picks the instruction sent with it:

| kind | what the prompt is about |
|---|---|
| `saree` | the **drape** - which shoulder the pallu falls over, where the pleats sit, where the border lands |
| `formals-women` | the **cut** - neckline, closure, sleeve, fit, hemline |
| `formals-men` | the **cut** - collar, placket, cuffs, trouser fit and break |

That split is the point. A saree is six metres of cloth and the only question
is how it is draped; formals are tailored and the question is the shape they
were cut to. Sending a saree prompt with a shirt asks the model to drape a
pallu that is not there.

All three carry the same **skin** paragraph, for a failure that has nothing to
do with the garment: a generator keeps the face it was given and then renders
the neck, arms and hands a shade or two lighter, so the result reads as a face
placed on somebody else's body. It is the first thing anyone notices, and it
does not stop unless the prompt says so outright - name every part the garment
leaves visible, forbid lightening and smoothing, and say plainly that light may
fall differently across the body while the skin itself does not change.

All three forbid the same thing too, because it is the other failure they
share: left alone a generator **smartens a garment up**. A plain shirt gains a sheen, a
modest neckline drops, a border grows. The customer is then shown something the
shop cannot sell her, so each prompt refuses it in as many words rather than
hoping.

`src/prompt.js` holds them. `node test/prompts.mjs` (or `npm test`) checks each
one still says what it has to - the skin paragraph among them - including that no saree word has leaked into a
formals prompt, which is the mistake that would be hardest to spot by reading.

**In the panel** each kind has its own editable prompt, separately remembered,
so rewriting the saree instruction does not quietly rewrite the one sent with a
suit. Choosing a garment switches the box to its kind. **Reset to default**
forgets the override rather than storing a copy, so a later change to the
shipped wording reaches anyone who has not deliberately rewritten it - if you
have edited a prompt, press Reset to pick up a change made here.

**In the kiosk** nobody is standing there to choose, so the garment's kind
decides and there is no prompt box at all.

### Adding one

- **In the panel**, with **Add garment** and the kind chosen beside it. It
  appears on every screen within a few seconds, including a phone.
- **In the repository**, by dropping the file in `sarees/` and adding a line to
  `src/library.js`. Use this for stock that should be there on a fresh machine.

The first one works because of a detour worth knowing about. A kiosk cannot
read the extension's storage - different origin - and a phone has no extension
at all, so neither can see what the panel knows. But the side panel and the
extension's service worker ARE the same origin, so the worker reads that same
database and publishes it to the queue, and the screens read it from there:

```
side panel  ──writes──▶  extension's IndexedDB
                               │ read by the service worker
                               ▼
                         POST /api/garments  ──▶  server.mjs
                                                   │ merged with src/library.js
  any screen, any device  ◀── GET /api/garments ───┘
```

The server merges the two, so the bundled garments are always offered even
before the extension has said anything, and there is one list rather than two -
`server.mjs` imports `src/library.js` directly. The panel tells the worker the
moment a garment is added, removed or re-kinded, so it reaches a kiosk while
the shopkeeper is still looking at it.

The server holds that catalogue in memory, so restarting it loses the published
half. Every reply to a worker's poll therefore says how many it is holding; if
that disagrees with what the worker last sent, it sends them again. Without
that a restarted server could show a kiosk three sarees for eight minutes,
which is how long a poll loop can run before it comes round again.

**A garment's kind can be changed after it is added** - select it in the panel
and use the dropdown beside Remove. Anything added before kinds existed reads
as a saree, and without this the only way to correct one would be to delete it
and upload the file again.

On a kiosk the shelf is **grouped by kind**, with a heading per group - but
only when more than one kind is on it, since a "Saree" label over three sarees
tells a customer nothing.

## Layout

```
manifest.json      MV3; side panel, no content scripts declared
src/background.js  the worker: polls the queue, drives the generator
src/panel.*        the panel: camera, sarees, prompt, send
src/inject.js      runs in the generator's page; the adapters live here
server.mjs         serves this folder: http for the desktop, https for a phone
src/library.js     the garments that ship with it
src/prompt.js      the three instructions, one per kind of garment
src/harvest.js     runs in the generator's page; waits for the picture
sarees/            the bundled garment photographs
webapp/            the kiosk; tryon-client.js is the seam
webapp/anim/       the sewing animation shown while it works
webapp/vendor/     lottie-web, vendored so the shop machine needs no internet
test/              six harnesses, two node checks and a console snippet
```

## Tests

`npm test` runs the two that need no browser. The rest are pages: `npm start`
and open them from the same origin.

- `test/mock-generator.html` stands in for a generator's page and checks that
  `src/inject.js` really delivered: what the page *received*, not what inject
  claims. It behaves like a real one - draws a thumbnail, and keeps Send
  disabled until the upload finishes.

  | | |
  |---|---|
  | `?shape=textarea` | a plain textarea instead of a contenteditable |
  | `?nofile=1` | no file input, so the paste fallback has to carry it |
  | `?upload=N` | how long the page pretends the upload takes (default 1200ms) |
  | `?ignore=1` | a page with an input and a composer that silently uses neither |

  The last two are the regression tests for the two bugs worth having: at the
  default `upload` the old fixed-timer code presses a disabled button, and
  against `ignore` it reports a page that took nothing as a success.
- `test/panel-photo.html` drives the real `src/panel.js` with `chrome.*` and
  the camera stubbed, over both ways a photograph gets in. It reads the
  pixels back out, so it catches the one that is easy to get wrong: a camera
  frame is mirrored, because the preview is and the customer posed in it, and
  an uploaded photograph is not.

- `test/mock-harvest.html` tests `src/harvest.js` - recognising the answer -
  against a fake generator DOM. `?where=assistant|main|none` moves or removes
  the picture; `?echo=late` re-renders our own uploads after watching starts.
- `test/queue-client.html` tests `webapp/tryon-client.js` - the seam - against
  the real server, standing in for the worker itself. That is the payoff of the
  queue: the kiosk's whole back end can be proved with no extension, no ChatGPT
  and no browser tab. Note the slow-worker case: with a worker that answers
  instantly there is no "running" state to observe, so a progress check written
  without one passes on nothing.
Each writes PASS/FAIL into the page, into `document.title`, and into the query
string, so a headless run can read the result without a driver library.

- `node test/prompts.mjs` and `node test/contrast.mjs`, both run by `npm test`,
  check things that are not behaviour: what the three prompts say, and whether
  every colour pair the interface puts together clears WCAG AA. Neither needs a
  browser.
- `test/kiosk-shelf.html` drives the real kiosk page in an iframe against the
  real server: that a garment added in the panel reaches the screen, that the
  shelf is grouped, and that the tiles are buttons that report `aria-pressed`.

**`mock-harvest.html`, `panel-photo.html` and `kiosk-layout.html` must run in
real time**, not under `--virtual-time-budget`. Each waits on something that is
not a timer - an image decoding, a camera frame - while `harvest.js` polls on a
`setInterval`; virtual time races that clock far ahead of the real work and the
page is dumped before it finishes. It presents as a hang, which is a confusing
way to find out. Read their result through `--remote-debugging-port` instead.

**Not covered by any of them:** the real round trip through a real generator.
`harvest.js` has never run against the live ChatGPT DOM, only against the
reasoning above. That is the first thing to check by hand.
