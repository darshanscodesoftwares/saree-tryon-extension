// Runs inside the generator's own page. Everything here is a guess about
// somebody else's DOM, so it is written to fail softly and say why: each step
// reports what it tried, and the panel shows that back to you. When a site
// reships its composer, the fix is a selector in ADAPTERS, not a rewrite.
//
// Injected fresh on every send, so it only defines things and waits to be
// called - see background.js.

(() => {
  const qs = (s, root = document) => root.querySelector(s);
  const qsa = (s, root = document) => [...root.querySelectorAll(s)];

  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 12) return false;
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  };

  // The biggest visible thing you could type into. This is the fallback for a
  // site nobody has written an adapter for: generators put the prompt box in
  // the middle and make it the largest editable area on the page, so "largest"
  // is a better guess than any particular class name.
  const biggestComposer = () => {
    const all = [...qsa('div[contenteditable="true"]'), ...qsa("textarea")].filter(visible);
    return all.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    })[0] || null;
  };

  // A file input will often be hidden behind an "attach" button, so visibility
  // is not required here - only that it takes images.
  const anyFileInput = () =>
    qsa('input[type="file"]').find((i) => !i.accept || /image|\*/.test(i.accept)) || null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Poll rather than guess. Every timing in here used to be a fixed sleep
  // chosen to feel about right, which on a slow upload is simply wrong, and on
  // a fast one is time spent doing nothing.
  async function waitFor(test, ms) {
    const stop = Date.now() + ms;
    for (;;) {
      if (test()) return true;
      if (Date.now() > stop) return false;
      await sleep(120);
    }
  }

  // What a page does when it accepts an image is show you one. Nearly every
  // generator renders a pending attachment as a thumbnail from a blob: or
  // data: URL, so counting those is the closest thing to proof we can get from
  // outside - and far better than the old test, which was that dispatchEvent
  // did not throw. That is true even when the page ignored the file entirely.
  const thumbCount = () => {
    let n = 0;
    for (const im of qsa("img")) if (/^(blob|data):/.test(im.src || "")) n++;
    for (const el of qsa('[style*="blob:"]')) n++;
    return n;
  };

  // Many sites mark a button unusable with aria-disabled rather than the
  // property, and a few only grey it out in CSS.
  const pressable = (b) =>
    b && !b.disabled && b.getAttribute("aria-disabled") !== "true";

  const ADAPTERS = [
    {
      id: "gemini",
      name: "Gemini",
      match: (h) => /(^|\.)gemini\.google\.com$/.test(h),
      composer: () => qs('rich-textarea div[contenteditable="true"]') || qs('div[contenteditable="true"]'),
      fileInput: anyFileInput,
      send: () => qs('button[aria-label*="Send" i]') || qs('button[aria-label*="Submit" i]'),
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      match: (h) => /(^|\.)(chatgpt\.com|chat\.openai\.com)$/.test(h),
      composer: () => qs("#prompt-textarea") || qs('div[contenteditable="true"]') || qs("textarea"),
      fileInput: anyFileInput,
      send: () => qs('button[data-testid="send-button"]') || qs('button[aria-label*="Send" i]'),
    },
    {
      id: "generic",
      name: "this page",
      match: () => true,
      composer: biggestComposer,
      fileInput: anyFileInput,
      send: () =>
        qs('button[aria-label*="Send" i]') ||
        qs('button[aria-label*="Generate" i]') ||
        qsa("button").filter(visible).find((b) => /^(send|generate|create|run)$/i.test(b.textContent.trim())),
    },
  ];

  const pickAdapter = () => ADAPTERS.find((a) => a.match(location.hostname));

  function dataUrlToFile(dataUrl, name) {
    const [head, b64] = dataUrl.split(",");
    const mime = /:(.*?);/.exec(head)[1];
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new File([buf], name, { type: mime });
  }

  // Two ways in, because sites accept one or the other and rarely both. The
  // file input is the quieter of the two when it exists; pasting is what works
  // on everything else, since a generator that takes a dropped image takes a
  // pasted one.
  const transfer = (files) => {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    return dt;
  };

  // Eight seconds is a large photograph over a shop's wifi. Past that the page
  // has almost certainly taken nothing rather than merely being slow.
  const ATTACH_WAIT = 8000;

  async function attachFiles(adapter, files, notes) {
    const before = thumbCount();
    const input = adapter.fileInput();
    if (input) {
      try {
        input.files = transfer(files).files;
        // The first input on a page that accepts images is not always the one
        // wired to the composer - it can belong to an avatar picker or a
        // dialog that is closed. Assigning to the wrong one throws nothing, so
        // without this the paste fallback would never run.
        if (input.files.length !== files.length) throw new Error("it did not keep them");
        input.dispatchEvent(new Event("change", { bubbles: true }));
        if (await waitFor(() => thumbCount() > before, ATTACH_WAIT)) {
          notes.push(`attached ${files.length} image(s) to a file input`);
          return true;
        }
        notes.push("a file input took them but nothing appeared - trying paste instead");
      } catch (e) {
        notes.push(`file input refused them (${e.message}) - trying paste instead`);
      }
    }
    const target = adapter.composer() || document.body;
    try {
      target.focus?.();
      target.dispatchEvent(new ClipboardEvent("paste", {
        clipboardData: transfer(files), bubbles: true, cancelable: true,
      }));
    } catch (e) {
      notes.push(`paste failed: ${e.message}`);
      return false;
    }
    if (await waitFor(() => thumbCount() > before, ATTACH_WAIT)) {
      notes.push(`pasted ${files.length} image(s) into the composer`);
      return true;
    }
    notes.push("nothing the page showed changed - it has probably taken neither image");
    return false;
  }

  // Typing into someone else's framework. A plain `.value = x` is ignored by
  // React, which tracks its own copy, so the native setter is called and an
  // input event fired by hand; a contenteditable takes execCommand instead,
  // which is deprecated but still the only thing every editor listens to.
  const readComposer = (el) =>
    !el ? "" : el.value !== undefined ? el.value : el.textContent;

  function setPrompt(adapter, text, notes) {
    const el = adapter.composer();
    if (!el) {
      notes.push("could not find anywhere to type the prompt");
      return false;
    }
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value").set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      notes.push("wrote the prompt into a textarea");
      return true;
    }
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand("insertText", false, text);
    if (!ok) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    }
    notes.push("wrote the prompt into a contenteditable");
    return true;
  }

  window.__sareeBridge = {
    // What the panel calls. Returns what it managed, so the panel can say so
    // rather than claim success it has not checked.
    async run({ images, prompt, autoSend }) {
      const notes = [];
      const adapter = pickAdapter();
      notes.push(`treating this as ${adapter.name}`);
      const files = images.map((im, i) => dataUrlToFile(im.dataUrl, im.name || `image-${i + 1}.jpg`));

      const attached = await attachFiles(adapter, files, notes);
      // A page usually re-renders once more just after the thumbnail lands,
      // and that render is what used to wipe the prompt.
      await sleep(250);

      let typed = setPrompt(adapter, prompt, notes);
      // Written, then read back: a composer belonging to someone else's
      // framework can accept the text and drop it on the next render, and an
      // empty box is indistinguishable from a working one until you look.
      if (typed) {
        const head = prompt.slice(0, 40);
        if (!await waitFor(() => (readComposer(adapter.composer()) || "").includes(head), 1500)) {
          notes.push("the prompt did not stay in the box - writing it again");
          typed = setPrompt(adapter, prompt, notes);
        }
      }

      let sent = false;
      if (autoSend) {
        // Generators disable send while an upload is still running, so the
        // only honest way to press it is to wait for it to come back. The old
        // fixed 600ms lost that race on anything but a small image.
        const ready = await waitFor(() => pressable(adapter.send()), 15000);
        const btn = adapter.send();
        if (ready && btn) {
          btn.click();
          sent = true;
          notes.push("pressed send");
        } else if (btn) {
          notes.push("send is still disabled after 15s - press it yourself");
        } else {
          notes.push("no send button found - press it yourself");
        }
      }
      return { ok: attached && typed, adapter: adapter.id, attached, typed, sent, notes };
    },
  };
})();
