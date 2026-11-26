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

  // Jet drawing on hover over a legend entry (Nutzerwunsch 2026-11-26, web only): pictures / PDF first page stored with the
  // jet in Manage Jets (app/jet_drawing.py). Box stays while the mouse is on the entry or the box; < > pages; Ctrl+click on
  // the entry opens the drawing large in a new tab (instead of hiding the trace). Not a jet (other legends) = no box.
  (function () {
    var lang = "en";
    try { lang = localStorage.getItem("tripplet.lang") || (navigator.language || "en").slice(0, 2); } catch (e) { /* blocked */ }
    var T = { en: { none: "No drawing stored with this jet", load: "Loading…", tip: "Ctrl+click: open large", prev: "Previous", next: "Next" },
      de: { none: "Keine Zeichnung bei dieser Düse hinterlegt", load: "Lädt…", tip: "Strg+Klick: gross öffnen", prev: "Zurück", next: "Weiter" },
      es: { none: "No hay dibujo guardado para esta boquilla", load: "Cargando…", tip: "Ctrl+clic: abrir en grande", prev: "Anterior", next: "Siguiente" },
      zh: { none: "此喷嘴未存储图纸", load: "加载中…", tip: "Ctrl+单击：大图打开", prev: "上一张", next: "下一张" } }[lang] || null;
    if (!T) T = { none: "No drawing stored with this jet", load: "Loading…", tip: "Ctrl+click: open large", prev: "Previous", next: "Next" };
    var cache = {}, box = null, cur = null, idx = 0, showT = null, hideT = null, onEntry = null;

    function jetName(label) {
      var n = String(label || "").replace(/\s*\[[^\]]*\]\s*$/, "").trim();   // "LB-04 [series]" (several series)
      return n;
    }
    function fetchJet(name) {
      if (cache[name]) return cache[name];
      var q = fetch("/api/jet-drawings?name=" + encodeURIComponent(name), { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && !j.jet_id && name.indexOf("::") > 0) return fetchJet(name.split("::")[0]);   // "jet::plate" keys
          return j;
        }).catch(function () { return null; });
      cache[name] = q;
      return q;
    }
    function ensureBox() {
      if (box) return box;
      var st = document.createElement("style");
      st.textContent = "#jd-box{position:fixed;z-index:99999;background:#fff;border:1px solid #c8c8c8;border-radius:8px;" +
        "box-shadow:0 6px 24px rgba(0,0,0,.18);padding:8px;font:12px/1.35 system-ui,sans-serif;color:#333;max-width:440px}" +
        "#jd-box img{display:block;max-width:420px;max-height:340px;margin-top:6px;background:#fff}" +
        "#jd-box .jd-head{display:flex;align-items:center;gap:6px}#jd-box .jd-head b{flex:1}" +
        "#jd-box button{border:1px solid #c8c8c8;background:#fafafa;border-radius:4px;cursor:pointer;padding:1px 7px;font:inherit}" +
        "#jd-box .jd-muted{color:#777}";
      document.head.appendChild(st);
      box = document.createElement("div");
      box.id = "jd-box";
      box.style.display = "none";
      box.addEventListener("mouseenter", function () { clearTimeout(hideT); });
      box.addEventListener("mouseleave", hideSoon);
      document.body.appendChild(box);
      return box;
    }
    function paint() {
      var b = ensureBox(), j = cur && cur.data;
      b.innerHTML = "";
      var head = document.createElement("div");
      head.className = "jd-head";
      var t = document.createElement("b");
      t.textContent = (j && j.name) || (cur && cur.name) || "";
      head.appendChild(t);
      if (j && j.files.length > 1) {
        var pv = document.createElement("button"), nx = document.createElement("button"), n = document.createElement("span");
        pv.textContent = "◀"; pv.title = T.prev; pv.setAttribute("aria-label", T.prev);
        nx.textContent = "▶"; nx.title = T.next; nx.setAttribute("aria-label", T.next);
        n.className = "jd-muted"; n.textContent = (idx + 1) + "/" + j.files.length;
        pv.onclick = function () { idx = (idx + j.files.length - 1) % j.files.length; paint(); };
        nx.onclick = function () { idx = (idx + 1) % j.files.length; paint(); };
        head.appendChild(pv); head.appendChild(n); head.appendChild(nx);
      }
      b.appendChild(head);
      if (!j) { var l = document.createElement("div"); l.className = "jd-muted"; l.textContent = T.load; b.appendChild(l); return; }
      if (!j.files.length) { var e = document.createElement("div"); e.className = "jd-muted"; e.textContent = T.none; b.appendChild(e); return; }
      var f = j.files[idx], cap = document.createElement("div"), img = document.createElement("img");
      cap.className = "jd-muted"; cap.textContent = f.name + " · " + T.tip;
      img.alt = f.name;
      img.src = "/api/jet-drawings/file/" + f.id;
      img.onload = function () { place(); };
      b.appendChild(cap); b.appendChild(img);
    }
    function place() {
      if (!box || !cur) return;
      var w = box.offsetWidth, h = box.offsetHeight, x = cur.x + 16, y = cur.y + 16;
      if (x + w > window.innerWidth - 8) x = Math.max(8, cur.x - w - 16);
      if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
      box.style.left = x + "px"; box.style.top = y + "px";
    }
    function hideSoon() {
      clearTimeout(showT); clearTimeout(hideT);
      hideT = setTimeout(function () { if (box) box.style.display = "none"; cur = null; onEntry = null; }, 250);
    }
    function entryOf(target) {
      var g = target && target.closest ? target.closest("g.legend g.traces") : null;
      if (!g) return null;
      var tx = g.querySelector("text.legendtext");
      return tx ? { g: g, name: jetName(tx.textContent) } : null;
    }
    document.addEventListener("mouseover", function (ev) {
      if (document.body.classList.contains("m-small")) return;          // touch screens: no hover
      var e = entryOf(ev.target);
      if (!e) { if (onEntry && !(box && box.contains(ev.target))) { onEntry = null; hideSoon(); } return; }
      clearTimeout(hideT);
      if (onEntry === e.g) return;
      onEntry = e.g;
      var x = ev.clientX, y = ev.clientY;
      clearTimeout(showT);
      showT = setTimeout(function () {
        if (!e.name) return;
        fetchJet(e.name).then(function (j) {
          if (onEntry !== e.g || !j || !j.jet_id) return;                // not a jet: nothing
          cur = { name: e.name, x: x, y: y, data: j }; idx = 0;
          ensureBox().style.display = "block";
          paint(); place();
        });
      }, 300);
    }, true);
    document.addEventListener("mousedown", function (ev) {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      var e = entryOf(ev.target);
      if (!e || !e.name) return;
      ev.preventDefault(); ev.stopPropagation();                           // keep the trace visible
      var win = window.open("", "_blank");                                 // opened now (pop-up blockers), filled below
      fetchJet(e.name).then(function (j) {
        if (!win) return;
        if (j && j.files && j.files.length) win.location.href = "/api/jet-drawings/file/" + j.files[(cur && cur.data === j) ? idx : 0].id;
        else win.close();
      });
    }, true);
  })();

  // what the page expects from Qt
  window.qt = { webChannelTransport: null };
  window.QWebChannel = function (_transport, callback) {
    var self = this;
    self.objects = { bridge: bridge };
    setTimeout(function () { callback(self); }, 0);
  };
})();
