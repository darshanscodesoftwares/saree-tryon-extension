// Runs inside the generator's page AFTER the prompt has been sent, and waits
// for the picture to come back. This is the half that has no good solution:
// sending is a thing you do to a page, but receiving means recognising a
// generated image among everything else a page draws, and nothing on the page
// is labelled "this is the one you asked for".
//
// So it is three guesses stacked, in order of how much they can be trusted:
//   1. the site's own marker for an assistant's turn - anything in a user's
//      turn is one of the two images we uploaded a moment ago
//   2. the image is new since we started watching
//   3. the image is big; avatars, icons and spinners are not
//
// Injected fresh per request, and reports back by message rather than by
// return value, because the wait outlives the service worker that started it.

(() => {
  const qsa = (s, root = document) => [...root.querySelectorAll(s)];

  // The harness sets these so a test of the give-up path need not take three
  // minutes. Nothing in the extension sets them.
  const CFG = window.__sareeHarvestConfig ?? {};

  // Printed in the notes so the ? button says which code actually ran. An
  // injected file is only re-read when the extension is reloaded, and "did it
  // reload?" has cost more time here than any bug.
  const BUILD = 7;

  // Nothing is accepted for this long after sending. The page re-hosts our own
  // uploads within a few seconds of the send - new URL, same picture - and a
  // generation takes a minute or more. So a candidate that turns up almost
  // immediately is ours, whatever the markup says about whose turn it is in.
  // This needs no knowledge of the page at all, which is the point: the
  // selector-based rule has now been wrong twice.
  const QUIET_FOR = CFG.quietFor ?? 25000;

  // A generated saree is a large picture. Nothing else on these pages is - but
  // a site may show it at a smaller size than it generated, so this is lower
  // than the picture actually is. Avatars and icons are nowhere near it.
  const MIN_SIDE = CFG.minSide ?? 320;
  // Long, because an image model under load is slow and a kiosk that gives up
  // at sixty seconds would look broken more often than the model is.
  const GIVE_UP_AFTER = CFG.giveUpAfter ?? 200000;
  // The src can change two or three times as a progressive render sharpens.
  // Taking the first frame gets you a blurred one.
  const STABLE_FOR = CFG.stableFor ?? 1500;

  // Several ways of looking, narrowest first, and the last one looks
  // everywhere. One site-specific selector is what failed the first time this
  // ran for real: ChatGPT made the picture, this was looking in the wrong box,
  // and the only thing it could report was that nothing arrived.
  //
  // Narrow is still tried first because it cannot pick up the two images we
  // just uploaded, which the page echoes back inside the USER's turn moments
  // after sending and which are also new and also big.
  // OUR OWN IMAGES ARE IN THE USER'S TURN, AND THEY MOVE.
  //
  // This is the one that bit. A page re-hosts an upload after sending - the
  // src swaps from a blob: URL to a CDN one - and that happens well after the
  // snapshot below, so the customer's own photograph looks like a brand new
  // image. It is new, it is large, and a loose selector will hand it back as
  // the answer while the real generation is still running.
  //
  // No amount of waiting fixes that, because the re-host has no deadline. The
  // only reliable rule is structural: whatever else is true, the answer is
  // never inside the turn we wrote.
  const ours = (im) =>
    !!im.closest('[data-message-author-role="user"], [data-message-author-role="system"]');

  const WAYS = [
    ["the assistant's turn", () => qsa('[data-message-author-role="assistant"] img')],
    ["a model response", () => qsa("model-response img, message-content img")],
    ["the conversation", () => qsa("main img, article img, [role='presentation'] img")],
    ["anywhere on the page", () => qsa("img")],
  ];

  // Recovery has no "before" to protect it, so it only gets the two selectors
  // that are scoped to an answer. Letting it fall through to "anywhere on the
  // page" with nothing excluded is how you return the customer to herself.
  const WAYS_RECOVER = WAYS.slice(0, 2);

  // Our own two images, which the page re-renders into the user's turn just
  // after sending, are the one thing that must not be mistaken for the answer.
  // Comparing URLs does not work - the page re-hosts them, so the src it shows
  // has nothing to do with the data URL that was sent. Waiting does work: let
  // the echo land, THEN decide what counts as already-there. A generation
  // takes tens of seconds, so a couple of seconds costs nothing.
  const SETTLE_FIRST = CFG.settleFirst ?? 2500;

  const bigEnough = (im) =>
    Math.min(im.naturalWidth, im.naturalHeight) >= MIN_SIDE ||
    Math.max(im.naturalWidth, im.naturalHeight) >= MIN_SIDE * 1.5;

  // A page often renders a smaller copy than the model produced, and srcset is
  // where it names the big one. Take the widest entry rather than whatever the
  // layout happened to ask for, or the kiosk shows a downscale of its own
  // picture.
  function widestOf(im) {
    if (!im.srcset) return im.src;
    const best = im.srcset
      // Split on a comma FOLLOWED BY WHITESPACE, which is how srcset separates
      // its entries - a plain split on "," also cuts a data: URL in half at
      // "base64,", and a CDN URL with a comma in its query string with it.
      .split(/\s*,\s+/)
      .map((part) => part.trim().split(/\s+/))
      .map(([url, descriptor]) => ({ url, w: parseInt(descriptor, 10) || 0 }))
      .sort((a, b) => b.w - a.w)[0];
    try {
      return best && best.w ? new URL(best.url, location.href).href : im.src;
    } catch {
      return im.src;
    }
  }

  // Reading the bytes is worth a try, because a data URL can be saved and a
  // CDN link cannot - but the link alone is enough to put it on screen, so a
  // refusal here is not a failure. The blob comes back too, because the
  // fingerprint below needs the pixels and fetching twice would be wasteful.
  async function fetchPicture(url) {
    try {
      const blob = await (await fetch(url, { credentials: "include" })).blob();
      const dataUrl = await new Promise((ok, no) => {
        const r = new FileReader();
        r.onload = () => ok(r.result);
        r.onerror = () => no(r.error);
        r.readAsDataURL(blob);
      });
      return { blob, dataUrl };
    } catch {
      return { blob: null, dataUrl: null };
    }
  }
  const toDataUrl = async (url) => (await fetchPicture(url)).dataUrl;

  // IS THIS THE SAME PICTURE?
  //
  // An 8x8 average hash was the wrong instrument, and it broke the thing it was
  // meant to protect. Every picture here is one person, centred, full length,
  // on a plain pale background - the garment's catalogue shot and the generated
  // try-on alike. At 64 bits of coarse brightness those two ARE the same image,
  // so the gate started refusing the real answer and nothing came back at all.
  //
  // Compare at a resolution that can tell two people apart instead: 32x32 grey,
  // and the mean absolute difference between them. A re-encoded copy of the
  // same picture lands a point or two away; two different photographs of two
  // different people, however alike the staging, land far above that.
  //
  // Drawing is safe because we fetched the bytes ourselves - a blob is not
  // cross-origin, so the canvas is not tainted and the pixels can be read.
  const FP = 32;

  async function fingerprint(src) {
    try {
      const bmp = await createImageBitmap(
        typeof src === "string" ? await (await fetch(src)).blob() : src
      );
      const c = new OffscreenCanvas(FP, FP);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, FP, FP);
      bmp.close();
      const d = ctx.getImageData(0, 0, FP, FP).data;
      const out = new Float32Array(FP * FP);
      for (let i = 0; i < FP * FP; i++) {
        out[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
      }
      return out;
    } catch {
      return null;
    }
  }

  // 0 is identical; 255 would be black against white. Written into the notes
  // either way, so the number can be read off a screenshot and this threshold
  // settled against real pictures rather than guessed at a third time.
  const differ = (a, b) => {
    if (!a || !b || a.length !== b.length) return 999;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  };
  const SAME_PICTURE = 8;
  // What the page is showing, for when none of it is what we wanted. Without
  // this a failure says "nothing arrived", which is true and useless.
  function census(before) {
    const all = qsa("img");
    const fresh = all.filter((im) => im.src && !before.has(im.src));
    const sizes = fresh
      .map((im) => `${im.naturalWidth}x${im.naturalHeight}`)
      .filter((d) => d !== "0x0")
      .slice(0, 8);
    const ways = WAYS.map(([name, f]) => {
      let n = 0;
      try { n = f().filter((im) => im.src && !ours(im) && !before.has(im.src)).length; } catch {}
      return `${name}: ${n}`;
    });
    return [
      `${all.length} images on the page, ${fresh.length} of them new`,
      `new sizes: ${sizes.join(", ") || "none had loaded"}`,
      `new per selector - ${ways.join("; ")}`,
    ];
  }

  window.__sareeHarvest = {
    // What this script has seen so far. The worker reads it from outside every
    // few seconds, because a pushed message is a single point of failure: if
    // this script dies - the tab reloads, the page navigates, the injected
    // context goes - nothing ever reports and the job hangs until the screen
    // gives up. Being readable from outside means the worker can notice.
    state: { id: null, watching: false, done: false, payload: null },
    peek() { return this.state; },

    // recover = this script was re-injected after dying, so whatever is on the
    // page now arrived while nobody was watching. There is no "before" to
    // compare against, so take the newest large picture in the answer.
    // sent: the data URLs we uploaded. The only certain test of "is this
    // ours" is the bytes, because a re-hosted upload keeps its pixels and
    // changes everything else.
    start(id, recover = false, sent = []) {
      this.state = { id, watching: true, done: false, payload: null };
      const self = this;
      const startedAt = Date.now();
      // What our two uploads look like, computed once while the page works.
      const mine = Promise.all(sent.filter(Boolean).map(fingerprint)).then((xs) =>
        xs.filter(Boolean)
      );
      const notes = [`watching ${location.hostname} for a picture (harvest build ${BUILD})`];
      // Filled once the echo has settled; until then nothing counts as new.
      let before = null;

      let settled = false;
      let stableSince = 0;
      let stableSrc = null;

      const finish = async (found, already) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearInterval(timer);
        const payload = found
          ? { ok: true, id, url: found, dataUrl: already ?? (await toDataUrl(found)), notes }
          : { ok: false, id, notes };
        // Recorded first, pushed second. The record is what the worker falls
        // back to when the push does not arrive.
        self.state = { id, watching: false, done: true, payload };
        chrome.runtime.sendMessage({ type: "tryon:harvested", ...payload });
      };

      let foundBy = null;
      let judging = null;     // the src currently being fetched and compared

      const look = () => {
        if (!before) return;            // still letting our own echo land
        // Too soon to be an answer: this is the window in which the page
        // re-hosts what we uploaded.
        if (!recover && Date.now() - startedAt < QUIET_FOR) return;
        let fresh = [];
        for (const [name, find] of (recover ? WAYS_RECOVER : WAYS)) {
          let got = [];
          try { got = find(); } catch { continue; }
          fresh = got.filter(
            (im) =>
              im.src &&
              !ours(im) &&            // never the customer's own photograph
              !before.has(im.src) &&
              im.complete &&
              bigEnough(im)
          );
          if (fresh.length) { foundBy = name; break; }
        }
        // The newest one: a conversation grows downward, and a retry appends.
        const best = fresh[fresh.length - 1];
        if (!best) {
          stableSrc = null;
          return;
        }
        if (best.src !== stableSrc) {
          stableSrc = best.src;
          stableSince = Date.now();
          return;
        }
        if (Date.now() - stableSince >= STABLE_FOR) {
          if (judging === best.src) return;   // already being checked
          judging = best.src;
          const url = widestOf(best);
          // Last gate, and the only certain one: fetch it and see whether it
          // is byte for byte something we sent. A re-hosted upload survives
          // every other test because only its address changed.
          (async () => {
            const { blob, dataUrl: got } = await fetchPicture(url);
            const byteMatch = got && sent.some((our) => our && got === our);
            const fp = blob ? await fingerprint(blob) : null;
            const gaps = fp ? (await mine).map((m) => differ(fp, m)) : [];
            const nearest = gaps.length ? Math.min(...gaps) : null;
            const looksMatch = nearest !== null && nearest <= SAME_PICTURE;
            if (byteMatch || looksMatch) {
              notes.push(
                byteMatch
                  ? "that was one of ours, served back unchanged - still watching"
                  : `that was one of ours, re-encoded (differs by ${nearest.toFixed(1)}) - still watching`
              );
              before.add(best.src);          // never offer it again
              stableSrc = null;
              judging = null;
              return;
            }
            notes.push(
              `took a ${best.naturalWidth}x${best.naturalHeight} image from ${foundBy}` +
                (url !== best.src ? " (the widest in its srcset)" : "") +
                (nearest !== null ? `, ${nearest.toFixed(1)} from the nearest of ours` : "")
            );
            finish(url, got);
          })();
        }
      };

      if (recover) {
        // Nothing counts as already-there: whatever is on the page is all we
        // have, and the answer is the last large picture in it.
        before = new Set();
        notes.push("picked up again after the watcher was lost");
        setTimeout(look, 400);
      } else {
        // Snapshot after the settle, so the question's images - ours - are all
        // inside it and only the answer can look new.
        setTimeout(() => {
          before = new Set(qsa("img").map((im) => im.src));
          notes.push(`${before.size} images were already on the page`);
          look();
        }, SETTLE_FIRST);
      }

      const observer = new MutationObserver(look);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
      // The observer misses an image that was already in the DOM and only
      // finished decoding, so poll as well. Neither alone is enough.
      const timer = setInterval(look, 500);
      setTimeout(() => {
        // Guarded, not just reported: notes is the same array already handed to
        // finish(), so writing to it after a success corrupts a result that has
        // already been sent - and makes a working run look like a failed one.
        if (settled) return;
        notes.push("nothing that looked like a generated image arrived in three minutes");
        // The census is the whole point of failing loudly: it says what the
        // page actually had, so the selector can be fixed rather than guessed.
        notes.push(...census(before ?? new Set()));
        finish(null);
      }, GIVE_UP_AFTER);
      return { watching: true };
    },
  };
})();
