/* QuickChat — storage.js
 * Non-sensitive preferences only (theme). Messages and files are never stored here.
 * © 2026 [STAR RAMESH]. All rights reserved. */
(function (w, d) {
  "use strict";
  var KEY = "QuickChat.theme";
  w.GCStorage = {
    getTheme: function () {
      try {
        return localStorage.getItem(KEY) === "light" ? "light" : "dark";
      } catch (e) {
        return "dark";
      }
    },
    setTheme: function (t) {
      try {
        localStorage.setItem(KEY, t);
      } catch (e) {
        /* storage blocked: ignore */
      }
    },
  };
  // Runs in <head> before first paint, so there is no theme flash.
  d.documentElement.setAttribute("data-bs-theme", w.GCStorage.getTheme());
})(window, document);
