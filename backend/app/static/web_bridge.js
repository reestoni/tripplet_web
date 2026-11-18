/* TrippleT web: replaces Qt's qwebchannel.js for the desktop Report page.
   The page does `new QWebChannel(qt.webChannelTransport, cb)` and then calls
   `_bridge.xxx(...)`; answers arrive as calls of the page's own receiveXxx(...)
   functions - exactly like the desktop (db/report_service.handle on the server). */
(function () {
  "use strict";
  var DB_SLOTS = ["getSeriesList", "loadSeriesData", "runVisualQuery", "loadReportList", "loadReport",
    "loadFreeField", "getLayoutTemplates", "getPdfTemplates", "saveReport", "deleteReport",
    "saveLayoutTemplate", "overwriteLayoutTemplate", "deleteLayoutTemplate", "loadConclusions"];

  function post(url, body) {
    return fetch(url, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
  }

  function callSlot(name, args) {
    var pk = (typeof PRIMARY_PK !== "undefined") ? PRIMARY_PK : null;
    post("/api/report/slot/" + name, { args: args, series_pk: pk })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { console.error("report slot " + name + ":", res.j && res.j.detail); return; }
        var fn = res.j.receiver && window[res.j.receiver];
        if (typeof fn === "function") fn.apply(window, res.j.args || []);
      })
      .catch(function (e) { console.error("report slot " + name + " failed", e); });
  }

  var bridge = {};
  DB_SLOTS.forEach(function (name) {
    bridge[name] = function () { callSlot(name, Array.prototype.slice.call(arguments)); };
  });

  // Qt-only slots -> browser equivalents
  bridge.copyImageToClipboard = function (b64) {
    try {
      var bin = atob(b64), buf = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      var blob = new Blob([buf], { type: "image/png" });
      if (navigator.clipboard && window.ClipboardItem) {
        navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).catch(function (e) { console.error(e); });
      }
    } catch (e) { console.error("copyImageToClipboard", e); }
  };

  bridge.addImage = function (insertAfter, width) {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/bmp,image/gif,image/webp";
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var title = f.name.replace(/\.[^.]+$/, "");
        if (typeof receiveImage === "function") receiveImage(Number(insertAfter), reader.result, title, width);
      };
      reader.readAsDataURL(f);
    };
    input.click();
  };

  bridge.exportPdf = function (payloadJson) {
    post("/api/report/pdf", { payload: payloadJson })
      .then(function (r) {
        if (!r.ok) throw new Error("PDF failed (" + r.status + ")");
        var cd = r.headers.get("Content-Disposition") || "";
        var m = /filename="([^"]+)"/.exec(cd);
        var name = m ? m[1] : "report.pdf";
        return r.blob().then(function (b) { return { b: b, name: name }; });
      })
      .then(function (x) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(x.b);
        a.download = x.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
        if (typeof receivePdfResult === "function") receivePdfResult(true, x.name);
      })
      .catch(function (e) { if (typeof receivePdfResult === "function") receivePdfResult(false, String(e.message || e)); });
  };

  bridge.jsError = function (message) {
    console.error("JS ERROR", message);
    post("/api/report/js-error", { message: String(message) }).catch(function () {});
  };

  // body.m-small while the web app's WHOLE window is phone/tablet size (src/media.ts TABLET, 1024 px)
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

  // Phone / tablet (MOBILE.md, web only): the desktop page lays the visuals out 2 per row
  // (#grid style="grid-template-columns:1fr 1fr" set by its JS) - on a narrow screen one below the other.
  // Plotly charts follow the card width themselves (autosize); cards a bit lower so more fits.
  (function () {
    // phone/tablet = the WHOLE window is narrow (body.m-small, see small() below) - not this iframe's width:
    // on the PC the frame sits next to the sidebar and must keep the desktop layout
    var S = "body.m-small ";
    var css = "#m-fold { display: none; }" +
      S + "#grid { grid-template-columns: minmax(0, 1fr) !important; }" +
      S + "#grid > * { grid-column: auto !important; min-width: 0; }" +
      S + ".image-card.half-width { width: 100% !important; }" +
      S + ".chart-card { height: 460px; } " + S + ".chart-card.note-expanded { min-height: 460px; }" +
      S + "#charts-wrapper { padding: 8px !important; }" +
      S + "#global-toolbar { gap: 8px; padding: 6px 8px; }" +
      // the top part (toolbar + trial-series info card) folds away behind one slim bar ...
      S + "#m-fold { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: #fff;" +
      "   border-bottom: 1px solid #e0e0e0; flex-shrink: 0; font-size: 13px; }" +
      S + "#m-fold button { font: inherit; font-weight: 600; padding: 6px 12px; min-height: 36px; border: 1px solid #c8c8c8;" +
      "   border-radius: 6px; background: #fafafa; color: #333; cursor: pointer; }" +
      S + "#m-fold span { flex: 1; min-width: 0; color: #777; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }" +
      // ... and with it the settings rows of every chart card (type, X, Y, buttons): folded = only the charts
      " body.m-small:not(.m-top-open) #global-toolbar, body.m-small:not(.m-top-open) #infobox-slot," +
      " body.m-small:not(.m-top-open) .chart-toolbar, body.m-small:not(.m-top-open) .z-controls { display: none !important; }" +
      " body.m-small:not(.m-top-open) .chart-card { height: 380px; }";
    var add = function () {
      var st = document.createElement("style");
      st.textContent = css;
      document.head.appendChild(st);
      // bar above the toolbar; label in the user's language (localStorage of the web app, same origin)
      var lang = "en";
      try { lang = localStorage.getItem("tripplet.lang") || (navigator.language || "en").slice(0, 2); } catch (e) { /* blocked */ }
      var L = { en: ["Options", "Toolbar, series info, chart settings"], de: ["Optionen", "Werkzeuge, Serien-Info, Diagramm-Einstellungen"],
        es: ["Opciones", "Herramientas, info de la serie, ajustes"], zh: ["选项", "工具栏、系列信息、图表设置"] }[lang] || null;
      if (!L) L = ["Options", "Toolbar, series info, chart settings"];
      var bar = document.createElement("div");
      bar.id = "m-fold";
      var btn = document.createElement("button");
      var hint = document.createElement("span");
      hint.textContent = L[1];
      var paint = function () {
        var open = document.body.classList.contains("m-top-open");
        btn.textContent = L[0] + (open ? " ▴" : " ▾");
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        hint.style.visibility = open ? "hidden" : "visible";
      };
      btn.type = "button";
      btn.onclick = function () {
        document.body.classList.toggle("m-top-open");
        paint();
        // Plotly charts re-measure after the layout changed
        setTimeout(function () { window.dispatchEvent(new Event("resize")); }, 60);
      };
      bar.appendChild(btn);
      bar.appendChild(hint);
      document.body.insertBefore(bar, document.body.firstChild);
      paint();
      watchSmall(function () { setTimeout(function () { window.dispatchEvent(new Event("resize")); }, 60); });
    };
    // after the page's own <style> (it comes later in <head>), so these rules win
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
  })();

  // what the page expects from Qt
  window.qt = { webChannelTransport: null };
  window.QWebChannel = function (_transport, callback) {
    var self = this;
    self.objects = { bridge: bridge };
    setTimeout(function () { callback(self); }, 0);
  };
})();
