// The history is the one place the server keeps customers' pictures, so what
// matters is what it does NOT do: show them without the key, keep more than it
// should, or list a picture twice. Starts a real server on a spare port.
import { spawn } from "node:child_process";
import { once } from "node:events";

const PORT = 5600 + Math.floor(Math.random() * 300);
const B = `http://127.0.0.1:${PORT}`;
const KEY = "test-key";
const server = spawn(process.execPath, ["server.mjs"], {
  env: { ...process.env, PORT: String(PORT), HTTPS_PORT: String(PORT + 1000), CONTROL_KEY: KEY, OPENAI_API_KEY: "" },
  stdio: "ignore",
});

let failed = 0;
const ok = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) failed++; };

// 1x1 jpeg-ish payload: the server never decodes it, it only stores and serves it.
const PIC = "data:image/jpeg;base64," + Buffer.from("not really a jpeg").toString("base64");
const post = (p, b, h = {}) => fetch(B + p, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(b) });
const get = (p, key) => fetch(B + p, { headers: key ? { "x-control-key": key } : {} });
const finish = async (name, kind) => {
  const { id } = await (await post("/api/jobs", { person: PIC, saree: PIC, prompt: "x", garment: { name, kind } })).json();
  await post(`/api/jobs/${id}/result`, { image: PIC, notes: [] });
  return id;
};

try {
  for (let i = 0; i < 40; i++) { try { if ((await get("/api/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

  ok("the list is refused without the key", (await get("/api/history")).status === 403);
  ok("and with the wrong one", (await get("/api/history", "nope")).status === 403);
  ok("it starts empty", (await (await get("/api/history", KEY)).json()).history.length === 0);

  const first = await finish("Red bridal", "saree");
  await post(`/api/jobs/${first}/result`, { image: PIC, notes: [] });     // delivered twice
  const second = await finish("Maroon shirt", "formals-men");
  const list = (await (await get("/api/history", KEY)).json()).history;
  ok("a delivery twice is one entry", list.length === 2);
  ok("newest first", list[0].id === second && list[1].id === first);
  ok("each says what it was of", list[0].name === "Maroon shirt" && list[0].kind === "formals-men");
  ok("the list carries no pictures", !JSON.stringify(list).includes("base64"));

  ok("a picture is refused without the key", (await get(`/api/history/${first}`)).status === 403);
  const pic = await get(`/api/history/${first}`, KEY);
  ok("and served as an image with it", pic.status === 200 && pic.headers.get("content-type") === "image/jpeg"
     && Buffer.from(await pic.arrayBuffer()).toString() === "not really a jpeg");

  // A failure is not a picture.
  const { id: bad } = await (await post("/api/jobs", { person: PIC, saree: PIC, prompt: "x" })).json();
  await post(`/api/jobs/${bad}/result`, { notes: ["it broke"] });
  ok("a failed job is not recorded", (await (await get("/api/history", KEY)).json()).history.length === 2);

  for (let i = 0; i < 35; i++) await finish(`n${i}`, "saree");
  const capped = (await (await get("/api/history", KEY)).json()).history;
  ok("it is capped at 30", capped.length === 30);
  ok("and the oldest went, not the newest", capped[0].name === "n34" && !capped.some((h) => h.id === first));

  ok("clearing needs the key", (await fetch(`${B}/api/history`, { method: "DELETE" })).status === 403);
  await fetch(`${B}/api/history`, { method: "DELETE", headers: { "x-control-key": KEY } });
  ok("and empties it", (await (await get("/api/history", KEY)).json()).history.length === 0);
} finally {
  server.kill();
  await once(server, "exit").catch(() => {});
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
