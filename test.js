// node test.js
const assert = require("node:assert");
const { cached } = require("./server.js");

(async () => {
  let n = 0;
  const a = cached("k", async () => ++n), b = cached("k", async () => ++n);
  assert.equal(await a, 1);
  assert.equal(await b, 1, "concurrent calls share one fetch");

  await cached("bad", async () => { throw new Error("boom"); }).catch(() => {});
  assert.equal(await cached("bad", async () => "ok"), "ok", "failures are not cached");
  console.log("ok");
})();
