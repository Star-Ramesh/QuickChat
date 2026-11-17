/* QuickChat — ui.js  (Phase 2: UI-only interactions, no networking)
 * Theme toggle, music popup states, emoji insert, composer auto-grow, optional #ui-preview.
 * Room, chat, admin, file and music logic are wired in later phases.
 * © 2026 [STAR RAMESH]. All rights reserved. */
(function ($, w, d) {
  "use strict";
  var $d = $(d);

  // Theme
  $d.on("click", '[data-action="toggle-theme"]', function () {
    var next =
      d.documentElement.getAttribute("data-bs-theme") === "dark"
        ? "light"
        : "dark";
    d.documentElement.setAttribute("data-bs-theme", next);
    w.GCStorage.setTheme(next);
  });

  // Home: prefill modal usernames from the hero field
  $d.on("show.bs.modal", "#createModal, #joinModal", function () {
    var v = $("#heroUsername").val();
    $(this)
      .find(".js-username")
      .each(function () {
        if (!this.value) this.value = v;
      });
  });

  // Music popup: open / minimise (stays visible, per YouTube rules) / expand / close
  var $music = $("#musicPopup");
  $d.on("click", '[data-action="music-open"]', function () {
    $music.removeClass("d-none is-mini");
  });
  $d.on("click", '[data-action="music-mini"]', function () {
    $music.addClass("is-mini");
  });
  $d.on("click", '[data-action="music-expand"]', function () {
    $music.removeClass("is-mini");
  });
  $d.on("click", '[data-action="music-close"]', function () {
    $music.addClass("d-none");
  }); // Phase 8 also stops playback
  $d.on("click", '[data-action="toggle-results"]', function () {
    var $r = $("#musicResults"),
      show = $r.hasClass("d-none");
    $r.toggleClass("d-none", !show);
    $(this)
      .attr("aria-expanded", show)
      .text(show ? "Hide results" : "Show results");
  });

  // Composer: emoji insert + auto-grow
  var input = d.getElementById("composerInput");
  $d.on("click", ".emoji-btn", function () {
    if (!input) return;
    var s = input.selectionStart,
      e = input.selectionEnd,
      ch = this.getAttribute("data-emoji");
    input.value = input.value.slice(0, s) + ch + input.value.slice(e);
    input.selectionStart = input.selectionEnd = s + ch.length;
    input.focus();
  });
  $d.on("input", "#composerInput", function () {
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 140) + "px";
  });

  // Dev-only visual preview: open chat.html#ui-preview. Remove this block in Phase 6.
  function fill(id, data) {
    var n = d.getElementById(id).content.firstElementChild.cloneNode(true);
    $.each(data, function (k, v) {
      $(n)
        .find('[data-f="' + k + '"]')
        .text(v);
    });
    return n;
  }
  if (d.getElementById("messageList") && w.location.hash === "#ui-preview") {
    var members = [
      ["Asha", "Primary Admin"],
      ["Ravi", "Admin"],
      ["You", "Member"],
    ];
    members.forEach(function (m) {
      $("#memberList").append(
        fill("tpl-member", { avatar: m[0][0], name: m[0], role: m[1] }),
      );
    });
    $("#memberCount").text(3);
    $("#memberMax").text(5);
    $("#roomIdText").text("K7M2Q-9XT4A");
    $("#roomTimer").text("00:12:48");
    $("#emptyState").addClass("d-none");
    var list = $("#messageList");
    list.append(
      fill("tpl-message", {
        author: "Asha",
        time: "10:41",
        text: "Room is live. Share the link and we can start.",
      }),
    );
    var own = fill("tpl-message", {
      author: "You",
      time: "10:42",
      text: "Joined. Sending the schedule now.",
    });
    own.classList.add("msg-own");
    list.append(own);
    var rep = fill("tpl-message", {
      author: "Ravi",
      time: "10:43",
      text: "Got it, thanks.",
    });
    $(rep)
      .find(".msg-reply")
      .removeClass("d-none")
      .text("You: Joined. Sending the schedule now.");
    list.append(rep);
    var f = fill("tpl-file", {
      name: "schedule.pdf",
      size: "2.4 MB",
      status: "Receiving 62%",
    });
    $(f).find("progress").val(62);
    list.append(f);
  }
})(jQuery, window, document);
