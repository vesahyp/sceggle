---
adr: 2
title: Höyry runs its own copy of Räkkä's records API, not a second game on Räkkä's
date: 2026-10-03
status: Accepted
deciders: Vesa
---

## Context

Räkkä has a global leaderboard: one DynamoDB table with an item per run and
four indexes keyed by period (day, week, month, all time) and sorted by
survival time, one Lambda behind an HTTP API for `POST /scores` and
`GET /board`, the board read through CloudFront with a one minute cache, a
histogram item per period that gives a rank with one `GetItem`, plausibility
bounds that refuse impossible runs, an API throttle, and a monthly budget
alarm. Höyry wants the same list and the same rank line after a run.

Two ways to get there: add a game key to Räkkä's table and routes so the one
Lambda serves both games, or copy the pattern into this repo.

Facts that decided it:

- **The ranking differs.** Räkkä ranks by seconds survived. Höyry ranks by
  floor reached, then by the shorter time on that floor. Räkkä's sort key is
  the time attribute and its histogram counts runs per second; Höyry needs a
  composite sort key and a histogram per floor. A shared Lambda would carry
  two scoring models, two validation tables and two histogram shapes behind
  one `game` switch.
- **The bounds are game content.** Räkkä's Lambda knows Räkkä's character
  ids and the shape of a Räkkä run. Höyry's hero ids, floors per boss and
  kills per second belong here, and change when this game is tuned.
- **Infrastructure lives in the repo it belongs to** (jeeves
  `practices/infrastructure.md`). A shared backend would make `rakka/infra`
  the place to deploy a Höyry change.
- **The account's Lambda concurrency is 10, shared, and not raised.** That
  limit counts invocations in flight, not functions. A nineteenth function
  takes nothing from the pool; traffic does. Either option costs the same
  there, and the controls are the same: reads come from the CloudFront cache
  and never reach the Lambda, and the API throttle caps writes.

## Decision

Höyry gets its own records stack in `infra/records.tf` and
`infra/records/index.mjs`, a file-for-file copy of Räkkä's with Höyry's
scoring:

- Table `hoyry-scores`, one item per run, indexes `byDay`, `byWeek`,
  `byMonth`, `byAll` sorted by `score = floor * 1e6 + (999999 - seconds)`,
  so a Query descending gives deeper floors first and faster runs first on
  the same floor.
- Histogram items `hist#<period>#<value>` with one counter per floor
  (`f12`). A rank is one plus the runs that reached a deeper floor; equal
  floors share a rank.
- `GET /board` through the existing pixel distribution, cached a minute per
  period and Origin. `POST /scores` goes to the API directly.
- Bounds from `make balance` on 2026-10-03 (bot runs to floor 20 in about
  nine minutes, at most two kills and five coins a second, a floor never
  under ten seconds), each with margin.
- Throttle at 10 requests a second with a burst of 20, so a burst of writes
  cannot hold more than a seat or two of the shared concurrency. A budget
  alarm on the `project=hoyry` tag, as Räkkä's.

The client side (`src/config.ts`, `src/api.ts`, `src/ui/Initials.tsx`, the
death screen and the records screen) is the same copy, with floor in place
of time.

## Consequences

- Two copies of the records pattern exist, in two repos. A fix in one must
  be ported to the other by hand. The files keep the same names and layout
  so a port is a diff, and this ADR is where the next reader learns there is
  a sibling.
- One more Lambda, one more table, one more HTTP API and one more budget in
  the account. Idle cost is zero; at Räkkä's portal traffic it was cents a
  month.
- The two games' leaderboards cannot be shown on one page without a second
  fetch. Nothing asks for that today.
- Räkkä's table and Lambda stay as they are. Nothing in `rakka/` changes for
  this.
