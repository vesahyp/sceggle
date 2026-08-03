# Analytics tracking

Sceggle uses the tienoo/clavesa/ecarbrowser family tracker: a self-hosted
script (`public/tracker.js`) sends events as beacons to a 1x1 GIF
(`t.gif`), the data rides in the query string, and CloudFront access logs
are the datastore. No cookies, no backend, no PII, $0 to run. The full
event/parameter reference lives in `../tienoo/TRACKING.md` and
`../ecarbrowser/TRACKING.md`; this file covers only what sceggle does
differently.

## Split hosting (temporary)

The game deploys to **GitHub Pages** (`.github/workflows/deploy.yml`), but
GitHub Pages exposes no request logs — so the pixel is served from **our
own CloudFront** (Terraform under `infra/`, mirroring tienoo's stack minus
the domain/ACM/Route53 parts). The tracker endpoint is therefore an
absolute cross-origin URL, set via `TRACKER_CONFIG` in `index.html`:

```html
<script>
  window.TRACKER_CONFIG = { endpoint: "https://<dist>.cloudfront.net/t.gif" };
</script>
```

With an empty endpoint (or on localhost) the tracker is dormant — events
are dropped, or logged to the console with `debug: true`. This keeps dev
sessions out of the production logs.

When sceggle gets a real domain, the same distribution becomes the site
host (add cert + aliases from tienoo's `infra/`), the game deploys there
instead of Pages, and the endpoint flips back to the family's relative
`/t.gif`.

## Standing it up

```sh
make plan          # terraform plan (infra/tfplan)
make apply         # create S3 buckets + CloudFront; prints pixel_url
# bake pixel_url into index.html's TRACKER_CONFIG
make deploy-pixel  # upload public/t.gif with no-store
git push           # Pages workflow ships tracker.js + config
```

Beacons are sent with `navigator.sendBeacon` (POST). The distribution
only allows GET/HEAD, so beacons answer 403 — deliberately fine: CloudFront
logs every request with its query string regardless of status, and the
pipeline reads only the query string. Same trick the sibling sites use.

## Game events

`window.__sceggle.track(event, data)` is the app-level hook. Wire
gameplay events (area exit, player death, weapon pickup) from
`src/events.ts` — the sim → React bridge already sees all of them. Not
wired yet.

Logs land in `s3://sceggle-cloudfront-logs/cloudfront/` (90-day
lifecycle). No aggregation pipeline yet — copy tienoo's
`analytics/aggregate.mjs` pattern when there's traffic worth rolling up.
