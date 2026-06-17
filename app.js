(function () {
  "use strict";

  var AUTO_REFRESH_MS = 3000;
  var HIDE_COMMAND_AND_CHAT_LOGS = true;
  var isLoading = false;

  var state = {
    players: [],
    logsByPlayer: {},
    logs: [],
    activePlayer: "",
    chestFilter: "all",
    blockFilter: "all",
    lastSignature: "",
    activeView: "overview"
  };

  var LABEL = {
    take: "Mengambil",
    put: "Memasukkan",
    chest: "Interaksi Chest",
    break: "Menghancurkan Block",
    place: "Menaruh Block",
    drop: "Membuang Item",
    swap: "Menukar Item",
    pickup: "Mengambil Item",
    session: "Join/Leave",
    combat: "Combat/Death",
    other: "Event Lain"
  };

  var ORDER = ["take", "put", "chest", "break", "place", "drop", "swap", "pickup", "session", "combat", "other"];

  function $(selector) { return document.querySelector(selector); }
  function $all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function stripHtml(value) {
    var div = document.createElement("div");
    div.innerHTML = String(value || "");
    return div.textContent || div.innerText || "";
  }

  function lower(value) { return String(value || "").toLowerCase(); }
  function formatNumber(value) { return Number(value || 0).toLocaleString("id-ID"); }

  function fetchJson(url) {
    return fetch(url, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function startClock() {
    function tick() {
      var now = new Date();
      $("#live-clock").textContent = pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
      $("#live-date").textContent = dayName(now) + ", " + pad(now.getDate()) + "/" + pad(now.getMonth() + 1) + "/" + now.getFullYear();
    }
    tick();
    setInterval(tick, 1000);
  }

  function dayName(date) {
    return ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][date.getDay()];
  }

  function pad(value) { return String(value).padStart(2, "0"); }

  function setStatus(type, text) {
    var el = $("#api-status");
    el.className = "status " + type;
    el.textContent = text;
  }

  function setLastSync() {
    var now = new Date();
    $("#last-sync").textContent = "Last sync: " + pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
  }

  function toast(text) {
    var el = $("#toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  function getAction(raw) {
    if (typeof raw === "string") return raw;
    return raw.action || raw.content || raw.message || raw.text || raw.line || raw.event || "";
  }

  function getTime(raw, action) {
    if (raw && typeof raw === "object") {
      return raw.time || raw.timestamp || raw.date || raw.created_at || raw.datetime || "";
    }
    var m = String(action || "").match(/\[([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}[ T][0-9:.]+)\]/);
    return m ? m[1] : "";
  }

  function getObjectCoords(raw) {
    if (!raw || typeof raw !== "object") return null;

    var candidates = [
      ["x", "y", "z"],
      ["blockX", "blockY", "blockZ"],
      ["block_x", "block_y", "block_z"],
      ["locX", "locY", "locZ"],
      ["location_x", "location_y", "location_z"]
    ];

    for (var i = 0; i < candidates.length; i++) {
      var k = candidates[i];
      if (raw[k[0]] !== undefined && raw[k[1]] !== undefined && raw[k[2]] !== undefined) {
        return makeCoords(raw[k[0]], raw[k[1]], raw[k[2]]);
      }
    }

    if (raw.location && typeof raw.location === "object") {
      var l = raw.location;
      if (l.x !== undefined && l.y !== undefined && l.z !== undefined) return makeCoords(l.x, l.y, l.z);
    }

    if (raw.position && typeof raw.position === "object") {
      var p = raw.position;
      if (p.x !== undefined && p.y !== undefined && p.z !== undefined) return makeCoords(p.x, p.y, p.z);
    }

    return null;
  }

  function makeCoords(x, y, z) {
    return {
      x: String(Math.round(Number(x))),
      y: String(Math.round(Number(y))),
      z: String(Math.round(Number(z))),
      text: String(Math.round(Number(x))) + " " + String(Math.round(Number(y))) + " " + String(Math.round(Number(z)))
    };
  }

  function parseTime(rawTime, fallbackIndex) {
    var text = String(rawTime || "").trim();

    var m = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (m) {
      return partsFromDate(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    }

    var parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) return partsFromDate(new Date(parsed));

    var hms = text.match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (hms) {
      var now = new Date();
      return partsFromDate(new Date(now.getFullYear(), now.getMonth(), now.getDate(), +hms[1], +hms[2], +(hms[3] || 0)));
    }

    return {
      sort: Number.MAX_SAFE_INTEGER - fallbackIndex,
      dayDate: "-",
      clock: text || "-"
    };
  }

  function partsFromDate(date) {
    return {
      sort: date.getTime(),
      dayDate: dayName(date) + ", " + pad(date.getDate()) + "/" + pad(date.getMonth() + 1) + "/" + date.getFullYear(),
      clock: pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds())
    };
  }

  function normalizeLog(player, raw, index) {
    var rawText = stripHtml(getAction(raw));
    var timeText = getTime(raw, rawText);
    var time = parseTime(timeText, index);
    var parsed = parseAction(rawText, raw);

    return {
      id: player + "-" + index + "-" + time.sort,
      player: player,
      dayDate: time.dayDate,
      clock: time.clock,
      sort: time.sort,
      category: parsed.category,
      activity: parsed.activity,
      item: parsed.item,
      amount: parsed.amount,
      container: parsed.container,
      coords: parsed.coords,
      detail: parsed.detail,
      raw: rawText,
      hidden: shouldHide(rawText, parsed.category)
    };
  }

  function parseAction(rawText, rawObj) {
    var text = String(rawText || "").replace(/\[[^\]]+\]/g, " ").replace(/\s+/g, " ").trim();
    var lc = lower(text);
    var event = detectEvent(text);
    var eventLc = lower(event);
    var container = detectContainer(text);
    var itemAmount = detectItemAmount(text);
    var coords = getObjectCoords(rawObj) || detectCoords(text);
    var block = detectBlock(text, rawObj);
    var category = "other";
    var activity = event ? "Event " + event : "Event terdeteksi";
    var item = itemAmount.item || block || "-";
    var amount = itemAmount.amount || "-";

    if (isCommandOrChat(lc)) {
      category = "command";
      activity = "Command/Chat";
    } else if (isBreakEvent(lc, eventLc)) {
      category = "break";
      activity = "Menghancurkan block";
      item = block || itemAmount.item || "-";
    } else if (isPlaceEvent(lc, eventLc)) {
      category = "place";
      activity = "Menaruh block";
      item = block || itemAmount.item || "-";
    } else if (containsAny(eventLc + " " + lc, ["drop_all", "drop_one", "drop_item", "item_drop", "dropped", "membuang"])) {
      category = "drop";
      activity = "Membuang item";
    } else if (containsAny(eventLc, ["swap_with_cursor", "hotbar_swap", "hotbar_move", "swap"])) {
      category = "swap";
      activity = container ? "Menukar item di " + container : "Menukar item";
    } else if (container && container !== "-") {
      if (isTakeEvent(lc, eventLc)) {
        category = "take";
        activity = "Mengambil dari " + container;
      } else if (isPutEvent(lc, eventLc)) {
        category = "put";
        activity = "Memasukkan ke " + container;
      } else if (containsAny(eventLc, ["collect_to_cursor"])) {
        category = "take";
        activity = "Mengumpulkan item dari " + container;
      } else if (containsAny(eventLc, ["clone_stack"])) {
        category = "chest";
        activity = "Clone stack di " + container;
      } else {
        category = "chest";
        activity = "Interaksi " + container + " (" + prettyEvent(event) + ")";
      }
    } else if (containsAny(eventLc + " " + lc, ["item_pickup", "pickup_item", "picked up", "pickup"])) {
      category = "pickup";
      activity = "Mengambil item dari ground";
    } else if (containsAny(lc, ["join", "joined", "player_join", "quit", "left", "disconnect"])) {
      category = "session";
      activity = containsAny(lc, ["quit", "left", "disconnect"]) ? "Player leave" : "Player join";
    } else if (containsAny(lc, ["death", "died", "killed", "slain", "damage"])) {
      category = "combat";
      activity = "Combat/death";
    } else if (event) {
      category = "other";
      activity = "Event " + prettyEvent(event);
    }

    var detail = activity;
    if (item && item !== "-") detail += " · " + (amount && amount !== "-" ? amount + "x " : "") + item;
    if (container && container !== "-") detail += " · " + container;
    if (coords) detail += " · " + coords.text;

    return { category: category, activity: activity, item: item || "-", amount: amount || "-", container: container || "-", coords: coords, detail: detail };
  }

  function detectEvent(text) {
    var m = text.match(/\b([A-Z]+(?:_[A-Z]+)+)(?:\s+([A-Z0-9_]+))?/);
    if (!m) return "";
    return (m[1] + " " + (m[2] || "")).trim();
  }

  function prettyEvent(event) {
    return pretty(String(event || "").replace(/\s+/g, "_"));
  }

  function isCommandOrChat(lc) {
    return containsAny(lc, [
      "command", "player_command", "server_command", "issued server command",
      "chat", "async_player_chat", "message:", "/login", "/register", "/msg", "/tell", "/w "
    ]);
  }

  function isBreakEvent(lc, eventLc) {
    return containsAny(eventLc + " " + lc, ["block_break", "break_block", "break block", "broke", "break ", "destroyed", "mined", "menghancurkan"]);
  }

  function isPlaceEvent(lc, eventLc) {
    return containsAny(eventLc + " " + lc, ["block_place", "place_block", "place block", "placed", "place ", "menaruh"]);
  }

  function isTakeEvent(lc, eventLc) {
    return containsAny(eventLc + " " + lc, [
      "pickup_all", "pickup_half", "pickup_one", "pickup_some",
      "collect", "take", "took", "removed", "mengambil", "diambil", "pickup"
    ]) || containsAny(eventLc, ["move_to_other_inventory"]);
  }

  function isPutEvent(lc, eventLc) {
    return containsAny(eventLc + " " + lc, [
      "place_all", "place_one", "place_some", "put", "added", "inserted", "stored", "memasukkan", "dimasukkan"
    ]);
  }

  function detectContainer(text) {
    var m = text.match(/\bin\s+([A-Z_]+)\s*:/i);
    if (m) return pretty(m[1]);

    var list = ["ENDER_CHEST", "TRAPPED_CHEST", "CHEST", "BARREL", "HOPPER", "SHULKER_BOX", "FURNACE", "BLAST_FURNACE", "SMOKER", "DISPENSER", "DROPPER", "BREWING_STAND", "STONECUTTER", "CRAFTING_TABLE", "ANVIL", "PLAYER"];
    var lc = lower(text);
    for (var i = 0; i < list.length; i++) {
      if (lc.indexOf(lower(list[i])) !== -1) return pretty(list[i]);
    }
    if (lc.indexOf("container") !== -1) return "Container";
    return "";
  }

  function detectItemAmount(text) {
    var patterns = [
      /:\s*(\d+)x([A-Z0-9_]+)\b/i,
      /\b(\d+)x([A-Z0-9_]+)\b/i,
      /\b([A-Z0-9_]+)\s*x\s*(\d+)\b/i,
      /(?:item|material|type)[:= ]+([A-Z0-9_:_ -]+).*?(?:amount|qty|jumlah)[:= ]+(\d+)/i,
      /(?:amount|qty|jumlah)[:= ]+(\d+).*?(?:item|material|type)[:= ]+([A-Z0-9_:_ -]+)/i
    ];

    for (var i = 0; i < patterns.length; i++) {
      var m = text.match(patterns[i]);
      if (m) {
        if (/^\d+$/.test(m[1])) return { amount: m[1], item: pretty(m[2]) };
        return { amount: m[2], item: pretty(m[1]) };
      }
    }

    var mc = text.match(/minecraft:([a-z0-9_]+)/i);
    if (mc) return { amount: "-", item: pretty(mc[1]) };

    return { amount: "-", item: "" };
  }

  function detectBlock(text, rawObj) {
    if (rawObj && typeof rawObj === "object") {
      var fields = ["block", "blockType", "material", "type", "item", "itemType"];
      for (var i = 0; i < fields.length; i++) {
        if (rawObj[fields[i]] && typeof rawObj[fields[i]] === "string" && !isBadItem(rawObj[fields[i]])) {
          return pretty(rawObj[fields[i]]);
        }
      }
    }

    var known = [
      "DEEPSLATE_DIAMOND_ORE", "DIAMOND_ORE", "ANCIENT_DEBRIS", "EMERALD_ORE", "GOLD_ORE",
      "IRON_ORE", "COAL_ORE", "REDSTONE_ORE", "LAPIS_ORE", "COPPER_ORE", "NETHER_QUARTZ_ORE",
      "GRASS_BLOCK", "DIRT", "STONE", "DEEPSLATE", "COBBLESTONE", "TUFF_BRICKS", "TUFF_BRICK_STAIRS", "TUFF_BRICK_WALL",
      "OAK_LOG", "SPRUCE_LOG"
    ];

    var lc = lower(text);
    for (var j = 0; j < known.length; j++) {
      if (lc.indexOf(lower(known[j])) !== -1) return pretty(known[j]);
    }

    var m = text.match(/\b(?:BLOCK_BREAK|BLOCK_PLACE|broke|break|placed|place|mined|destroyed)\s+(?:minecraft:)?([A-Z0-9_]+)/i);
    if (m && !isBadItem(m[1])) return pretty(m[1]);

    return "";
  }

  function detectCoords(text) {
    var patterns = [
      /x[:= ]\s*(-?\d+)[, ]+y[:= ]\s*(-?\d+)[, ]+z[:= ]\s*(-?\d+)/i,
      /(?:at|location|pos|position|lokasi)\s*[:=]?\s*\(?\s*(-?\d+)[,\s]+(-?\d+)[,\s]+(-?\d+)\s*\)?/i,
      /\(\s*(-?\d+)\s*[, ]\s*(-?\d+)\s*[, ]\s*(-?\d+)\s*\)/,
      /\b(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\b/
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = text.match(patterns[i]);
      if (m) return makeCoords(m[1], m[2], m[3]);
    }
    return null;
  }

  function shouldHide(text, category) {
    if (!HIDE_COMMAND_AND_CHAT_LOGS) return false;
    return category === "command" || isCommandOrChat(lower(text));
  }

  function isBadItem(value) {
    var v = lower(value);
    return !v || containsAny(v, ["container", "world", "location", "amount"]);
  }

  function pretty(value) {
    value = String(value || "")
      .replace(/^minecraft:/i, "")
      .replace(/_/g, " ")
      .replace(/[^a-zA-Z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!value) return "-";
    return value.toLowerCase().replace(/\b\w/g, function (s) { return s.toUpperCase(); });
  }

  function containsAny(text, list) {
    for (var i = 0; i < list.length; i++) if (text.indexOf(list[i]) !== -1) return true;
    return false;
  }

  function visible(logs) {
    return logs.filter(function (l) { return !l.hidden && l.category !== "command"; });
  }

  function loadAll(silent) {
    if (isLoading) return Promise.resolve();
    isLoading = true;
    if (!silent) setStatus("loading", "Loading API");

    return fetchJson("/api/players")
      .then(function (players) {
        state.players = Array.isArray(players) ? players.filter(function (p) { return p && p.name && p.name !== "_server"; }) : [];
        return hydrateLogs();
      })
      .then(function () {
        state.logs = flattenLogs().sort(function (a, b) { return b.sort - a.sort; });
        var nextSignature = makeSignature();
        fillPlayerSelects();

        if (!silent || nextSignature !== state.lastSignature) {
          renderAll();
          if (state.activePlayer && $("#player-modal").classList.contains("open")) renderModal();
        }

        setStatus("online", "API Online");
        setLastSync();

        if (silent && state.lastSignature && nextSignature !== state.lastSignature) {
          toast("Log baru masuk, dashboard diperbarui.");
        }
        state.lastSignature = nextSignature;
      })
      .catch(function (err) {
        console.error(err);
        setStatus("offline", "API Error");
        if (!silent) $("#latest-player-list").innerHTML = '<div class="empty">Gagal load API. Pastikan /api/players dan /api/logs aktif.</div>';
      })
      .finally(function () {
        isLoading = false;
      });
  }

  function hydrateLogs() {
    state.logsByPlayer = {};
    var queue = state.players.slice();
    var workers = [];
    var concurrency = 5;

    function next() {
      var p = queue.shift();
      if (!p) return Promise.resolve();
      return fetchJson("/api/logs?player=" + encodeURIComponent(p.name))
        .then(function (logs) {
          var normalized = Array.isArray(logs) ? logs.map(function (raw, index) { return normalizeLog(p.name, raw, index); }) : [];
          state.logsByPlayer[p.name] = visible(normalized).sort(function (a, b) { return b.sort - a.sort; });
        })
        .catch(function () {
          state.logsByPlayer[p.name] = [];
        })
        .then(next);
    }

    for (var i = 0; i < concurrency; i++) workers.push(next());
    return Promise.all(workers);
  }

  function flattenLogs() {
    var out = [];
    Object.keys(state.logsByPlayer).forEach(function (name) { out = out.concat(state.logsByPlayer[name]); });
    return visible(out);
  }

  function makeSignature() {
    return state.logs.slice(0, 20).map(function (l) {
      return l.player + "|" + l.clock + "|" + l.raw;
    }).join("~");
  }

  function latestPlayers() {
    return state.players.map(function (p) {
      var logs = state.logsByPlayer[p.name] || [];
      return { name: p.name, logs: logs, latest: logs[0] || null };
    }).sort(function (a, b) {
      var at = a.latest ? a.latest.sort : 0;
      var bt = b.latest ? b.latest.sort : 0;
      return bt - at;
    });
  }

  function fillPlayerSelects() {
    var currentChest = $("#chest-player").value || "all";
    var currentBlock = $("#block-player").value || "all";
    var options = '<option value="all">Semua player</option>' + latestPlayers().map(function (p) {
      return '<option value="' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + '</option>';
    }).join("");
    $("#chest-player").innerHTML = options;
    $("#block-player").innerHTML = options;
    $("#chest-player").value = currentChest;
    $("#block-player").value = currentBlock;
  }

  function renderAll() {
    renderStats();
    renderBreakdown();
    renderLatest();
    renderRecentTable();
    renderPlayers();
    renderChestTable();
    renderBlockTable();
    if ($("#search-keyword").value || $("#search-category").value !== "all") renderSearch();
  }

  function countByCategory(logs) {
    var counts = {};
    ORDER.forEach(function (cat) { counts[cat] = 0; });
    logs.forEach(function (log) { counts[log.category] = (counts[log.category] || 0) + 1; });
    return counts;
  }

  function renderStats() {
    var counts = countByCategory(state.logs);
    $("#stat-players").textContent = formatNumber(state.players.length);
    $("#stat-logs").textContent = formatNumber(state.logs.length);
    $("#stat-chest").textContent = formatNumber((counts.take || 0) + (counts.put || 0) + (counts.chest || 0) + (counts.swap || 0));
    $("#stat-block").textContent = formatNumber((counts.break || 0) + (counts.place || 0));
  }

  function renderBreakdown() {
    var counts = countByCategory(state.logs);
    var max = Math.max.apply(null, ORDER.map(function (cat) { return counts[cat] || 0; }).concat([1]));
    $("#breakdown").innerHTML = ORDER.map(function (cat) {
      var value = counts[cat] || 0;
      var width = Math.max(4, Math.round(value / max * 100));
      return '<div class="break-row"><div class="break-name">' + escapeHtml(LABEL[cat]) + '</div><div class="bar"><span style="width:' + width + '%"></span></div><div class="break-count">' + formatNumber(value) + '</div></div>';
    }).join("");
  }

  function renderLatest() {
    var rows = latestPlayers().filter(function (p) { return p.latest; }).slice(0, 50);
    if (!rows.length) {
      $("#latest-player-list").innerHTML = '<div class="empty">Belum ada log.</div>';
      return;
    }
    $("#latest-player-list").innerHTML = rows.map(function (p) {
      var l = p.latest;
      return '<article class="latest-row"><div class="time">' + escapeHtml(l.dayDate) + '<br>' + escapeHtml(l.clock) + '</div><div class="player">' + escapeHtml(p.name) + '</div><div class="message">' + escapeHtml(l.detail) + '</div><div>' + badge(l.category) + '</div></article>';
    }).join("");
  }

  function renderRecentTable() { buildTable("#recent-table", state.logs.slice(0, 100)); }

  function renderPlayers() {
    var keyword = lower($("#player-keyword").value);
    var category = $("#player-category").value;
    var rows = latestPlayers().filter(function (p) {
      if (keyword && lower(p.name).indexOf(keyword) === -1) return false;
      if (category !== "all" && !p.logs.some(function (l) { return matchCategory(l, category); })) return false;
      return true;
    });

    if (!rows.length) {
      $("#players-grid").innerHTML = '<div class="empty">Player tidak ditemukan.</div>';
      return;
    }

    $("#players-grid").innerHTML = rows.map(function (p) {
      var l = p.latest;
      var detail = l ? l.detail : "Belum ada aktivitas.";
      var time = l ? l.dayDate + " · " + l.clock : "-";
      var cat = l ? l.category : "other";
      return '<article class="player-card" data-player="' + escapeHtml(p.name) + '"><div class="player-card-top"><h4 class="player-name">' + escapeHtml(p.name) + '</h4>' + badge(cat) + '</div><div class="player-meta"><span>' + formatNumber(p.logs.length) + ' logs</span><span>' + escapeHtml(time) + '</span></div><div class="player-last">' + escapeHtml(trim(detail, 145)) + '</div></article>';
    }).join("");

    $all(".player-card").forEach(function (card) {
      card.addEventListener("click", function () { openPlayer(card.getAttribute("data-player")); });
    });
  }

  function trim(text, max) {
    text = String(text || "");
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }

  function chestRows() {
    var keyword = lower($("#chest-keyword").value);
    var player = $("#chest-player").value;
    return state.logs.filter(function (l) {
      if (!["take", "put", "chest", "swap"].includes(l.category)) return false;
      if (player !== "all" && l.player !== player) return false;
      if (state.chestFilter === "take" && l.category !== "take") return false;
      if (state.chestFilter === "put" && l.category !== "put") return false;
      if (state.chestFilter === "swap" && l.category !== "swap") return false;
      if (state.chestFilter === "valuable" && !containsAny(lower(l.item + " " + l.raw), ["diamond", "netherite", "ancient", "emerald", "elytra", "totem", "shulker"])) return false;
      return matchesKeyword(l, keyword);
    });
  }

  function renderChestTable() { buildTable("#chest-table", chestRows()); }

  function blockRows() {
    var keyword = lower($("#block-keyword").value);
    var player = $("#block-player").value;
    return state.logs.filter(function (l) {
      if (!["break", "place"].includes(l.category)) return false;
      if (player !== "all" && l.player !== player) return false;
      if (state.blockFilter === "break" && l.category !== "break") return false;
      if (state.blockFilter === "place" && l.category !== "place") return false;
      if (state.blockFilter === "ore" && !containsAny(lower(l.item + " " + l.raw), ["ore", "ancient debris", "ancient_debris", "diamond", "emerald", "gold", "iron", "coal", "redstone", "lapis", "copper"])) return false;
      return matchesKeyword(l, keyword);
    });
  }

  function renderBlockTable() { buildTable("#block-table", blockRows()); }

  function renderSearch() {
    var keyword = lower($("#search-keyword").value);
    var category = $("#search-category").value;
    if (!keyword && category === "all") {
      $("#search-table").innerHTML = '<div class="empty">Ketik keyword dulu.</div>';
      return;
    }
    var rows = state.logs.filter(function (l) {
      if (category !== "all" && !matchCategory(l, category)) return false;
      return matchesKeyword(l, keyword);
    });
    buildTable("#search-table", rows, keyword.split(/\s+/).filter(Boolean));
  }

  function matchCategory(log, category) {
    return category === "all" ? true : log.category === category;
  }

  function matchesKeyword(log, keyword) {
    if (!keyword) return true;
    var hay = lower([
      log.player, log.dayDate, log.clock, LABEL[log.category], log.activity, log.item,
      log.amount, log.container, log.coords ? log.coords.text : "", log.detail
    ].join(" "));
    return keyword.split(/\s+/).filter(Boolean).every(function (term) {
      return hay.indexOf(term) !== -1;
    });
  }

  function buildTable(target, rows, terms) {
    var list = rows.slice(0, 650);
    if (!list.length) {
      $(target).innerHTML = '<div class="empty">Tidak ada data yang cocok.</div>';
      return;
    }

    var body = list.map(function (l) {
      return '<tr>' +
        '<td class="time">' + escapeHtml(l.dayDate) + '</td>' +
        '<td class="time">' + escapeHtml(l.clock) + '</td>' +
        '<td class="player">' + escapeHtml(l.player) + '</td>' +
        '<td>' + badge(l.category) + '<div class="detail">' + escapeHtml(l.activity) + '</div></td>' +
        '<td class="item">' + highlight(escapeHtml(l.item || "-"), terms) + '</td>' +
        '<td class="qty">' + escapeHtml(l.amount || "-") + '</td>' +
        '<td>' + escapeHtml(l.container || "-") + '</td>' +
        '<td>' + coordHtml(l.coords) + '</td>' +
        '<td><div class="detail">' + highlight(escapeHtml(l.detail), terms) + '</div></td>' +
      '</tr>';
    }).join("");

    var html = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
      '<th>Hari / Tanggal</th><th>Jam Log</th><th>Player</th><th>Aktivitas</th><th>Item / Block</th><th>Jumlah</th><th>Container</th><th>Koordinat</th><th>Detail</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';

    if (rows.length > list.length) {
      html += '<div class="empty">Menampilkan 650 dari ' + rows.length + ' log. Pakai search/filter supaya lebih spesifik.</div>';
    }
    $(target).innerHTML = html;
    bindCoordCopy();
  }

  function badge(category) {
    return '<span class="badge ' + escapeHtml(category) + '">' + escapeHtml(LABEL[category] || "Event Lain") + '</span>';
  }

  function coordHtml(coords) {
    if (!coords) return '<span class="muted">Tidak ada data</span>';
    return '<span class="coord" data-coord="' + escapeHtml(coords.text) + '" title="Klik untuk copy /tp">' + escapeHtml(coords.text) + '</span>';
  }

  function highlight(html, terms) {
    var output = html;
    (terms || []).forEach(function (term) {
      if (!term) return;
      var re = new RegExp("(" + escapeRegex(escapeHtml(term)) + ")", "ig");
      output = output.replace(re, "<mark>$1</mark>");
    });
    return output;
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function bindCoordCopy() {
    $all(".coord").forEach(function (el) {
      el.addEventListener("click", function () {
        var cmd = "/tp " + el.getAttribute("data-coord");
        copy(cmd);
        toast("Copied: " + cmd);
      });
    });
  }

  function copy(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      return;
    }
    var area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }

  function openPlayer(name) {
    state.activePlayer = name;
    $("#modal-title").textContent = name + " Logs";
    $("#modal-keyword").value = "";
    $("#modal-category").value = "all";
    $("#player-modal").classList.add("open");
    $("#player-modal").setAttribute("aria-hidden", "false");
    renderModal();
  }

  function renderModal() {
    var keyword = lower($("#modal-keyword").value);
    var category = $("#modal-category").value;
    var logs = state.logsByPlayer[state.activePlayer] || [];
    var rows = logs.filter(function (l) {
      if (category !== "all" && !matchCategory(l, category)) return false;
      return matchesKeyword(l, keyword);
    });

    var counts = countByCategory(logs);
    $("#modal-stats").innerHTML =
      '<div class="modal-stat"><span>Total</span><strong>' + formatNumber(logs.length) + '</strong></div>' +
      '<div class="modal-stat"><span>Mengambil</span><strong>' + formatNumber(counts.take || 0) + '</strong></div>' +
      '<div class="modal-stat"><span>Memasukkan</span><strong>' + formatNumber(counts.put || 0) + '</strong></div>' +
      '<div class="modal-stat"><span>Block</span><strong>' + formatNumber((counts.break || 0) + (counts.place || 0)) + '</strong></div>';

    buildTable("#modal-table", rows, keyword.split(/\s+/).filter(Boolean));
  }

  function closeModal() {
    $("#player-modal").classList.remove("open");
    $("#player-modal").setAttribute("aria-hidden", "true");
  }

  function exportRows(filename, rows) {
    if (!rows.length) {
      toast("Tidak ada data untuk export.");
      return;
    }

    var text = rows.map(function (l) {
      return [
        l.dayDate, l.clock, l.player, LABEL[l.category] || l.category,
        "item_block=" + l.item, "jumlah=" + l.amount, "container=" + l.container,
        "koordinat=" + (l.coords ? l.coords.text : "Tidak ada data"), "detail=" + l.detail
      ].join(" | ");
    }).join("\n");

    var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Export berhasil.");
  }

  function switchView(view) {
    state.activeView = view;
    $all(".nav-item").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-view") === view);
    });
    $all(".view").forEach(function (panel) {
      panel.classList.toggle("active", panel.id === "view-" + view);
    });
    var title = $('.nav-item[data-view="' + view + '"] .nav-text');
    $("#page-title").textContent = title ? title.childNodes[0].textContent.trim() : "Overview";
  }

  function bindEvents() {
    $all(".nav-item").forEach(function (btn) {
      btn.addEventListener("click", function () { switchView(btn.getAttribute("data-view")); });
    });

    $("#refresh-now").addEventListener("click", function () {
      loadAll(false).then(function () { toast("Data direfresh."); });
    });

    $("#copy-latest").addEventListener("click", function () {
      var text = latestPlayers().filter(function (p) { return p.latest; }).slice(0, 50).map(function (p) {
        var l = p.latest;
        return l.dayDate + " " + l.clock + " | " + p.name + " | " + l.detail;
      }).join("\n");
      copy(text);
      toast("Latest activity dicopy.");
    });

    $("#player-keyword").addEventListener("input", renderPlayers);
    $("#player-category").addEventListener("change", renderPlayers);
    $("#chest-keyword").addEventListener("input", renderChestTable);
    $("#chest-player").addEventListener("change", renderChestTable);
    $("#block-keyword").addEventListener("input", renderBlockTable);
    $("#block-player").addEventListener("change", renderBlockTable);

    $all("[data-chest-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.chestFilter = btn.getAttribute("data-chest-filter");
        $all("[data-chest-filter]").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        renderChestTable();
      });
    });

    $all("[data-block-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.blockFilter = btn.getAttribute("data-block-filter");
        $all("[data-block-filter]").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        renderBlockTable();
      });
    });

    $("#search-btn").addEventListener("click", renderSearch);
    $("#search-keyword").addEventListener("keydown", function (event) {
      if (event.key === "Enter") renderSearch();
    });
    $("#search-category").addEventListener("change", renderSearch);

    $("#modal-close").addEventListener("click", closeModal);
    $("#player-modal").addEventListener("click", function (event) {
      if (event.target.id === "player-modal") closeModal();
    });
    $("#modal-keyword").addEventListener("input", renderModal);
    $("#modal-category").addEventListener("change", renderModal);

    $("#export-chest").addEventListener("click", function () {
      exportRows("chest-activity.txt", chestRows());
    });

    $("#export-blocks").addEventListener("click", function () {
      exportRows("block-activity.txt", blockRows());
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeModal();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        switchView("search");
        $("#search-keyword").focus();
      }
    });
  }

  function init() {
    startClock();
    bindEvents();
    loadAll(false);
    setInterval(function () { loadAll(true); }, AUTO_REFRESH_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
