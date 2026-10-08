// How far along to SAY we are.
//
// Nothing on the other side reports real progress - a generator takes the job
// and goes quiet until a picture appears - so this is a guess from the clock.
// That is fine, and it is far better than three dots: a number still climbing
// says the machine is alive, where a lit dot after ninety seconds says nothing.
//
// The one rule it must not break: never reach 100 before the picture does. A
// bar that sits full while the work continues says the machine has finished
// when it has not, and every second after that reads as broken. So the curve
// approaches a ceiling and stops there, and only the picture arriving takes it
// the rest of the way.

/** What a generation usually takes, in seconds. */
export const EXPECTED = 45;

/** The most it will ever claim on its own. */
export const CEILING = 97;

// Chosen so EXPECTED lands near 92%: far enough along to feel nearly done,
// with room left to keep moving if it runs long.
const TAU = 15.2;

/** @param {number} seconds since the work actually started */
export const progressAt = (seconds) =>
  CEILING * (1 - Math.exp(-Math.max(0, seconds) / TAU));
