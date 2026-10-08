// The one rule the waiting meter must never break, checked without a browser.
// `node test/progress.mjs`

import { progressAt, EXPECTED, CEILING } from "../webapp/progress.js";

const checks = [];
const ok = (n, p) => checks.push([n, p]);

ok("it starts at nothing", progressAt(0) === 0);
ok("it moves immediately", progressAt(2) > 5);

// The whole point. A bar that sits at 100 while the work continues says the
// machine has finished when it has not.
let everFull = false;
for (let t = 0; t <= 600; t += 0.5) if (progressAt(t) >= 100) everFull = true;
ok("it NEVER reaches 100 on its own", !everFull);
ok("it stays under its own ceiling", progressAt(100000) <= CEILING + 0.001);

// Monotonic: a number that goes backwards is worse than no number.
let backwards = false;
for (let t = 0.5; t <= 600; t += 0.5) if (progressAt(t) < progressAt(t - 0.5)) backwards = true;
ok("it never goes backwards", !backwards);

// Shaped so the expected case feels nearly done, without being done.
const atExpected = progressAt(EXPECTED);
ok(`at the expected ${EXPECTED}s it reads nearly done`, atExpected > 88 && atExpected < 95);
ok("but not finished",                                  atExpected < CEILING);

// And still visibly moving when it runs long, so a slow job does not look stuck.
ok("it is still climbing after a minute", progressAt(60) > progressAt(45));
ok("and after ninety seconds",            progressAt(90) > progressAt(60));

// Early movement is what reassures: half way by ten seconds.
ok("it is around half way by ten seconds", progressAt(10) > 40 && progressAt(10) < 55);

for (const [n, p] of checks) console.log(`${p ? "PASS" : "FAIL"}  ${n}`);
const bad = checks.filter(([, p]) => !p);
console.log(bad.length ? `\n${bad.length} failed` : `\nall ${checks.length} passed`);
process.exit(bad.length ? 1 : 0);
