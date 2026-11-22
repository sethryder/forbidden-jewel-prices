// node --test   (no network: GGG and poe.ninja are faked)
const { test, before, after } = require("node:test");
const assert = require("node:assert");

// Fake upstreams before server.js loads. Requests to our own server go through the real fetch.
const realFetch = fetch;
const calls = [];
const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  if (u.hostname === "127.0.0.1") return realFetch(url, init);
  calls.push({ url: u, body: init?.body && JSON.parse(init.body) });
  if (u.pathname === "/api/leagues") return reply([
    { id: "Standard", category: { id: "Standard" } },
    { id: "SSF Covens", category: { id: "Covens" }, rules: [{ id: "NoParties" }] },
    { id: "Covens", category: { id: "Covens" } },
    { id: "Hardcore", category: { id: "Standard" }, rules: [{ id: "Hardcore" }] },
  ]);
  if (u.hostname === "poe.ninja") return reply({ lines: [
    { metadata: { passiveName: "Ancestral Fury" }, variant: "Forbidden Flame", chaosValue: 10, divineValue: 0.1, listingCount: 3,
      sparkLine: { data: [1, 2], totalChange: 5 } },
    { metadata: { passiveName: "Ancestral Fury" }, variant: "Forbidden Flesh", chaosValue: 20, divineValue: 0.2, listingCount: 4 },
  ] });
  if (u.pathname.startsWith("/api/trade/search/")) return reply({ id: "q1", total: 4, result: ["a", "b", "c", "d"] });
  if (u.pathname.startsWith("/api/trade/fetch/")) return reply({ result: [
    { listing: { price: { amount: 1, currency: "chaos" } } },
    { listing: { price: { amount: 2, currency: "chaos" } } },
    { listing: { price: { amount: 1, currency: "divine" } } },
    { listing: { price: { amount: 2, currency: "divine" } } },
  ] });
  return reply({}, 404);
};

const { cached, server } = require("./server.js");
let base;
before(() => new Promise(r => server.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => server.close());
const get = async path => { const r = await fetch(base + path); return { status: r.status, body: await r.json().catch(() => null) }; };

test("cached shares concurrent fetches and doesn't cache failures", async () => {
  let n = 0;
  const a = cached("k", async () => ++n), b = cached("k", async () => ++n);
  assert.equal(await a, 1);
  assert.equal(await b, 1);
  await cached("bad", async () => { throw new Error("boom"); }).catch(() => {});
  assert.equal(await cached("bad", async () => "ok"), "ok");
});

test("/leagues drops SSF and lists challenge leagues first", async () => {
  assert.deepEqual((await get("/leagues")).body, ["Covens", "Standard", "Hardcore"]);
});

test("unknown league or notable is rejected without an upstream search", async () => {
  const before = calls.length;
  assert.equal((await get("/ninja?league=Nope")).status, 400);
  assert.equal((await get("/price?league=Nope&opt=38999")).status, 400);
  assert.equal((await get("/price?league=Covens&opt=1")).status, 400);
  assert.equal((await get("/price?league=SSF%20Covens&opt=38999")).status, 400);
  assert.ok(calls.slice(before).every(c => c.url.pathname === "/api/leagues"));
});

test("/ninja reshapes lines by notable and jewel", async () => {
  const { status, body } = await get("/ninja?league=Covens");
  assert.equal(status, 200);
  assert.deepEqual(body.notables["Ancestral Fury"], {
    "Forbidden Flame": { chaos: 10, divine: 0.1, listings: 3, trend: [1, 2], change: 5 },
    "Forbidden Flesh": { chaos: 20, divine: 0.2, listings: 4, trend: [], change: null },
  });
});

test("/price searches both jewels and takes the lower middle listing as median", async () => {
  const { status, body } = await get("/price?league=Covens&opt=38999");
  assert.equal(status, 200);
  for (const name of ["Forbidden Flame", "Forbidden Flesh"]) {
    assert.deepEqual(body[name], { total: 4, median: "2 chaos", prices: ["1 chaos", "2 chaos", "1 divine", "2 divine"] });
  }
  const searches = calls.filter(c => c.url.pathname === "/api/trade/search/Covens");
  assert.deepEqual(searches.map(s => s.body.query.name), ["Forbidden Flame", "Forbidden Flesh"]);
  assert.match(searches[0].body.query.stats[0].filters[0].id, /\|38999$/);
});

test("serves the page and 404s everything else", async () => {
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<select id="league">/);
  assert.equal((await get("/nope")).status, 404);
});
