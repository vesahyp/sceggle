// Höyry records API. One Lambda, a copy of Räkkä's (../../../rakka/infra/records,
// docs/adr/0002-own-records-api.md) with floors in place of seconds:
//   POST /scores        {name, hero, floor, time, kills, coins, bosses, guns}
//   GET  /board?period=day|week|month|all   the top 25 and the histogram;
//        the game reads it through CloudFront, cached for a minute
// Names are three characters, A-Z and 0-9, like a pinball machine. Periods
// are counted in Europe/Helsinki. The table has one item per run and four
// indexes keyed by period value and sorted by `score`, so a top list is one
// Query. The score is floor * 1e6 + (999999 - seconds): a deeper floor wins,
// and on the same floor the faster run.
//
// Ranks come from a histogram, one item per period value
// (`hist#day#2026-10-03`) with one counter per floor reached (`f12`), raised
// with ADD on every score. A rank is one plus the runs on deeper floors:
// one GetItem at any table size, and equal floors share a rank. The
// histogram items have no `score` or period attributes, so they stay out of
// the indexes.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.TABLE;
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const NAME = /^[A-Z0-9]{3}$/;
// type:maker:rarity, with the legend id when the gun is orange.
const GUN = /^[a-z]{2,16}:[a-z]{2,16}:[0-4](:[a-z_]{2,24})?$/;
const HEROES = new Set(['nuohooja', 'konemestari', 'ilmalaivuri', 'seppa']);

function periods(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  // ISO week of the local date.
  const local = new Date(Date.UTC(y, m - 1, d));
  const dow = local.getUTCDay() || 7;
  local.setUTCDate(local.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(local.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((local - yearStart) / 86400000 + 1) / 7);
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    week: `${local.getUTCFullYear()}-W${String(week).padStart(2, '0')}`,
    month: `${parts.year}-${parts.month}`,
    all: 'ALL',
  };
}

const INDEX = { day: 'byDay', week: 'byWeek', month: 'byMonth', all: 'byAll' };

const json = (status, body, maxAge = 30) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', 'cache-control': status === 200 ? `public, max-age=${maxAge}` : 'no-store' },
  body: JSON.stringify(body),
});

const histId = (period, value) => `hist#${period}#${value}`;
const scoreOf = (floor, time) => floor * 1e6 + (999999 - Math.min(999999, time));

/** {floor: runs} for one period value. */
async function hist(period, value) {
  const r = await db.send(new GetCommand({ TableName: TABLE, Key: { id: histId(period, value) } }));
  return counts(r.Item);
}

function counts(item) {
  const out = {};
  for (const [k, v] of Object.entries(item ?? {})) if (/^f\d+$/.test(k)) out[k.slice(1)] = v;
  return out;
}

/** 1 + the runs that reached a deeper floor. Equal floors share a rank. */
function rankIn(h, floor) {
  let above = 0;
  for (const [f, n] of Object.entries(h)) if (Number(f) > floor) above += n;
  return above + 1;
}

async function top(period, limit) {
  const p = periods()[period];
  const r = await db.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: INDEX[period],
      KeyConditionExpression: '#p = :p',
      ExpressionAttributeNames: { '#p': period },
      ExpressionAttributeValues: { ':p': p },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (r.Items ?? []).map((i) => ({ name: i.name, hero: i.hero, floor: i.floor, time: i.time, kills: i.kills, coins: i.coins, bosses: i.bosses, at: i.at, guns: i.guns }));
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method;
  const path = event.rawPath ?? '';
  try {
    if (method === 'GET' && path.endsWith('/board')) {
      const q = event.queryStringParameters ?? {};
      const period = INDEX[q.period] ? q.period : 'all';
      const value = periods()[period];
      const [list, h] = await Promise.all([top(period, 25), hist(period, value)]);
      return json(200, { period, value, updated: new Date().toISOString(), top: list, hist: h }, 60);
    }
    if (method === 'POST' && path.endsWith('/scores')) {
      let b;
      try {
        b = JSON.parse(event.body ?? '{}');
      } catch {
        return json(400, { error: 'bad json' });
      }
      const name = String(b.name ?? '').toUpperCase();
      const hero = String(b.hero ?? '');
      const floor = Math.floor(Number(b.floor));
      const time = Math.floor(Number(b.time));
      const kills = Math.floor(Number(b.kills));
      const coins = Math.floor(Number(b.coins ?? 0));
      const bosses = Math.floor(Number(b.bosses ?? 0));
      if (!NAME.test(name)) return json(400, { error: 'name' });
      if (!HEROES.has(hero)) return json(400, { error: 'hero' });
      // Impossible runs are refused; a cheat that stays inside these bounds
      // is a cheat we accept for a hobby table. The bounds are the bot's
      // runs with margin (make balance, 2026-10-03): the bot reaches floor
      // 20 in about nine minutes, a cleared floor never takes under ten
      // seconds, kills peak at two a second, coins at five a second, and a
      // boss falls every fifth floor. A run that ends on floor 1 cleared
      // nothing and stays off the table; the game does not ask for it.
      if (!(floor >= 2 && floor <= 200)) return json(400, { error: 'floor' });
      if (!(time >= 10 && time <= 4 * 3600) || time < 5 * (floor - 1)) return json(400, { error: 'time' });
      if (!(kills >= 0 && coins >= 0 && bosses >= 0)) return json(400, { error: 'stats' });
      if (kills > time * 6 || coins > time * 15 || bosses > Math.floor(floor / 5) + 1) return json(400, { error: 'stats' });
      // The build: up to six guns as type:maker:rarity[:legend]. Optional,
      // so a client without them still scores.
      const guns = Array.isArray(b.guns) ? b.guns.filter((g) => typeof g === 'string' && GUN.test(g)).slice(0, 6) : [];
      const now = new Date();
      const p = periods(now);
      const id = `${now.toISOString()}#${Math.random().toString(36).slice(2, 8)}`;
      await db.send(new PutCommand({ TableName: TABLE, Item: { id, name, hero, floor, time, kills, coins, bosses, score: scoreOf(floor, time), at: now.toISOString(), ...(guns.length ? { guns } : {}), ...p } }));
      const ranks = {};
      await Promise.all(
        Object.keys(p).map(async (k) => {
          const r = await db.send(
            new UpdateCommand({
              TableName: TABLE,
              Key: { id: histId(k, p[k]) },
              UpdateExpression: 'ADD #f :one',
              ExpressionAttributeNames: { '#f': `f${floor}` },
              ExpressionAttributeValues: { ':one': 1 },
              ReturnValues: 'ALL_NEW',
            }),
          );
          ranks[k] = rankIn(counts(r.Attributes), floor);
        }),
      );
      return json(200, { ok: true, ranks });
    }
    return json(404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    return json(500, { error: 'server' });
  }
};
