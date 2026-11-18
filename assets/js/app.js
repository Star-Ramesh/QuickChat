/* QuickChat app.js | Rooms, chat, RAM-only media sharing, and synced YouTube music over PeerJS.
 * Host-coordinated star topology (QuickChat1-<roomkey>); guests connect only to the host.
 * Designed & Developed by [STAR RAMESH]. © 2026 [STAR RAMESH]. All rights reserved. */
(function ($, w, d) {
  "use strict";
  var PREFIX = "quickchat1-",
    ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789",
    CHUNK = 32768,
    MAX_FILE = 50 * 1024 * 1024;
  var PIPED = [
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.adminforge.de",
    "https://api.piped.private.coffee",
  ];
  var INVID = ["https://inv.nadeko.net", "https://invidious.nerdvpn.de"];
  var S,
    ctx,
    tt,
    lastType = 0,
    ytReady = false,
    ytWait = [],
    ytPlayer = null;

  function fresh() {
    return {
      peer: null,
      conn: null,
      role: "",
      room: "",
      me: null,
      max: 0,
      pass: "",
      guests: [],
      conns: {},
      list: [],
      seen: {},
      createdAt: 0,
      offset: 0,
      timer: 0,
      entered: false,
      reply: null,
      aborted: false,
      urls: [],
      incoming: {},
      music: {
        all: false,
        playing: false,
        vid: "",
        title: "",
        startedAt: 0,
        picked: null,
        history: [],
        results: [],
      },
    };
  }
  S = fresh();

  // ---------- helpers ----------
  function rid(n) {
    var s = "",
      b;
    while (s.length < n) {
      b = w.crypto.getRandomValues(new Uint8Array(1))[0];
      if (b < 248) s += ALPHA[b % 31];
    }
    return s;
  }
  function normRoom(s) {
    return String(s || "")
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }
  function peerKey(r) {
    return String(r || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }
  // Canonical PeerJS id for a given room, used identically by host and guest.
  function peerIdFor(r) {
    return PREFIX + peerKey(r);
  }
  function fmt(r) {
    return r.length === 10 && r.indexOf("-") === -1
      ? r.slice(0, 5) + "-" + r.slice(5)
      : r;
  }
  function clean(s) {
    return String(s || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 24);
  }
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function fmtBytes(n) {
    return n < 1024
      ? n + " B"
      : n < 1048576
        ? (n / 1024).toFixed(1) + " KB"
        : (n / 1048576).toFixed(1) + " MB";
  }
  function send(c, o) {
    try {
      c.send(o);
    } catch (e) {
      /* connection closing */
    }
  }
  function bcast(o, skip) {
    $.each(S.conns, function (id, c) {
      if (id !== skip) send(c, o);
    });
  }
  function toast(t) {
    var $t = $('<div class="toast">').text(t).appendTo("#toasts");
    setTimeout(function () {
      $t.remove();
    }, 4500);
  }
  function show(v) {
    $(".view").prop("hidden", true);
    $("#" + v).prop("hidden", false);
  }
  function busy(b) {
    $("dialog button[type=submit]").prop("disabled", b);
  }
  function copy(t) {
    (navigator.clipboard
      ? navigator.clipboard.writeText(t)
      : Promise.reject()
    ).then(
      function () {
        toast("Copied");
      },
      function () {
        toast(t);
      },
    );
  }
  function beep() {
    try {
      ctx = ctx || new (w.AudioContext || w.webkitAudioContext)();
      var o = ctx.createOscillator(),
        g = ctx.createGain();
      o.frequency.value = 660;
      g.gain.value = 0.05;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.12);
    } catch (e) {
      /* audio blocked */
    }
  }
  function tick() {
    var s = Math.max(
      0,
      Math.floor((Date.now() + S.offset - S.createdAt) / 1000),
    );
    $("#timer").text(
      pad(Math.floor(s / 3600)) +
        ":" +
        pad(Math.floor(s / 60) % 60) +
        ":" +
        pad(s % 60),
    );
  }
  function typing(n) {
    clearTimeout(tt);
    $("#typing").text(n ? n + " is typing…" : "");
    if (n)
      tt = setTimeout(function () {
        $("#typing").text("");
      }, 3000);
  }
  function canMusic() {
    return S.role === "host" || S.music.all;
  }
  // Shared confirmation text so every exit path stays consistent.
  function confirmLeave() {
    var msg =
      S.role === "host"
        ? "Close the room for everyone? All messages and media are cleared."
        : "Leave this room? Once you leave, you cannot see previous messages in the room.";
    return w.confirm(msg);
  }

  // ---------- rendering (user text is only ever set with .text()) ----------
  function pin() {
    $("#empty").hide();
    var m = d.getElementById("msgwrap");
    m.scrollTop = m.scrollHeight;
  }
  function sys(t) {
    $('<li class="sys">').text(t).appendTo("#messages");
    pin();
  }
  function addMsg(m) {
    var own = m.from === S.me.id,
      $b = $('<div class="bub">');
    $('<div class="mh">')
      .append(
        $("<b>").text(own ? "You" : m.name),
        $("<time>").text(
          new Date(m.ts).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        ),
      )
      .appendTo($b);
    if (m.re) $("<blockquote>").text(m.re).appendTo($b);
    $("<p>").text(m.text).appendTo($b);
    $('<div class="acts">')
      .append(
        $('<button type="button" data-a="reply">').text("Reply"),
        $('<button type="button" data-a="copy">').text("Copy"),
      )
      .appendTo($b);
    $('<li class="msg">')
      .toggleClass("own", own)
      .data({ n: String(m.name), t: String(m.text) })
      .append($b)
      .appendTo("#messages");
    pin();
    if (!own) {
      beep();
      typing(null);
    }
  }
  function createMediaCard(id, fromName, own, name, size, ts) {
    var $b = $('<div class="bub media-card">');
    $('<div class="mh">')
      .append(
        $("<b>").text(own ? "You" : fromName),
        $("<time>").text(
          new Date(ts || Date.now()).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        ),
      )
      .appendTo($b);
    $('<div class="media-head">')
      .append(
        $('<span class="media-name">').text(name),
        $('<span class="media-size">').text(fmtBytes(size)),
      )
      .appendTo($b);
    $('<div class="media-prev" hidden>').appendTo($b);
    $('<progress class="media-prog" max="100" value="0">').appendTo($b);
    $('<div class="media-foot">')
      .append(
        $('<span class="media-st">').text(own ? "Sending…" : "Receiving…"),
      )
      .appendTo($b);
    $('<li class="msg" id="f-' + id + '">')
      .toggleClass("own", own)
      .append($b)
      .appendTo("#messages");
    pin();
    return $("#f-" + id);
  }
  function finishMediaCard($li, blob, name, mime, own) {
    var url = URL.createObjectURL(blob);
    S.urls.push(url);
    $li.find(".media-prog").remove();
    var $prev = $li.find(".media-prev").prop("hidden", false);
    if (mime.indexOf("image/") === 0)
      $("<img>").attr({ src: url, alt: name }).appendTo($prev);
    else if (mime.indexOf("video/") === 0)
      $('<video controls playsinline preload="metadata">')
        .attr("src", url)
        .appendTo($prev);
    var $foot = $li.find(".media-foot").empty();
    $foot.append(
      $("<span>").text(own ? "Sent" : "Ready"),
      $('<a class="btn sm pri media-save">')
        .attr({ href: url, download: name })
        .text("Save"),
    );
    pin();
  }
  function renderRoster() {
    var $u = $("#roster").empty(),
      host = S.role === "host";
    $.each(S.list, function (i, m) {
      var nm = String(m.name),
        $l = $("<li>").append(
          $('<span class="av">').text(Array.from(nm)[0] || "?"),
          $('<span class="nm">').text(nm + (m.id === S.me.id ? " (you)" : "")),
          $("<small>").text(m.host ? "Host" : ""),
        );
      if (host && !m.host)
        $l.append(
          $('<button type="button" class="x" aria-label="Remove member">')
            .attr("data-id", m.id)
            .text("✕"),
        );
      $l.appendTo($u);
    });
    $("#count").text(S.list.length + "/" + S.max);
  }
  function clearReply() {
    S.reply = null;
    $("#replybar").prop("hidden", true);
  }

  // ---------- media sharing (RAM only) ----------
  function toBuf(d) {
    if (d instanceof ArrayBuffer) return d;
    if (ArrayBuffer.isView(d))
      return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
    return null;
  }
  function waitBackpressure() {
    var wait = false;
    if (S.role === "host")
      $.each(S.conns, function (id, c) {
        if (c.dataChannel && c.dataChannel.bufferedAmount > 524288) wait = true;
      });
    else if (
      S.conn &&
      S.conn.dataChannel &&
      S.conn.dataChannel.bufferedAmount > 524288
    )
      wait = true;
    return wait
      ? new Promise(function (r) {
          setTimeout(r, 30);
        })
      : Promise.resolve();
  }
  function sendPacket(o) {
    if (S.role === "host") bcast(o);
    else send(S.conn, o);
  }
  function sendFiles(files) {
    $.each(files, function (idx, file) {
      if (
        !file ||
        (file.type.indexOf("image/") !== 0 && file.type.indexOf("video/") !== 0)
      ) {
        toast("Only images and videos are supported.");
        return;
      }
      if (file.size > MAX_FILE) {
        toast(file.name + " is too large (max " + fmtBytes(MAX_FILE) + ").");
        return;
      }
      var id = rid(12),
        total = Math.max(1, Math.ceil(file.size / CHUNK)),
        st = S;
      var $li = createMediaCard(
        id,
        S.me.name,
        true,
        file.name,
        file.size,
        Date.now(),
      );
      sendPacket({
        t: "fstart",
        id: id,
        from: S.me.id,
        name: S.me.name,
        fname: file.name,
        mime: file.type,
        size: file.size,
        total: total,
      });
      (function pump(i) {
        if (S !== st || st.aborted) return;
        if (i >= total) {
          sendPacket({ t: "fend", id: id });
          finishMediaCard($li, file, file.name, file.type, true);
          return;
        }
        waitBackpressure().then(function () {
          if (S !== st || st.aborted) return;
          file
            .slice(i * CHUNK, (i + 1) * CHUNK)
            .arrayBuffer()
            .then(function (buf) {
              if (S !== st || st.aborted) return;
              sendPacket({ t: "fchunk", id: id, i: i, buf: buf });
              $li.find(".media-prog").val(Math.round(((i + 1) / total) * 100));
              pump(i + 1);
            });
        });
      })(0);
    });
  }
  function onFileMsg(m, fromGuest) {
    if (m.t === "fstart") {
      if (
        typeof m.id !== "string" ||
        !m.total ||
        m.size > MAX_FILE ||
        S.incoming[m.id]
      )
        return;
      var senderId = fromGuest ? fromGuest.id : m.from,
        senderName = fromGuest ? fromGuest.name : String(m.name || "Member");
      var $li = createMediaCard(
        m.id,
        senderName,
        false,
        String(m.fname || "file"),
        Number(m.size) || 0,
        Date.now(),
      );
      S.incoming[m.id] = {
        fname: String(m.fname || "file"),
        mime: String(m.mime || "application/octet-stream"),
        total: Number(m.total),
        got: 0,
        parts: new Array(Number(m.total)),
        $li: $li,
      };
      if (fromGuest)
        bcast(
          {
            t: "fstart",
            id: m.id,
            from: senderId,
            name: senderName,
            fname: m.fname,
            mime: m.mime,
            size: m.size,
            total: m.total,
          },
          fromGuest.id,
        );
    } else if (m.t === "fchunk") {
      var rec = S.incoming[m.id],
        buf = toBuf(m.buf);
      if (
        !rec ||
        !buf ||
        typeof m.i !== "number" ||
        m.i < 0 ||
        m.i >= rec.total
      )
        return;
      if (!rec.parts[m.i]) {
        rec.parts[m.i] = buf;
        rec.got++;
      }
      rec.$li.find(".media-prog").val(Math.round((rec.got / rec.total) * 100));
      if (fromGuest)
        bcast({ t: "fchunk", id: m.id, i: m.i, buf: buf }, fromGuest.id);
    } else if (m.t === "fend") {
      var rec2 = S.incoming[m.id];
      if (!rec2) return;
      if (fromGuest) bcast({ t: "fend", id: m.id }, fromGuest.id);
      var blob = new Blob(rec2.parts.filter(Boolean), { type: rec2.mime });
      var $card = rec2.$li,
        fn = rec2.fname,
        mm = rec2.mime;
      delete S.incoming[m.id];
      finishMediaCard($card, blob, fn, mm, false);
      beep();
    }
  }

  // ---------- YouTube music (free search + direct YouTube iframe with strict referrer) ----------
  function extractYtId(s) {
    var m =
      /(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/.exec(
        s || "",
      );
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{11}$/.test(String(s || "").trim())
      ? String(s).trim()
      : "";
  }
  function loadYT(cb) {
    if (ytReady && w.YT && w.YT.Player) return cb();
    ytWait.push(cb);
    if (d.getElementById("ytApiScript")) return;
    w.onYouTubeIframeAPIReady = function () {
      ytReady = true;
      while (ytWait.length) ytWait.shift()();
    };
    var s = d.createElement("script");
    s.id = "ytApiScript";
    s.src = "https://www.youtube.com/iframe_api";
    d.head.appendChild(s);
  }
  function ensurePlayer(vid, cb) {
    loadYT(function () {
      if (ytPlayer && ytPlayer.loadVideoById) return cb(ytPlayer, false);
      var box = d.getElementById("ytBox");
      if (box && !d.getElementById("ytIframe")) {
        var fr = d.createElement("iframe");
        fr.id = "ytIframe";
        fr.width = "200";
        fr.height = "200";
        fr.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
        fr.setAttribute("allow", "autoplay; encrypted-media");
        var orig =
          w.location.protocol.indexOf("http") === 0
            ? "&origin=" + encodeURIComponent(w.location.origin)
            : "";
        fr.src =
          "https://www.youtube.com/embed/" +
          encodeURIComponent(vid) +
          "?enablejsapi=1&autoplay=1&controls=0&rel=0&playsinline=1" +
          orig;
        box.innerHTML = "";
        box.appendChild(fr);
      }
      ytPlayer = new w.YT.Player("ytIframe", {
        events: {
          onReady: function () {
            cb(ytPlayer, true);
          },
          onStateChange: function (e) {
            if (e.data === 1 && S.music.playing)
              $("#mNow").text("Playing: " + S.music.title);
            else if (e.data === 3 && S.music.playing)
              $("#mNow").text("Buffering: " + S.music.title);
            if (e.data === 0 && S.role === "host" && S.music.playing)
              playSimilar(S.music.vid);
          },
          onError: function (e) {
            var msg = "YouTube error " + e.data;
            $("#mNow").text(msg);
            toast(msg);
            if (e.data !== 153 && S.role === "host" && S.music.playing) {
              var alt = S.music.results.filter(function (r) {
                return S.music.history.indexOf(r.id) === -1;
              })[0];
              if (alt)
                hostMusic({ act: "play", vid: alt.id, title: alt.title });
              else playSimilar(S.music.vid);
            }
          },
        },
      });
    });
  }
  function stopAudio() {
    try {
      if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
    } catch (e) {}
  }
  function updateMusicUI() {
    var allowed = canMusic(),
      on = S.music.playing;
    $("#mQuery,#mSearchBtn,#mPlay,#mStop").prop("disabled", !allowed);
    $("#mAll").prop("checked", S.music.all);
    $("#mNow").text(
      on
        ? (ytPlayer &&
          ytPlayer.getPlayerState &&
          ytPlayer.getPlayerState() === 1
            ? "Playing: "
            : "Loading: ") + S.music.title
        : "Nothing playing",
    );
    $("#bMusic").toggleClass("pri", on);
  }
  function applyMusic(m) {
    if (m.act === "perm") {
      S.music.all = !!m.all;
      updateMusicUI();
      loadYT(function () {});
      toast(
        S.music.all
          ? "Everyone can control music now."
          : "Only host can control music.",
      );
      return;
    }
    if (m.act === "stop") {
      S.music.playing = false;
      S.music.vid = "";
      S.music.title = "";
      S.music.startedAt = 0;
      stopAudio();
      updateMusicUI();
      return;
    }
    if (m.act === "play" && m.vid) {
      S.music.playing = true;
      S.music.vid = m.vid;
      S.music.title = String(m.title || "YouTube Track");
      S.music.startedAt = m.startedAt || Date.now();
      if (S.music.history.indexOf(m.vid) === -1) S.music.history.push(m.vid);
      updateMusicUI();
      $("#mNow").text("Loading: " + S.music.title);
      var seek = Math.max(
        0,
        Math.floor((Date.now() + S.offset - S.music.startedAt) / 1000),
      );
      ensurePlayer(m.vid, function (p, isNew) {
        if (!isNew) p.loadVideoById({ videoId: m.vid, startSeconds: seek });
        else if (seek > 1 && p.seekTo) {
          try {
            p.seekTo(seek, true);
          } catch (e) {}
        }
        try {
          p.unMute();
          p.setVolume(100);
          p.playVideo();
        } catch (e) {}
        setTimeout(function () {
          try {
            if (!S.music.playing || S.music.vid !== m.vid) return;
            var st = p.getPlayerState ? p.getPlayerState() : -1;
            if (
              st !== 1 &&
              st !== 3 &&
              $("#mNow").text().indexOf("YouTube error") === -1
            ) {
              $("#mNow").text("Click Play again to start audio");
            }
          } catch (e) {}
        }, 2000);
      });
    }
  }
  function hostMusic(m, fromName) {
    if (m.act === "perm") {
      if (fromName) return;
      S.music.all = !!m.all;
      bcast({ t: "music", act: "perm", all: S.music.all });
      applyMusic(m);
      return;
    }
    if (fromName && !S.music.all) return;
    if (m.act === "stop") {
      var o = { t: "music", act: "stop" };
      bcast(o);
      applyMusic(o);
      announce((fromName || S.me.name) + " stopped music");
    } else if (m.act === "play" && m.vid) {
      var p = {
        t: "music",
        act: "play",
        vid: m.vid,
        title: String(m.title || "YouTube Track").slice(0, 120),
        startedAt: Date.now(),
      };
      bcast(p);
      applyMusic(p);
      announce((fromName || S.me.name) + " played: " + p.title);
    }
  }
  function fetchJson(url, ms) {
    var ac = new AbortController(),
      t = setTimeout(function () {
        ac.abort();
      }, ms || 4500);
    return fetch(url, { signal: ac.signal }).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }
  function tryList(urls, idx) {
    if (idx >= urls.length)
      return Promise.reject(new Error("All search servers busy"));
    return fetchJson(urls[idx].u).then(
      function (data) {
        return urls[idx].map(data);
      },
      function () {
        return tryList(urls, idx + 1);
      },
    );
  }
  function searchMusic(q) {
    var direct = extractYtId(q);
    if (direct) {
      S.music.picked = { id: direct, title: "YouTube Video (" + direct + ")" };
      $("#mStat").text("YouTube link ready — click Play.");
      $("#mRes").empty();
      return;
    }
    $("#mStat").text("Searching…");
    $("#mRes").empty();
    var enc = encodeURIComponent(q),
      attempts = [];
    PIPED.forEach(function (h) {
      attempts.push({
        u: h + "/search?q=" + enc + "&filter=videos",
        map: function (d) {
          return (d.items || [])
            .filter(function (x) {
              return x.url && x.url.indexOf("v=") > -1;
            })
            .slice(0, 8)
            .map(function (x) {
              var id = x.url.split("v=")[1].slice(0, 11);
              return {
                id: id,
                title: x.title,
                ch: x.uploaderName || "",
                img: "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg",
              };
            });
        },
      });
    });
    INVID.forEach(function (h) {
      attempts.push({
        u: h + "/api/v1/search?q=" + enc + "&type=video",
        map: function (d) {
          return (Array.isArray(d) ? d : []).slice(0, 8).map(function (x) {
            return {
              id: x.videoId,
              title: x.title,
              ch: x.author || "",
              img: "https://i.ytimg.com/vi/" + x.videoId + "/mqdefault.jpg",
            };
          });
        },
      });
    });
    tryList(attempts, 0).then(
      function (items) {
        if (!items.length) {
          $("#mStat").text(
            "No results found. Try another name or paste a YouTube link.",
          );
          return;
        }
        S.music.results = items;
        $("#mStat").text("Select a song and click Play:");
        $.each(items, function (i, it) {
          var $li = $("<li>")
            .append(
              $("<img>").attr({ src: it.img, alt: "" }),
              $('<div class="mres-info">').append(
                $('<span class="mres-t">').text(it.title),
                $('<span class="mres-c">').text(it.ch),
              ),
            )
            .on("click", function () {
              $("#mRes li").removeClass("sel");
              $li.addClass("sel");
              S.music.picked = { id: it.id, title: it.title };
            })
            .appendTo("#mRes");
          if (i === 0) {
            $li.addClass("sel");
            S.music.picked = { id: it.id, title: it.title };
          }
        });
      },
      function () {
        $("#mStat").text(
          "Free search servers are busy right now. Paste any YouTube link above to play.",
        );
      },
    );
  }
  function playSimilar(vid) {
    if (!vid || S.role !== "host") return;
    var attempts = PIPED.map(function (h) {
      return {
        u: h + "/streams/" + vid,
        map: function (d) {
          var rel = (d.relatedStreams || []).filter(function (x) {
            return x.url && x.url.indexOf("v=") > -1;
          });
          for (var i = 0; i < rel.length; i++) {
            var id = rel[i].url.split("v=")[1].slice(0, 11);
            if (S.music.history.indexOf(id) === -1)
              return { id: id, title: rel[i].title || "Similar Track" };
          }
          return rel[0]
            ? {
                id: rel[0].url.split("v=")[1].slice(0, 11),
                title: rel[0].title || "Similar Track",
              }
            : null;
        },
      };
    });
    tryList(attempts, 0).then(
      function (next) {
        if (next && S.music.playing)
          hostMusic({ act: "play", vid: next.id, title: next.title });
      },
      function () {
        if (S.music.playing && ytPlayer && ytPlayer.loadPlaylist) {
          ytPlayer.loadPlaylist({
            list: "RD" + vid,
            listType: "playlist",
            index: 1,
          });
        }
      },
    );
  }

  // ---------- lifecycle & RAM cleanup ----------
  function syncViewport() {
    if (!S.entered) return;
    var vv = w.visualViewport,
      h = vv ? vv.height : w.innerHeight;
    $("#chat").css("height", h + "px");
    if (w.scrollY || w.scrollX) w.scrollTo(0, 0);
  }
  function enter() {
    S.entered = true;
    show("chat");
    syncViewport();
    if (w.history && w.history.pushState)
      w.history.pushState({ qcRoom: S.room }, "", w.location.href);
    $("#roomid").text(fmt(S.room));
    $(".hostonly").prop("hidden", S.role !== "host");
    $("#leave").text(S.role === "host" ? "Close room" : "Leave");
    $("#messages").empty();
    $("#empty").show();
    renderRoster();
    updateMusicUI();
    tick();
    S.timer = setInterval(tick, 1000);
    busy(false);
    $("dialog[open]").each(function () {
      this.close();
    });
    sys(
      S.role === "host"
        ? "Room created. Share the Room ID or the invitation link."
        : "You joined the room.",
    );
  }
  function cleanup() {
    S.aborted = true;
    clearInterval(S.timer);
    stopAudio();
    $("#messages video").each(function () {
      try {
        this.pause();
        this.removeAttribute("src");
        this.load();
      } catch (e) {
        /* ignore */
      }
    });
    $("#messages img").attr("src", "");
    $.each(S.urls, function (i, u) {
      try {
        URL.revokeObjectURL(u);
      } catch (e) {
        /* ignore */
      }
    });
    $.each(S.conns, function (id, c) {
      try {
        c.close();
      } catch (e) {
        /* ignore */
      }
    });
    try {
      if (S.conn) S.conn.close();
    } catch (e) {
      /* ignore */
    }
    try {
      if (S.peer) S.peer.destroy();
    } catch (e) {
      /* ignore */
    }
    S = fresh();
    $("#messages,#roster,#mRes").empty();
    $("#typing,#mStat").text("");
    $("#mNow").text("Nothing playing");
    $("#finput").val("");
    clearReply();
    $("#side").removeClass("open");
    $("#sideBack").prop("hidden", true);
    $("#chat").css("height", "");
    show("home");
  }
  function fail(msg) {
    if (S.entered) {
      toast(msg);
      return;
    }
    cleanup();
    $("dialog[open] .err").text(msg);
    busy(false);
  }
  function end(msg) {
    cleanup();
    $("#notice").text(msg);
  }

  // ---------- host side ----------
  function roster() {
    return [{ id: S.me.id, name: S.me.name, host: true }].concat(S.guests);
  }
  function pushRoster() {
    S.list = roster();
    renderRoster();
    bcast({ t: "roster", list: S.list, max: S.max });
  }
  function announce(t) {
    sys(t);
    bcast({ t: "sys", text: t });
  }
  function dropGuest(id) {
    var g = S.guests.filter(function (x) {
      return x.id === id;
    })[0];
    if (!g) return;
    S.guests = S.guests.filter(function (x) {
      return x.id !== id;
    });
    delete S.conns[id];
    pushRoster();
    announce(g.name + " left");
  }
  function post(from, m) {
    if (
      typeof m.text !== "string" ||
      !m.text.trim() ||
      m.text.length > 2000 ||
      typeof m.id !== "string" ||
      m.id.length > 40 ||
      S.seen[m.id]
    )
      return;
    S.seen[m.id] = 1;
    var o = {
      t: "msg",
      id: m.id,
      from: from.id,
      name: from.name,
      text: m.text,
      ts: Date.now(),
      re: typeof m.re === "string" ? m.re.slice(0, 120) : "",
    };
    bcast(o);
    addMsg(o);
  }
  function admit(m) {
    var n = clean(m.name);
    if (n.length < 2) return "Enter a name of at least 2 characters.";
    if (S.pass && m.pass !== S.pass) return "Wrong room password.";
    if (S.guests.length + 1 >= S.max) return "The room is full.";
    if (
      roster().some(function (x) {
        return x.name.toLowerCase() === n.toLowerCase();
      })
    )
      return "That name is already used in this room.";
    return "";
  }
  function onGuest(c) {
    var g = null,
      st = S,
      to = setTimeout(function () {
        if (!g) c.close();
      }, 10000);
    c.on("data", function (m) {
      if (S !== st || !m || typeof m !== "object") return;
      if (!g) {
        if (m.t !== "join") return;
        var why = admit(m);
        if (why) {
          send(c, { t: "denied", why: why });
          setTimeout(function () {
            c.close();
          }, 400);
          return;
        }
        g = { id: rid(12), name: clean(m.name) };
        S.guests.push(g);
        S.conns[g.id] = c;
        send(c, {
          t: "welcome",
          you: g.id,
          name: g.name,
          room: S.room,
          max: S.max,
          createdAt: S.createdAt,
          now: Date.now(),
          list: roster(),
          music: {
            all: S.music.all,
            playing: S.music.playing,
            vid: S.music.vid,
            title: S.music.title,
            startedAt: S.music.startedAt,
          },
        });
        pushRoster();
        announce(g.name + " joined");
      } else if (m.t === "msg") {
        post(g, m);
      } else if (m.t === "typing") {
        bcast({ t: "typing", name: g.name }, g.id);
        typing(g.name);
      } else if (m.t === "fstart" || m.t === "fchunk" || m.t === "fend") {
        onFileMsg(m, g);
      } else if (m.t === "music") {
        hostMusic(m, g.name);
      }
    });
    c.on("close", function () {
      clearTimeout(to);
      if (g && S === st) dropGuest(g.id);
    });
  }
  function openHost(name, max, pass, tries, customRoom) {
    // customRoom is the already-normalised room id (or "" for auto-generate).
    var isCustom = !!customRoom;
    var room = isCustom ? normRoom(customRoom) : rid(10);
    if (isCustom && (peerKey(room).length < 4 || peerKey(room).length > 24))
      return fail(
        "Custom Room ID must contain 4–24 letters or numbers after normalisation.",
      );
    var targetId = peerIdFor(room);
    var p = new Peer(targetId),
      st = S,
      opened = false;
    S.peer = p;
    p.on("open", function () {
      if (S !== st) return;
      opened = true;
      S.role = "host";
      S.room = room;
      S.max = max;
      S.pass = pass;
      S.me = { id: rid(12), name: name };
      S.createdAt = Date.now();
      S.offset = 0;
      S.list = roster();
      enter();
    });
    p.on("connection", onGuest);
    p.on("disconnected", function () {
      if (S === st) {
        try {
          p.reconnect();
        } catch (e) {
          /* retry on next event */
        }
      }
    });
    p.on("error", function (e) {
      if (S !== st) return;
      if (!opened && e.type === "unavailable-id") {
        if (isCustom)
          return fail("This Room ID is already in use. Please choose another.");
        if (tries < 3) {
          try {
            p.destroy();
          } catch (x) {
            /* ignore */
          }
          return openHost(name, max, pass, tries + 1, "");
        }
      }
      fail(
        ["network", "server-error", "socket-error", "socket-closed"].indexOf(
          e.type,
        ) > -1
          ? "Cannot reach the PeerJS signaling server. Check your internet connection."
          : "Error: " + e.type,
      );
    });
  }

  // ---------- guest side ----------
  function onHost(m) {
    if (!m || typeof m !== "object") return;
    switch (m.t) {
      case "welcome":
        S.role = "guest";
        S.room = m.room;
        S.me = { id: m.you, name: String(m.name) };
        S.max = m.max;
        S.createdAt = m.createdAt;
        S.offset = m.now - Date.now();
        S.list = m.list;
        if (m.music) {
          S.music.all = !!m.music.all;
        }
        enter();
        if (m.music && m.music.playing)
          applyMusic({
            act: "play",
            vid: m.music.vid,
            title: m.music.title,
            startedAt: m.music.startedAt,
          });
        break;
      case "roster":
        S.list = m.list;
        S.max = m.max;
        renderRoster();
        break;
      case "msg":
        if (typeof m.text === "string" && !S.seen[m.id]) {
          S.seen[m.id] = 1;
          addMsg(m);
        }
        break;
      case "sys":
        sys(String(m.text).slice(0, 200));
        break;
      case "typing":
        typing(String(m.name));
        break;
      case "fstart":
      case "fchunk":
      case "fend":
        onFileMsg(m, null);
        break;
      case "music":
        applyMusic(m);
        break;
      case "denied":
        fail(String(m.why));
        break;
      case "closed":
        end("The host closed the room.");
        break;
      case "kicked":
        end("You were removed from the room.");
        break;
    }
  }
  function joinRoom(room, name, pass) {
    var targetId = peerIdFor(normRoom(room));
    var p = new Peer("qc1g-" + rid(16).toLowerCase()),
      st = S,
      timer;
    S.peer = p;
    p.on("open", function () {
      if (S !== st) return;
      var c = p.connect(targetId, {
        reliable: true,
        serialization: "binary",
      });
      S.conn = c;
      timer = setTimeout(function () {
        if (S === st)
          fail(
            "Could not connect. The room may be closed, or your network blocks peer-to-peer connections (a TURN relay may be needed).",
          );
      }, 20000);
      c.on("open", function () {
        clearTimeout(timer);
        send(c, { t: "join", name: name, pass: pass });
      });
      c.on("data", function (m) {
        if (S === st) onHost(m);
      });
      c.on("close", function () {
        clearTimeout(timer);
        if (S === st && S.entered)
          end("Disconnected from the host. The room has ended.");
      });
    });
    p.on("error", function (e) {
      if (S !== st) return;
      clearTimeout(timer);
      fail(
        e.type === "peer-unavailable"
          ? "Room not found. Check the Room ID, or the host may have closed it."
          : "Connection error: " + e.type,
      );
    });
  }

  // ---------- UI events ----------
  if (typeof Peer === "undefined" || !w.RTCPeerConnection) {
    $("#libwarn").prop("hidden", false);
    $("#bCreate,#bJoin").prop("disabled", true);
  }
  function openDlg(id) {
    $("#" + id + " .err").text("");
    var n = clean($("#uname").val());
    if (id === "dCreate") $("#cName").val(n);
    if (id === "dJoin") $("#jName").val(n);
    d.getElementById(id).showModal();
  }
  $("#bCreate").on("click", function () {
    openDlg("dCreate");
  });
  $("#bJoin").on("click", function () {
    openDlg("dJoin");
  });
  $("[data-close]").on("click", function () {
    this.closest("dialog").close();
  });
  $("dialog").on("close", function () {
    if (!S.entered && S.peer) {
      cleanup();
      busy(false);
    }
  });
  $("#fCreate").on("submit", function (e) {
    e.preventDefault();
    var name = clean($("#cName").val()),
      max = parseInt($("#cMax").val(), 10),
      rawRoom = normRoom($("#cRoom").val()),
      $e = $("#dCreate .err");
    if (name.length < 2)
      return $e.text("Enter a name of at least 2 characters.");
    if (
      rawRoom &&
      (peerKey(rawRoom).length < 4 || peerKey(rawRoom).length > 24)
    )
      return $e.text("Custom Room ID must contain 4–24 letters or numbers.");
    if (!max) return $e.text("Select the maximum number of members.");
    $e.text("");
    busy(true);
    openHost(name, max, $("#cPass").val().slice(0, 64), 0, rawRoom);
  });
  $("#fJoin").on("submit", function (e) {
    e.preventDefault();
    var room = normRoom($("#jRoom").val()),
      name = clean($("#jName").val()),
      $e = $("#dJoin .err");
    if (peerKey(room).length < 4 || peerKey(room).length > 24)
      return $e.text("Enter a valid Room ID (4–24 characters).");
    if (name.length < 2)
      return $e.text("Enter a name of at least 2 characters.");
    $e.text("");
    busy(true);
    joinRoom(room, name, $("#jPass").val().slice(0, 64));
  });
  $('#composer button[type="submit"]').on("mousedown", function (e) {
    e.preventDefault();
  });
  $("#composer").on("submit", function (e) {
    e.preventDefault();
    var $i = $("#input"),
      el = $i[0],
      text = $i.val().trim();
    if (!text || !S.me) {
      if (el) el.focus({ preventScroll: true });
      return;
    }
    var m = {
      id: rid(16),
      text: text.slice(0, 2000),
      re: S.reply ? (S.reply.n + ": " + S.reply.t).slice(0, 100) : "",
    };
    if (S.role === "host") post({ id: S.me.id, name: S.me.name }, m);
    else send(S.conn, { t: "msg", id: m.id, text: m.text, re: m.re });
    $i.val("");
    clearReply();
    if (el) el.focus({ preventScroll: true });
  });
  $("#input")
    .on("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        $("#composer").trigger("submit");
      }
    })
    .on("input", function () {
      var now = Date.now();
      if (!S.me || now - lastType < 2000) return;
      lastType = now;
      if (S.role === "host") bcast({ t: "typing", name: S.me.name });
      else send(S.conn, { t: "typing" });
    });
  $("#bAttach").on("click", function () {
    $("#finput").trigger("click");
  });
  $("#finput").on("change", function () {
    if (this.files.length) sendFiles(this.files);
    this.value = "";
  });
  $(".chatmain")
    .on("dragover", function (e) {
      e.preventDefault();
      $("#dropov").prop("hidden", false);
    })
    .on("dragleave drop", function (e) {
      e.preventDefault();
      if (e.type === "drop" && e.originalEvent.dataTransfer.files.length)
        sendFiles(e.originalEvent.dataTransfer.files);
      $("#dropov").prop("hidden", true);
    });
  $("#bMusic").on("click", function () {
    updateMusicUI();
    var el = d.getElementById("dMusic");
    if (!el.open) el.show();
  });
  $("#fMusic").on("submit", function (e) {
    e.preventDefault();
    var q = $("#mQuery").val().trim();
    if (q && canMusic()) searchMusic(q);
  });
  $("#mPlay").on("click", function () {
    if (!canMusic()) return;
    var q = $("#mQuery").val().trim(),
      direct = extractYtId(q);
    var pick = direct
      ? { id: direct, title: "YouTube Video (" + direct + ")" }
      : S.music.picked;
    if (!pick) {
      toast("Search and select a song or paste a YouTube link first.");
      return;
    }
    if (
      S.music.playing &&
      S.music.vid === pick.id &&
      ytPlayer &&
      ytPlayer.playVideo
    ) {
      try {
        ytPlayer.unMute();
        ytPlayer.setVolume(100);
        ytPlayer.playVideo();
        return;
      } catch (e) {}
    }
    if (S.role === "host")
      hostMusic({ act: "play", vid: pick.id, title: pick.title });
    else
      send(S.conn, {
        t: "music",
        act: "play",
        vid: pick.id,
        title: pick.title,
      });
  });
  $("#mStop").on("click", function () {
    if (!canMusic()) return;
    if (S.role === "host") hostMusic({ act: "stop" });
    else send(S.conn, { t: "music", act: "stop" });
  });
  $("#mAll").on("change", function () {
    if (S.role === "host") hostMusic({ act: "perm", all: this.checked });
  });
  function startReply($m) {
    var n = $m.data("n"),
      t = $m.data("t");
    if (!t) return;
    S.reply = { n: n, t: t };
    $("#rtext").text("Replying to " + n + ": " + String(t).slice(0, 60));
    $("#replybar").prop("hidden", false);
    var el = d.getElementById("input");
    if (el) el.focus({ preventScroll: true });
  }
  $("#messages").on("click", "button[data-a]", function () {
    var $m = $(this).closest(".msg"),
      a = $(this).data("a");
    if (a === "copy") copy($m.data("t"));
    else startReply($m);
  });
  (function () {
    var sx = 0,
      sy = 0,
      dx = 0,
      lock = "",
      $cur = null,
      vib = false;
    $("#messages")
      .on("touchstart", ".msg", function (e) {
        var $m = $(this);
        if (!$m.data("t") || e.originalEvent.touches.length !== 1) return;
        var t = e.originalEvent.touches[0];
        sx = t.clientX;
        sy = t.clientY;
        dx = 0;
        lock = "";
        vib = false;
        $cur = $m;
      })
      .on("touchmove", ".msg", function (e) {
        if (!$cur || this !== $cur[0]) return;
        var t = e.originalEvent.touches[0],
          mx = t.clientX - sx,
          my = t.clientY - sy;
        if (!lock) {
          if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
          lock = Math.abs(mx) > Math.abs(my) * 1.2 && mx > 0 ? "h" : "v";
        }
        if (lock !== "h") return;
        e.preventDefault();
        dx = Math.min(72, Math.max(0, mx));
        $cur
          .find(".bub")
          .css({ transition: "none", transform: "translateX(" + dx + "px)" });
        if (!vib && dx >= 52) {
          vib = true;
          try {
            if (navigator.vibrate) navigator.vibrate(10);
          } catch (err) {}
        }
      })
      .on("touchend touchcancel", ".msg", function () {
        if (!$cur || this !== $cur[0]) return;
        $cur.find(".bub").css({ transition: "", transform: "" });
        if (lock === "h" && dx >= 52) startReply($cur);
        $cur = null;
        lock = "";
        dx = 0;
      });
  })();
  $("#rclear").on("click", clearReply);
  $("#cpId").on("click", function () {
    copy(S.room);
  });
  $("#cpLink").on("click", function () {
    copy(w.location.href.split("#")[0] + "#join=" + encodeURIComponent(S.room));
  });
  function setSide(open) {
    $("#side").toggleClass("open", open);
    $("#sideBack").prop("hidden", !open);
  }
  $("#members").on("click", function (e) {
    e.stopPropagation();
    setSide(!$("#side").hasClass("open"));
  });
  $("#sideBack").on("click touchstart", function (e) {
    e.preventDefault();
    setSide(false);
  });
  $(d).on("click", function (e) {
    if (
      $("#side").hasClass("open") &&
      !$(e.target).closest("#side, #members").length
    )
      setSide(false);
  });
  function setMax(n) {
    n = Math.min(20, Math.max(S.guests.length + 1, 2, n));
    if (n !== S.max) {
      S.max = n;
      pushRoster();
    }
  }
  $("#capUp").on("click", function () {
    setMax(S.max + 1);
  });
  $("#capDn").on("click", function () {
    setMax(S.max - 1);
  });
  $("#roster").on("click", ".x", function () {
    var id = $(this).attr("data-id"),
      c = S.conns[id];
    if (c) {
      send(c, { t: "kicked" });
      setTimeout(function () {
        try {
          c.close();
        } catch (e) {
          /* closed */
        }
      }, 300);
    }
    dropGuest(id);
  });
  // Leave button — confirm for BOTH host and guest (host: close for everyone).
  $("#leave").on("click", function () {
    if (!confirmLeave()) return;
    if (S.role === "host") {
      bcast({ t: "closed" });
      setTimeout(function () {
        end("Room closed.");
      }, 400);
    } else {
      end("You left the room.");
    }
  });
  if (w.visualViewport) {
    $(w.visualViewport).on("resize scroll", syncViewport);
  }
  $(w).on("resize", syncViewport);
  // Reload / close tab / navigate away — native browser confirm.
  // NOTE: beforeunload does NOT fire on minimise, tab switch, or screen lock,
  // so the user stays in the room silently in those cases.
  $(w).on("beforeunload", function (e) {
    if (!S.entered) return;
    e.preventDefault();
    e.returnValue =
      S.role === "host"
        ? "Close the room for everyone? All messages and media are cleared."
        : "Leave this room? Once you leave, you cannot see previous messages.";
    return e.returnValue;
  });
  // Back / forward button — beforeunload does NOT fire here.
  $(w).on("popstate", function () {
    if (!S.entered) return;
    if (!confirmLeave()) {
      if (w.history && w.history.pushState)
        w.history.pushState({ qcRoom: S.room }, "", w.location.href);
      return;
    }
    if (S.role === "host") bcast({ t: "closed" });
    end(S.role === "host" ? "Room closed." : "You left the room.");
  });
  // Silent cleanup only after the user has already approved leaving.
  $(w).on("pagehide", function () {
    if (S.entered) {
      if (S.role === "host") bcast({ t: "closed" });
      cleanup();
    }
  });

  // Invitation link: index.html#join=ROOMID (the fragment is never sent to the web server)
  var inv = /^#join=([A-Za-z0-9%-]+)/.exec(w.location.hash);
  if (inv && !$("#bJoin").prop("disabled")) {
    openDlg("dJoin");
    $("#jRoom").val(fmt(normRoom(decodeURIComponent(inv[1])).slice(0, 24)));
  }
})(jQuery, window, document);
