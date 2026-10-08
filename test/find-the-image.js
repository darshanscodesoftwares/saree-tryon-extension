// Paste this into the CONSOLE OF THE GENERATOR TAB, with a generated picture
// on screen. It prints every large image and the chain of elements above it,
// which is what a selector in src/harvest.js has to match.
//
// This exists because harvest.js has to recognise a generated picture in
// somebody else's markup, and the first time it ran for real it could not.
// Guessing at that markup from outside costs a round trip each time; this
// answers it once.

(() => {
  const big = [...document.querySelectorAll("img")].filter(
    (i) => Math.max(i.naturalWidth, i.naturalHeight) >= 300
  );

  const chainOf = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const attrs = [...e.attributes]
        .filter((a) => /^(data-|role$|id$|aria-label$)/.test(a.name))
        .map((a) => `${a.name}="${a.value}"`)
        .join(" ");
      parts.push(e.tagName.toLowerCase() + (attrs ? `[${attrs}]` : ""));
      if (parts.length >= 9) break;
    }
    return parts.join("  <  ");
  };

  const report =
    `${document.querySelectorAll("img").length} images on the page, ` +
    `${big.length} of them 300px or more\n\n` +
    big
      .map(
        (i, n) =>
          `#${n + 1}  ${i.naturalWidth}x${i.naturalHeight}\n` +
          `    src: ${i.src.slice(0, 90)}\n` +
          `    ${chainOf(i)}`
      )
      .join("\n\n") +
    `\n\nwhat harvest.js currently looks for:\n` +
    [
      `[data-message-author-role="assistant"] img`,
      `model-response img, message-content img, [data-message-author-role] img`,
      `main img, article img, [role='presentation'] img`,
      `img`,
    ]
      .map((s) => {
        let n = 0;
        try { n = document.querySelectorAll(s).length; } catch { n = -1; }
        return `    ${n} match  ${s}`;
      })
      .join("\n");

  console.log(report);
  try { copy(report); console.log("\n(copied to the clipboard)"); } catch {}
  return report;
})();
