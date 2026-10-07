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
  function attachFiles(adapter, files, notes) {
    const input = adapter.fileInput();
    if (input) {
      try {
        const dt = new DataTransfer();
        files.forEach((f) => dt.items.add(f));
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        notes.push(`attached ${files.length} image(s) to a file input`);
        return true;
      } catch (e) {
        notes.push(`file input refused them (${e.message}), falling back to paste`);
      }
    }
    const target = adapter.composer() || document.body;
    try {
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      target.focus?.();
      target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      notes.push(`pasted ${files.length} image(s) into the composer`);
      return true;
    } catch (e) {
      notes.push(`paste failed: ${e.message}`);
      return false;
    }
  }

  // Typing into someone else's framework. A plain `.value = x` is ignored by
  // React, which tracks its own copy, so the native setter is called and an
  // input event fired by hand; a contenteditable takes execCommand instead,
  // which is deprecated but still the only thing every editor listens to.
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

      const attached = attachFiles(adapter, files, notes);
      // The images land asynchronously - most sites upload or thumbnail them -
      // so the prompt is written after a beat, or it can be wiped by their own
      // re-render.
      await new Promise((r) => setTimeout(r, 400));
      const typed = setPrompt(adapter, prompt, notes);

      let sent = false;
      if (autoSend) {
        await new Promise((r) => setTimeout(r, 600));
        const btn = adapter.send();
        if (btn && !btn.disabled) {
          btn.click();
          sent = true;
          notes.push("pressed send");
        } else {
          notes.push(btn ? "send button is still disabled - press it yourself" : "no send button found");
        }
      }
      return { ok: attached && typed, adapter: adapter.id, attached, typed, sent, notes };
    },
  };
})();
