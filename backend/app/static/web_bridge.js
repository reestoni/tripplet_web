/* TrippleT web: replaces Qt's qwebchannel.js for the desktop Report page.
   The page does `new QWebChannel(qt.webChannelTransport, cb)` and then calls
   `_bridge.xxx(...)`; answers arrive as calls of the page's own receiveXxx(...)
   functions - exactly like the desktop (db/report_service.handle on the server). */
(function () {
  "use strict";
  var DB_SLOTS = ["getSeriesList", "loadSeriesData", "runVisualQuery", "loadReportList", "loadReport",
    "loadFreeField", "getLayoutTemplates", "getPdfTemplates", "saveReport", "deleteReport",
    "saveLayoutTemplate", "overwriteLayoutTemplate", "deleteLayoutTemplate"];

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

  // what the page expects from Qt
  window.qt = { webChannelTransport: null };
  window.QWebChannel = function (_transport, callback) {
    var self = this;
    self.objects = { bridge: bridge };
    setTimeout(function () { callback(self); }, 0);
  };
})();
