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

  window.qt = { webChannelTransport: {} };
  window.QWebChannel = function (_transport, cb) { cb({ objects: { bridge: bridge } }); };
})();
