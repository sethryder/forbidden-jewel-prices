# Forbidden Flame & Flesh prices

Pick a Path of Exile ascendancy notable and see what both halves of the Forbidden jewel pair cost:
the poe.ninja estimate with a 7-day trend, the live trade-site median, and a one-click trade search for each jewel.

Live at https://forbidden.washclof.com

## Run

Needs Node 20.12+ and no dependencies.

```sh
cp .env.example .env   # set CONTACT to an email or URL
node server.js         # http://localhost:8080
node test.js           # cache self-check
```

## How it works

- `server.js` serves the page and two cached endpoints:
  - `/ninja?league=`: every Forbidden jewel price in one poe.ninja request, cached for 30 minutes (poe.ninja's own cache time).
  - `/price?league=&opt=`: live trade search for one notable. It returns the 10 cheapest listings and their median, cached for 24 hours.
- `notables.json`: notable name → trade-site option id and ascendancy. It comes from
  `https://www.pathofexile.com/api/trade/data/stats` and needs refreshing when ascendancies change.
- Requests send a User-Agent with your `CONTACT`, as GGG and poe.ninja ask.

Code is MIT licensed (see `LICENSE`). Not affiliated with Grinding Gear Games. The jewel icons belong to GGG and are not covered by the MIT license.
