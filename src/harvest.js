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

  // A generated saree is a large picture. Nothing else on these pages is - but
  // a site may show it at a smaller size than it generated, so this is lower
  // than the picture actually is. Avatars and icons are nowhere near it.
  const MIN_SIDE = CFG.minSide ?? 320;
  // Long, because an image model under load is slow and a kiosk that gives up
  // at sixty seconds would look broken more often than the model is.
  const GIVE_UP_AFTER = CFG.giveUpAfter ?? 180000;
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
  const WAYS = [
    ["the assistant's turn", () => qsa('[data-message-author-role="assistant"] img')],
    ["a model response", () => qsa("model-response img, message-content img, [data-message-author-role] img")],
    ["the conversation", () => qsa("main img, article img, [role='presentation'] img")],
    ["anywhere on the page", () => qsa("img")],
  ];

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
  // refusal here is not a failure.
  async function toDataUrl(url) {
    try {
      const blob = await (await fetch(url, { credentials: "include" })).blob();
      return await new Promise((ok, no) => {
        const r = new FileReader();
        r.onload = () => ok(r.result);
        r.onerror = () => no(r.error);
        r.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

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
      try { n = f().filter((im) => im.src && !before.has(im.src)).length; } catch {}
      return `${name}: ${n}`;
    });
    return [
      `${all.length} images on the page, ${fresh.length} of them new`,
      `new sizes: ${sizes.join(", ") || "none had loaded"}`,
      `new per selector - ${ways.join("; ")}`,
    ];
  }

  window.__sareeHarvest = {
    start(id) {
      const notes = [`watching ${location.hostname} for a picture`];
      // Filled once the echo has settled; until then nothing counts as new.
      let before = null;

      let settled = false;
      let stableSince = 0;
      let stableSrc = null;

      const finish = async (found) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearInterval(timer);
        const payload = found
          ? { ok: true, id, url: found, dataUrl: await toDataUrl(found), notes }
          : { ok: false, id, notes };
        chrome.runtime.sendMessage({ type: "tryon:harvested", ...payload });
      };

      let foundBy = null;

      const look = () => {
        if (!before) return;            // still letting our own echo land
        let fresh = [];
        for (const [name, find] of WAYS) {
          let got = [];
          try { got = find(); } catch { continue; }
          fresh = got.filter(
            (im) =>
              im.src &&
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
          const url = widestOf(best);
          notes.push(
            `took a ${best.naturalWidth}x${best.naturalHeight} image from ${foundBy}` +
              (url !== best.src ? " (the widest in its srcset)" : "")
          );
          finish(url);
        }
      };

      // Snapshot after the settle, so the question's images - ours - are all
      // inside it and only the answer can look new.
      setTimeout(() => {
        before = new Set(qsa("img").map((im) => im.src));
        notes.push(`${before.size} images were already on the page`);
        look();
      }, SETTLE_FIRST);

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
