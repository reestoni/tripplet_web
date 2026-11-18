/* TrippleT web: replaces Qt's qwebchannel.js for the Smart Chart dashboard page (ui/smart_dashboard_html.py).
   The page does `new QWebChannel(qt.webChannelTransport, cb)` and calls `bridge.xxx(...)`.
   - calls the server answers (ui/smart_dashboard_core.DashboardSession) go to POST /api/smart/<sid>/call,
     one after the other; the answer's commands are page functions (init, renderResults, setSpec, …);
   - calls that open a dialog of the desktop (filters, calculated field, colour, fairness, Excel, open a trial)
     go to the React page around it (window.parent, postMessage);
   - collapsed / widened side panes are remembered in this browser (localStorage), the desktop uses QSettings.
   The React page sends commands back with postMessage({type: "smart-cmds", cmds}). */
(function () {
  "use strict";
  var SID = new URLSearchParams(location.search).get("sid") || "";
  var PANE_KEY = "tripplet.smart.panes", WIDTH_KEY = "tripplet.smart.paneWidths";

  function load(key) { try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch (e) { return {}; } }
  function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* private window */ } }

  function toParent(msg) { if (window.parent && window.parent !== window) window.parent.postMessage(msg, location.origin); }

  var MULTI_ARG = { focusRows: 1, modelFields: 1 };
  function run(cmds) {
    (cmds || []).forEach(function (c) {
      // a new init (calculated field, other data) keeps the panes as this browser remembers them
      if (c[0] === "init" && c[1] && !c[1].readonly) { c[1].panes = load(PANE_KEY); c[1].pane_widths = load(WIDTH_KEY); }
      var fn = window[c[0]];
      if (typeof fn !== "function") { console.error("smart page: no function " + c[0]); return; }
      try { fn.apply(window, MULTI_ARG[c[0]] ? c[1] : [c[1]]); } catch (e) { console.error("smart page " + c[0], e); }
    });
  }

  // one call after the other, so the answers arrive in order (updateSpec comes in bursts)
  var queue = Promise.resolve(), pendingSpec = null;
  function call(method, args) {
    queue = queue.then(function () {
      if (method === "updateSpec") {          // only the newest layout counts
        if (pendingSpec === null) return;
        args = [pendingSpec]; pendingSpec = null;
      }
      return fetch("/api/smart/" + encodeURIComponent(SID) + "/call", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: method, args: args })
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
      }).then(function (res) {
        if (!res.ok) {
          toParent({ type: "smart-error", status: res.status, detail: res.j && res.j.detail });
          return;
        }
        run(res.j.cmds);
        toParent({ type: "smart-summary", summary: res.j.summary });
        if (res.j.download) toParent({ type: "smart-download", url: res.j.download });
      }).catch(function (e) { console.error("smart call " + method, e); toParent({ type: "smart-error", detail: String(e) }); });
    });
  }

  var bridge = {
    ready: function () { call("ready", [load(PANE_KEY), load(WIDTH_KEY)]); toParent({ type: "smart-ready" }); },
    updateSpec: function (json) { pendingSpec = json; call("updateSpec", []); },
    visualClick: function (vid, click) { call("visualClick", [vid, click]); },
    clearCross: function (src) { call("clearCross", [src]); },
    visualSelect: function (vid, ids) { call("visualSelect", [vid, ids]); },
    drillThrough: function (vid, click, page) { call("drillThrough", [vid, click, page]); },
    drillBack: function (back) { call("drillBack", [!!back]); },
    modelFields: function (group) { call("modelFields", [group]); },
    focusRows: function (vid) { call("focusRows", [vid]); },
    removeFilter: function (scope, vid, i) { call("removeFilter", [scope, vid, i]); },
    setPlyScope: function (scope) { call("setPlyScope", [scope]); },
    setIncludeRefs: function (on) { call("setIncludeRefs", [!!on]); },
    imagesReady: function (json) { call("imagesReady", [json]); },
    // dialogs: the React page
    editFilter: function (scope, vid, i) { toParent({ type: "smart-filter", scope: scope, vid: vid, index: i }); },
    editCalc: function (key) { toParent({ type: "smart-calc", key: key }); },
    pickColour: function (vid, label, cur) { toParent({ type: "smart-colour", vid: vid, label: label, current: cur }); },
    fairDetails: function (vid) { toParent({ type: "smart-fair", vid: vid }); },
    exportVisual: function (vid) { toParent({ type: "smart-excel", vid: vid }); },
    openTrial: function (tid) { toParent({ type: "smart-trial", tid: tid }); },
    // remembered in this browser
    paneState: function (pane, collapsed) { var p = load(PANE_KEY); p[pane] = !!collapsed; store(PANE_KEY, p); },
    paneWidth: function (pane, w) { var p = load(WIDTH_KEY); if (w) p[pane] = w; else delete p[pane]; store(WIDTH_KEY, p); }
  };

  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === "smart-cmds") run(e.data.cmds);
  });

  // body.m-small while the web app's WHOLE window is phone/tablet size (src/media.ts TABLET, 1024 px) - on the PC
  // this frame sits next to the sidebar and the list and is narrow itself, it must keep the desktop layout there
  function watchSmall(cb) {
    var w = window;
    try { if (window.parent && window.parent !== window && window.parent.matchMedia) w = window.parent; } catch (e) { /* other origin */ }
    var m = w.matchMedia("(max-width: 1024px)");
    var last = null;
    var set = function () {
      var on = m.matches;
      if (on === last) return;
      last = on;
      document.body.classList.toggle("m-small", on);
      if (cb) cb();
    };
    set();
    if (m.addEventListener) m.addEventListener("change", set);
    w.addEventListener("resize", set);       // also on resize (some browsers/emulators skip the change event)
  }

  // Phone / tablet, read-only dashboards (MOBILE.md, web only; body.ro is set by the page itself):
  // nothing beside the dashboard - the visuals one below the other in full width (in reading order:
  // top-to-bottom, left-to-right of the desktop grid), the Filters pane behind a "Filters" button as a full sheet.
  (function () {
    var R = " body.m-small.ro ";      // read-only dashboard in a phone/tablet-size window (see watchSmall)
    var css = "#m-filters-btn { display: none; }" +
      "" + R + " #fpane { display: none !important; }" +
      "" + R.replace(".ro ", ".ro.m-filters ") + " #fpane { display: block !important; position: fixed; inset: 0; z-index: 80;" +
      "   width: auto !important; border: 0; padding: 52px 14px 14px; }" +
      "" + R + " #fpane .strip," + R + " #fpane .grip { display: none !important; }" +
      "" + R + " #m-filters-btn { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; font: inherit;" +
      "   font-weight: 600; padding: 6px 12px; min-height: 36px; border: 1px solid #C9D1C8; border-radius: 7px; background: #fff; cursor: pointer; }" +
      "" + R.replace(".ro ", ".ro.m-filters ") + " #m-filters-btn { position: fixed; top: 8px; right: 12px; z-index: 81; }" +
      "" + R + " #canvas { padding: 8px 8px 0; }" +
      "" + R + " #grid { height: auto !important; display: flex; flex-direction: column; gap: 10px; padding-bottom: 12px; }" +
      "" + R + " #grid > .card { position: relative !important; left: auto !important; top: auto !important;" +
      "   width: 100% !important; height: 340px !important; flex: none; }" +
      "" + R + " #grid > .card.textcard { height: auto !important; min-height: 48px; }" +
      // slicers and KPI tiles: as high as their content, charts keep the 340 px
      "" + R + " #grid > .card:has(> .body > .sl)," + R + " #grid > .card:has(> .body > .kpi) { height: auto !important; }" +
      "" + R + " #grid > .card:has(> .body > .kpi) { min-height: 110px; }";
    function label() {
      var lang = "en";
      try { lang = localStorage.getItem("tripplet.lang") || (navigator.language || "en").slice(0, 2); } catch (e) { /* blocked */ }
      return { en: ["Filters", "Close"], de: ["Filter", "Schliessen"], es: ["Filtros", "Cerrar"], zh: ["筛选", "关闭"] }[lang]
        || ["Filters", "Close"];
    }
    function order() {
      // stacked cards keep the reading order of the desktop grid (left/top stay in the inline style)
      var g = document.getElementById("grid");
      if (!g) return;
      Array.prototype.forEach.call(g.children, function (c) {
        var top = parseFloat(c.style.top) || 0, left = parseFloat(c.style.left) || 0;
        var o = String(Math.round(top) * 10000 + Math.round(left));
        if (c.style.order !== o) c.style.order = o;
      });
    }
    function setup() {
      var st = document.createElement("style");
      st.textContent = css;
      document.head.appendChild(st);
      var L = label();
      var btn = document.createElement("button");
      btn.id = "m-filters-btn";
      btn.type = "button";
      var paint = function () { btn.textContent = document.body.classList.contains("m-filters") ? "✕ " + L[1] : L[0] + " ▾"; };
      btn.onclick = function () {
        document.body.classList.toggle("m-filters");
        paint();
        if (!document.body.classList.contains("m-filters")) setTimeout(function () { window.dispatchEvent(new Event("resize")); }, 60);
      };
      paint();
      var bar = document.querySelector("#canvas .bar");
      (bar || document.body).appendChild(btn);
      var g = document.getElementById("grid");
      if (g && window.MutationObserver) {
        // new cards and moved cards (their own style); order() only writes when the value changes
        new MutationObserver(order).observe(g, { childList: true, attributes: true, subtree: true, attributeFilter: ["style"] });
      }
      order();
      watchSmall(function () { setTimeout(function () { window.dispatchEvent(new Event("resize")); }, 60); });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup); else setup();
  })();

  window.qt = { webChannelTransport: {} };
  window.QWebChannel = function (_transport, cb) { cb({ objects: { bridge: bridge } }); };
})();
