/* Sceggle — lightweight, dependency-free analytics.
 *
 * Sends events as GET beacons to a 1x1 pixel (t.gif); the data rides in
 * the query string and is captured by CloudFront access logs (see
 * infra/). No cookies, no backend, no PII — ever. Adapted from the
 * tienoo/clavesa/ecarbrowser tracker family:
 *   - view / displayed / click tiers on [data-track] elements
 *     (view ⊇ displayed ⊇ click), impression-deduped per session.
 *   - entity payloads: the closest [data-entity] JSON attribute is merged
 *     into element events (e.g. weapon identity on a loot card).
 *   - SPA-aware: a MutationObserver feeds newly rendered [data-track]
 *     elements to the impression observer (the HUD is React).
 *   - window.__sceggle.track(event, data) for app-level game events
 *     (area exit, death, pickup) — wire from src/events.ts.
 *
 * Sceggle divergence from the family: the game is served from GitHub
 * Pages while the pixel lives on our CloudFront, so the endpoint is an
 * absolute cross-origin URL set via TRACKER_CONFIG in index.html. Until
 * it's configured (and always on localhost) the tracker is dormant —
 * events are dropped, or logged to the console with debug: true.
 */
(function () {
  "use strict";

  var config = {
    endpoint: "",
    sessionTimeout: 30 * 60 * 1000, // 30 min sliding session
    maxStringLength: 200,
    debug: false
  };
  if (window.TRACKER_CONFIG) {
    for (var k in window.TRACKER_CONFIG) config[k] = window.TRACKER_CONFIG[k];
  }

  // Dormant without an endpoint; dev sessions stay out of the prod logs.
  var enabled = !!config.endpoint &&
    location.hostname !== "localhost" && location.hostname !== "127.0.0.1";

  var UID_KEY = "sc_uid";
  var SID_KEY = "sc_sid";
  var DISP_KEY = "sc_disp";
  var VIEW_KEY = "sc_view";

  function log() { if (config.debug) console.log.apply(console, ["[sc]"].concat([].slice.call(arguments))); }

  function uuid() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function trunc(s, n) {
    if (s == null) return "";
    s = String(s);
    return s.length > n ? s.slice(0, n) : s;
  }

  // Persistent visitor id (survives sessions).
  function getUserId() {
    try {
      var id = localStorage.getItem(UID_KEY);
      if (!id) { id = uuid(); localStorage.setItem(UID_KEY, id); }
      return id;
    } catch (e) {
      track("tracker_error", { src: "uid", msg: e.message });
      return "anon";
    }
  }

  // 30-minute sliding session id.
  function getSession() {
    var now = Date.now();
    try {
      var raw = sessionStorage.getItem(SID_KEY);
      var s = raw ? JSON.parse(raw) : null;
      if (!s || !s.id || now - s.ts > config.sessionTimeout) {
        s = { id: uuid(), ts: now, isNew: true };
      } else {
        s.isNew = false;
        s.ts = now;
      }
      sessionStorage.setItem(SID_KEY, JSON.stringify({ id: s.id, ts: s.ts }));
      return s;
    } catch (e) {
      return { id: uuid(), ts: now, isNew: true };
    }
  }

  function track(event, data) {
    try {
      var session = getSession();
      var params = new URLSearchParams();
      params.set("e", event);
      params.set("uid", getUserId());
      params.set("sid", session.id);
      params.set("p", location.pathname);
      params.set("t", String(Date.now()));
      if (data) for (var key in data) if (data[key] != null && data[key] !== "") params.set(key, trunc(data[key], config.maxStringLength));

      log("track", event, data || {});
      if (!enabled) return;

      var url = config.endpoint + "?" + params.toString();
      // sendBeacon flushes reliably even as the page navigates or
      // unloads. The pixel host only allows GET, so the POST beacon gets
      // a 403 — but CloudFront logs it with the query string intact,
      // which is all the pipeline reads. GET image is the fallback.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url);
      } else {
        var img = new Image();
        img.src = url;
      }
    } catch (e) {
      if (config.debug) console.warn("[sc] track failed", e);
    }
  }

  // Entity payload: nearest [data-entity] carries JSON identity for what
  // the element represents ({ty, id, n}).
  function getEntity(el) {
    try {
      var host = el && el.closest && el.closest("[data-entity]");
      if (!host) return null;
      return JSON.parse(host.dataset.entity);
    } catch (e) {
      return null;
    }
  }

  // Impression tiers, deduped per session. The dedupe key includes the
  // entity id so repeated elements sharing one sel each count.
  var viewed = {};
  var displayed = {};
  try {
    var storedViewed = sessionStorage.getItem(VIEW_KEY);
    if (storedViewed) JSON.parse(storedViewed).forEach(function (kk) { viewed[kk] = true; });
    var storedDisplayed = sessionStorage.getItem(DISP_KEY);
    if (storedDisplayed) JSON.parse(storedDisplayed).forEach(function (kk) { displayed[kk] = true; });
  } catch (e) {}

  function entityKey(sel, entity) {
    return sel + "|" + (entity && entity.id ? entity.id : "");
  }

  function withEntity(base, entity) {
    if (entity) {
      if (entity.ty) base.ty = entity.ty;
      if (entity.id) base.id = entity.id;
      if (entity.n) base.n = entity.n;
    }
    return base;
  }

  function markViewed(sel, entity) {
    var key = entityKey(sel, entity);
    if (!sel || viewed[key]) return;
    viewed[key] = true;
    track("view", withEntity({ sel: sel }, entity));
    try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(Object.keys(viewed))); } catch (e) {}
  }

  function markDisplayed(sel, entity) {
    var key = entityKey(sel, entity);
    if (!sel || displayed[key]) return;
    markViewed(sel, entity); // displayed implies view: view ⊇ displayed
    displayed[key] = true;
    track("displayed", withEntity({ sel: sel }, entity));
    try { sessionStorage.setItem(DISP_KEY, JSON.stringify(Object.keys(displayed))); } catch (e) {}
  }

  function init() {
    var session = getSession();

    if (session.isNew) {
      track("session_start", {
        ref: trunc(document.referrer, 100),
        vw: window.innerWidth,
        vh: window.innerHeight
      });
    }

    // Clicks — one delegated capture-phase listener; only [data-track]
    // elements are tracked, everything else (including the game canvas)
    // is a silent no-op.
    document.addEventListener("click", function (e) {
      try {
        var el = e.target;
        var tracked = el && el.closest && el.closest("[data-track]");
        if (!tracked) return;
        var sel = tracked.getAttribute("data-track");
        var entity = getEntity(tracked);
        // A click implies the element was seen — count it toward CTR's
        // denominator even if the impression observer hasn't fired yet.
        markDisplayed(sel, entity);
        track("click", withEntity({ sel: sel }, entity));
      } catch (err) {
        track("tracker_error", { src: "click_handler", msg: err.message });
      }
    }, true);

    // Impressions on [data-track] elements:
    //   view      — entered the viewport at all.
    //   displayed — >=50% visible for a continuous 3s ("really saw"),
    //               so CTR = clicks / displays per element.
    var io = null;
    if (window.IntersectionObserver) {
      try {
        io = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            var el = entry.target;
            var sel = el.getAttribute("data-track");
            var entity = getEntity(el);
            if (entry.isIntersecting) {
              markViewed(sel, entity);
            }
            if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
              if (el.__scDwell) return;
              el.__scDwell = setTimeout(function () {
                el.__scDwell = null;
                markDisplayed(sel, entity);
                io.unobserve(el);
              }, 3000);
            } else if (el.__scDwell) {
              clearTimeout(el.__scDwell);
              el.__scDwell = null;
            }
          });
        }, { threshold: [0, 0.5] });
      } catch (err) {
        track("tracker_error", { src: "impression_observer", msg: err.message });
      }
    }

    function observeTracked(root) {
      if (!io || !root.querySelectorAll) return;
      var els = root.querySelectorAll("[data-track]");
      for (var i = 0; i < els.length; i++) {
        if (!els[i].__scObserved) { els[i].__scObserved = true; io.observe(els[i]); }
      }
      if (root.getAttribute && root.getAttribute("data-track") && !root.__scObserved) {
        root.__scObserved = true;
        io.observe(root);
      }
    }
    observeTracked(document);

    // SPA: watch for tracked elements rendered after load (HUD panels,
    // loot cards) — the whole app mounts into #root after this runs.
    if (io && window.MutationObserver) {
      try {
        new MutationObserver(function (mutations) {
          mutations.forEach(function (m) {
            for (var i = 0; i < m.addedNodes.length; i++) {
              var node = m.addedNodes[i];
              if (node.nodeType === 1) observeTracked(node);
            }
          });
        }).observe(document.body, { childList: true, subtree: true });
      } catch (err) {
        track("tracker_error", { src: "mutation_observer", msg: err.message });
      }
    }

    // JS errors.
    window.addEventListener("error", function (e) {
      track("error", {
        msg: trunc(e.message, config.maxStringLength),
        file: trunc(e.filename, 50),
        line: e.lineno,
        type: "js"
      });
    });
    window.addEventListener("unhandledrejection", function (e) {
      var reason = e.reason && e.reason.message ? e.reason.message : e.reason;
      track("error", { msg: trunc(reason, config.maxStringLength), type: "promise" });
    });

    // End of visit.
    var started = Date.now();
    var ended = false;
    function endVisit() {
      if (ended) return;
      ended = true;
      track("session_end", { dur: Math.round((Date.now() - started) / 1000) });
    }
    window.addEventListener("pagehide", endVisit);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") endVisit();
    });
  }

  window.__sceggle = { track: track };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
