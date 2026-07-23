/* 국회·행정부 에너지 성향 대시보드 — 프론트 로직 (의원 1인 = 육각형 1개) */
(function () {
  "use strict";
  var D = window.APP_DATA;
  if (!D) { document.body.innerHTML = "<p style='padding:24px'>데이터를 불러오지 못했습니다 (data.js).</p>"; return; }

  var META = D.meta, SIDO = D.sido, MEMBERS = D.members;
  var BIZ = META.businesses.filter(function (b) { return b.id !== "all"; });
  var byId = {}; MEMBERS.forEach(function (m) { byId[m.id] = m; });

  // 이름/순서
  var SIDONAME = {}, SIDOORDER = [];
  SIDO.forEach(function (s) { SIDONAME[s.code] = s.name; SIDOORDER.push(s.code); });
  // 오프셋(col,row) → axial (odd-r). ASCII 마스크를 화면 좌표로 변환.
  function offAx(col, row) { return [col - Math.floor(row / 2), row]; }
  // ── 한반도 실루엣 마스크 (X=지역구 셀, 합계 254). 마지막 그룹은 제주(분리). ──
  var MASK = [
    "    XXXXXX",
    "   XXXXXXXXX",
    "  XXXXXXXXXXXXX",
    " XXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXX",
    " XXXXXXXXXXXXXXX",
    " XXXXXXXXXXXXXX",
    "  XXXXXXXXXXX",
    "  XXXXXXXXXX",
    "  XXXXXXXXXX",
    "  XXXXXXXXXX",
    "  XXXXXXXXXXX",
    "  XXXXXXXXXXX",
    "  XXXXXXXXXXX",
    "   XXXXXXXXXX",
    "   XXXXXXXXXX",
    "   XXXXXXXXXX",
    "   XXXXXXXXXX",
    "    XXXXXXX",
    "    XXXXXX",
    "     XXXX",
    "",
    "   XXX"
  ];
  var MASKSET = {}, MASKLIST = [];
  MASK.forEach(function (rowStr, row) {
    for (var col = 0; col < rowStr.length; col++) {
      if (rowStr.charAt(col) === "X") { var a = offAx(col, row); MASKSET[a[0] + "," + a[1]] = true; MASKLIST.push(a); }
    }
  });
  // 시도 앵커(오프셋 col,row) — 한반도 지리 배치
  var ANCHOR_OFF = {
    SEOUL: [8, 2], INCHEON: [2, 4], GYEONGGI: [7, 5], GANGWON: [14, 3],
    CHUNGNAM: [3, 9], SEJONG: [6, 9], CHUNGBUK: [9, 9], DAEJEON: [6, 11],
    GYEONGBUK: [11, 11], DAEGU: [9, 13], JEONBUK: [3, 13], GYEONGNAM: [8, 16],
    ULSAN: [12, 15], BUSAN: [10, 18], GWANGJU: [4, 18], JEONNAM: [4, 21], JEJU: [4, 24]
  };
  var ANCHOR = {};
  Object.keys(ANCHOR_OFF).forEach(function (c) { ANCHOR[c] = offAx(ANCHOR_OFF[c][0], ANCHOR_OFF[c][1]); });
  function regionOf(m) { return ANCHOR[m.sido] ? m.sido : "PROP"; }

  var state = { view: "assembly", business: "all", region: "ALL", query: "" };

  // ---------- helpers ----------
  function partyColor(p) { return (META.parties[p] && META.parties[p].color) || "#8894A6"; }
  function partyShort(p) { return (META.parties[p] && META.parties[p].short) || p; }
  function stanceInfo(l) { return META.stance[l] || META.stance.unknown; }
  function mode(arr) { var c = {}, o = []; arr.forEach(function (v) { if (c[v] == null) { c[v] = 0; o.push(v); } c[v]++; }); var b = o[0], bn = -1; o.forEach(function (k) { if (c[k] > bn) { bn = c[k]; b = k; } }); return b != null ? b : "unknown"; }
  function overallStance(m) { return mode(BIZ.map(function (b) { return m.stance[b.id] || "unknown"; })); }
  function stanceOf(m, biz) { return biz === "all" ? overallStance(m) : (m.stance[biz] || "unknown"); }
  function hexColor(m) { return state.business === "all" ? partyColor(m.party) : stanceInfo(stanceOf(m, state.business)).color; }
  function bizLabel(id) { var b = META.businesses.find(function (x) { return x.id === id; }); return b ? b.label : id; }
  // 외부(기사) 문자열은 그대로 innerHTML 에 넣지 않는다.
  var ESCMAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ESCMAP[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }

  // ---------- hex packing (axial, pointy-top) ----------
  var SIZE = 11, DRAW = SIZE * 0.9, PAD = 14;
  var DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  function ring(cq, cr, k) {
    if (k <= 0) return [[cq, cr]];
    var res = [], q = cq + DIRS[4][0] * k, r = cr + DIRS[4][1] * k;
    for (var i = 0; i < 6; i++) for (var j = 0; j < k; j++) { res.push([q, r]); q += DIRS[i][0]; r += DIRS[i][1]; }
    return res;
  }
  function px(q, r) { return { x: SIZE * Math.sqrt(3) * (q + r / 2), y: SIZE * 1.5 * r }; }
  function corners(cx, cy) {
    var p = [];
    for (var i = 0; i < 6; i++) { var a = Math.PI / 180 * (60 * i - 30); p.push((cx + DRAW * Math.cos(a)).toFixed(1) + "," + (cy + DRAW * Math.sin(a)).toFixed(1)); }
    return p.join(" ");
  }

  // 지역구: 한반도 마스크 안에서 시도 앵커부터 링 확장(큰 시도 우선) → 셀 배정.
  // 비례대표: 우측 세로 일렬.
  var cellOf = {};        // memberId -> {q,r} (지역구) 또는 {fx,fy} (비례)
  var regionCells = {};   // region -> [[q,r],...]
  (function layout() {
    var byRegion = {};
    MEMBERS.forEach(function (m) { var rg = regionOf(m); if (rg === "PROP") return; (byRegion[rg] = byRegion[rg] || []).push(m); });
    var codes = Object.keys(byRegion).sort(function (a, b) { return byRegion[b].length - byRegion[a].length; });
    var occupied = {};
    codes.forEach(function (code) {
      var a = ANCHOR[code] || [0, 0], list = byRegion[code], cells = [];
      for (var d = 0; d < 60 && cells.length < list.length; d++) {
        var rg = ring(a[0], a[1], d);
        for (var i = 0; i < rg.length && cells.length < list.length; i++) {
          var key = rg[i][0] + "," + rg[i][1];
          if (MASKSET[key] && !occupied[key]) { occupied[key] = true; cells.push(rg[i]); }
        }
      }
      regionCells[code] = cells;
      list.forEach(function (m, idx) { if (cells[idx]) cellOf[m.id] = { q: cells[idx][0], r: cells[idx][1] }; });
    });
    // 비례대표 → 우측 세로 나열 (한반도 높이에 맞춰 2~3열로 균형 배치)
    var prop = MEMBERS.filter(function (m) { return regionOf(m) === "PROP"; });
    if (prop.length) {
      var maxx = -1e9, miny = 1e9, maxy = -1e9;
      MASKLIST.forEach(function (a) { var p = px(a[0], a[1]); if (p.x > maxx) maxx = p.x; if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y; });
      var vgap = SIZE * 1.75, hgap = SIZE * 1.9;
      var perColMax = Math.max(1, Math.floor((maxy - miny) / vgap) + 1);
      var cols = Math.max(1, Math.ceil(prop.length / perColMax));   // 한반도 높이에 맞춘 열 수 (2~3)
      var perCol = Math.ceil(prop.length / cols);                    // 열별 균등 분배
      var x0 = maxx + SIZE * 3.2, y0 = miny + SIZE * 0.6;
      prop.forEach(function (m, i) {
        var col = Math.floor(i / perCol), row = i % perCol;
        cellOf[m.id] = { fx: x0 + col * hgap, fy: y0 + row * vgap };
      });
    }
  })();
  function posOf(m) { var c = cellOf[m.id]; if (!c) return null; return c.fx != null ? { x: c.fx, y: c.fy } : px(c.q, c.r); }

  // ---------- filter chips ----------
  function renderChips() {
    var host = document.getElementById("filterChips"); host.innerHTML = "";
    META.businesses.forEach(function (b) {
      var el = document.createElement("button");
      el.className = "chip" + (state.business === b.id ? " on" : "");
      el.textContent = b.label;
      el.onclick = function () { state.business = b.id; renderAll(); };
      host.appendChild(el);
    });
  }

  // ---------- map ----------
  function currentIds() {
    var s = {}; currentMembers().forEach(function (m) { s[m.id] = true; }); return s;
  }
  function renderMap() {
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    MEMBERS.forEach(function (m) {
      var p = posOf(m); if (!p) return;
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    });
    var W = (maxX - minX) + PAD * 2 + DRAW * 2, H = (maxY - minY) + PAD * 2 + DRAW * 2;
    var ox = -minX + PAD + DRAW, oy = -minY + PAD + DRAW;
    var filtering = state.region !== "ALL" || state.query.trim() !== "";
    var ids = filtering ? currentIds() : null;

    var svg = '<svg viewBox="0 0 ' + W.toFixed(0) + ' ' + H.toFixed(0) + '" role="img" aria-label="국회의원 육각 지도">';
    MEMBERS.forEach(function (m) {
      var p = posOf(m); if (!p) return;
      var dim = ids && !ids[m.id] ? " dim" : "";
      svg += '<polygon class="hexm' + dim + '" data-id="' + m.id + '" fill="' + hexColor(m) + '" points="' + corners(p.x + ox, p.y + oy) + '">' +
        '<title>' + m.name + " · " + partyShort(m.party) + " · " + m.district + "</title></polygon>";
    });
    // 지역 라벨 (셀 중심 평균)
    Object.keys(regionCells).forEach(function (code) {
      var cs = regionCells[code]; if (!cs.length) return;
      var sx = 0, sy = 0; cs.forEach(function (c) { var p = px(c[0], c[1]); sx += p.x; sy += p.y; });
      var cx = sx / cs.length + ox, cy = sy / cs.length + oy;
      svg += '<text class="region-label" x="' + cx.toFixed(1) + '" y="' + cy.toFixed(1) + '">' + SIDONAME[code] + "</text>";
    });
    // 비례대표 라벨 (세로 열 상단)
    var propList = MEMBERS.filter(function (m) { return regionOf(m) === "PROP" && cellOf[m.id]; });
    if (propList.length) {
      var c0 = cellOf[propList[0].id];
      svg += '<text class="region-label" x="' + (c0.fx + ox).toFixed(1) + '" y="' + (c0.fy - SIZE * 1.6 + oy).toFixed(1) + '">비례대표</text>';
    }
    svg += "</svg>";

    var map = document.getElementById("map");
    map.innerHTML = svg;
    map.querySelector("svg").addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest(".hexm") : null;
      if (t) openModal(byId[t.getAttribute("data-id")]);
    });
    document.getElementById("mapTitle").textContent = "전국 지도 · " + Object.keys(cellOf).length + "명" + (state.business === "all" ? " (정당)" : " (" + bizLabel(state.business) + " 우호도)");
    renderLegend();
  }

  function renderLegend() {
    var host = document.getElementById("legend"); host.innerHTML = "";
    function item(color, label) { return '<span class="lg"><span class="sw" style="background:' + color + '"></span>' + label + "</span>"; }
    var html = "";
    if (state.business === "all") {
      var present = {}; MEMBERS.forEach(function (m) { present[m.party] = true; });
      Object.keys(META.parties).forEach(function (p) { if (present[p]) html += item(META.parties[p].color, partyShort(p)); });
    } else {
      ["favor", "neutral", "oppose", "unknown"].forEach(function (k) { html += item(META.stance[k].color, META.stance[k].label); });
    }
    host.innerHTML = html;
  }

  // ---------- stats ----------
  function renderStats() {
    var list = currentMembers(), f = 0, n = 0, o = 0;
    list.forEach(function (m) { var s = stanceOf(m, state.business); if (s === "favor") f++; else if (s === "oppose") o++; else n++; });
    document.getElementById("stats").innerHTML =
      stat(list.length, "표시 의원") + stat(f, "우호", META.stance.favor.color) + stat(n, "중립", META.stance.neutral.color) + stat(o, "비우호", META.stance.oppose.color);
  }
  function stat(n, l, c) { return '<div class="stat"><div class="n"' + (c ? ' style="color:' + c + '"' : "") + ">" + n + '</div><div class="l">' + l + "</div></div>"; }

  // ---------- list ----------
  function currentMembers() {
    var q = state.query.trim();
    var list = MEMBERS.filter(function (m) {
      if (state.region !== "ALL" && regionOf(m) !== state.region) return false;
      if (q && (m.name + " " + m.party + " " + m.district).indexOf(q) < 0) return false;
      return true;
    });
    var ord = { favor: 0, neutral: 1, oppose: 2, unknown: 3 };
    list.sort(function (a, b) { return ord[stanceOf(a, state.business)] - ord[stanceOf(b, state.business)]; });
    return list;
  }
  function badge(bizId, level) {
    var s = stanceInfo(level);
    return '<span class="badge" style="background:' + s.bg + ";color:" + s.color + ";border-color:" + s.color + '33"><span class="bl">' + bizLabel(bizId) + "</span>" + s.label + "</span>";
  }
  function renderRegionSelect() {
    var sel = document.getElementById("regionSel");
    if (sel.options.length) { sel.value = state.region; return; }
    var counts = {}; MEMBERS.forEach(function (m) { counts[regionOf(m)] = (counts[regionOf(m)] || 0) + 1; });
    var html = '<option value="ALL">전체 지역 (' + MEMBERS.length + ")</option>";
    SIDOORDER.forEach(function (code) { if (counts[code]) html += '<option value="' + code + '">' + SIDONAME[code] + " (" + counts[code] + ")</option>"; });
    sel.innerHTML = html; sel.value = state.region;
    sel.onchange = function () { state.region = sel.value; renderMap(); renderStats(); renderCards(); };
  }
  function renderCards() {
    var list = currentMembers(), host = document.getElementById("cards"); host.innerHTML = "";
    document.getElementById("listCount").textContent = list.length + "명";
    document.getElementById("listTitle").textContent = "의원 목록" + (state.business !== "all" ? " · " + bizLabel(state.business) : "");
    var frag = document.createDocumentFragment();
    list.forEach(function (m) {
      var card = document.createElement("div"); card.className = "mcard";
      var pc = partyColor(m.party);
      var html = '<div class="row1"><span class="pchip" style="background:' + pc + '">' + partyShort(m.party) + '</span><span class="nm">' + m.name + "</span></div>";
      html += '<div class="meta">' + m.district + " · " + (m.committee[0] || "") + "</div>";
      if (state.business === "all") {
        html += '<div class="badges">' + BIZ.map(function (b) { return badge(b.id, m.stance[b.id] || "unknown"); }).join("") + "</div>";
      } else {
        var s = stanceInfo(m.stance[state.business] || "unknown");
        html += '<div class="bigstance"><span class="lv" style="background:' + s.bg + ";color:" + s.color + '">' + s.label + '</span><span style="font-size:12px;color:var(--muted)">' + bizLabel(state.business) + "</span></div>";
      }
      card.innerHTML = html;
      card.onclick = function () { openModal(m); };
      frag.appendChild(card);
    });
    host.appendChild(frag);
  }

  // ---------- 최근 기사 (window.NEWS_DATA — pipeline/5_collect_news.mjs 산출물) ----------
  var NEWS = window.NEWS_DATA || null;
  var NEWSMETA = (NEWS && NEWS.meta) || { days: 90, source: "", collectedAt: "" };
  var NEWSLAB = {};
  ((NEWS && NEWS.labels) || []).forEach(function (l) { NEWSLAB[l.id] = l; });
  function newsOf(m) { return (NEWS && NEWS.byMember && NEWS.byMember[m.id]) || m.news || []; }
  function newsChip(id) {
    var l = NEWSLAB[id] || { label: id, color: "#5c6b82", bg: "#eef3fb" };
    return '<span class="nlab" style="background:' + l.bg + ";color:" + l.color + '">' + esc(l.label) + "</span>";
  }
  // 사업 필터가 켜져 있으면 그 에너지원 기사를 위로. (원전은 사업 목록에 없어 필터 대상 아님)
  function newsSorted(m) {
    var list = newsOf(m).slice();
    if (state.business !== "all") {
      list.sort(function (a, b) {
        var am = (a.labels || []).indexOf(state.business) >= 0 ? 1 : 0;
        var bm = (b.labels || []).indexOf(state.business) >= 0 ? 1 : 0;
        return bm - am;
      });
    }
    return list;
  }
  function newsHTML(m) {
    var list = newsSorted(m), days = NEWSMETA.days || 90;
    var h = '<div style="display:flex;align-items:baseline;gap:8px;margin:16px 0 4px">' +
      '<span style="font-size:13px;font-weight:800;color:var(--brand)">최근 기사</span>' +
      '<span style="font-size:11.5px;color:var(--muted)">최근 ' + days + "일 · " + list.length + "건</span></div>";
    if (!list.length) {
      return h + '<div class="nwempty">최근 ' + days + "일 내 에너지(LNG·수소·원전·재생E·도시가스·전력) 관련 기사가 없습니다." +
        (NEWS ? "" : " <b>news.js 미생성</b> — <code>npm run collect:news</code> 실행 후 표시됩니다.") + "</div>";
    }
    h += list.map(function (a) {
      var hl = state.business !== "all" && (a.labels || []).indexOf(state.business) >= 0;
      var url = safeUrl(a.link);
      var t = esc(a.title);
      return '<div class="nw' + (hl ? " hl" : "") + '">' +
        '<div class="nlabs">' + (a.labels || []).map(newsChip).join("") + "</div>" +
        (url ? '<a class="nwt" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + t + "</a>"
             : '<span class="nwt">' + t + "</span>") +
        '<div class="nwm">' + esc(a.press || "") + (a.press && a.date ? " · " : "") + esc(a.date || "") + "</div></div>";
    }).join("");
    h += '<div class="nwsrc">출처: ' + esc(NEWSMETA.source === "naver" ? "네이버 뉴스 검색" : "Google 뉴스") +
      (NEWSMETA.collectedAt ? " · 수집 " + esc(NEWSMETA.collectedAt) : "") +
      " · 이름·에너지 키워드로 자동 수집한 목록이라 <b>동명이인·무관 기사</b>가 섞일 수 있습니다.</div>";
    return h;
  }

  // ---------- modal ----------
  function openModal(m) {
    if (!m) return;
    var pc = partyColor(m.party);
    var h = '<div class="mhd"><div><div style="display:flex;align-items:center;gap:8px"><span class="pchip" style="background:' + pc + '">' + partyShort(m.party) + '</span><span style="font-size:19px;font-weight:800">' + m.name + '</span></div>' +
      '<div style="font-size:12.5px;color:var(--muted);margin-top:6px">' + m.district + " · " + m.committee.join(", ") + " · " + (m.terms || "?") + "선</div></div>" +
      '<button class="x" aria-label="닫기">×</button></div><div class="mbd">';
    h += '<div style="font-size:13px;font-weight:800;color:var(--brand);margin-bottom:2px">사업별 우호도</div><div class="stancegrid">' +
      BIZ.map(function (b) { var s = stanceInfo(m.stance[b.id] || "unknown"); return '<div class="sg"><div class="b">' + b.label + '</div><div class="v" style="background:' + s.bg + ";color:" + s.color + '">' + s.label + "</div></div>"; }).join("") + "</div>";
    h += '<div style="font-size:13px;font-weight:800;color:var(--brand);margin:6px 0 2px">근거 발언</div>';
    if (m.quotes && m.quotes.length) {
      h += m.quotes.map(function (q) {
        var hl = (state.business !== "all" && q.biz === state.business);
        return '<div class="qt" style="' + (hl ? "border-left-color:#0f7a4d;background:#eefaf3" : "") + '"><span class="badge" style="background:#eef3fb;color:#264a7d;border-color:#d7e2f4;margin-right:6px">' + bizLabel(q.biz) + "</span>" + q.text +
          '<div class="qmeta">' + (q.confer || "") + " · " + (q.date || "") + " · " + (q.source && q.source !== "#" ? '<a href="' + q.source + '" target="_blank" rel="noopener">출처</a>' : "출처(샘플)") + "</div></div>";
      }).join("");
    } else { h += '<div style="font-size:13px;color:var(--muted)">등록된 발언이 없습니다.</div>'; }
    var disc = META.stancePending
      ? "ℹ 명단·지역구·정당은 <b>실제 22대 국회의원</b>(위키백과 기준)입니다. 에너지 성향은 <b>아직 분석 전(자료부족)</b> — 회의록 분석(파이프라인) 후 채워집니다."
      : "⚠ 성향 라벨은 회의록 발언을 AI가 요약·분류한 <b>참고용</b> 정보입니다. 반드시 근거 원문·출처와 함께 확인하세요." + (META.isSample ? " 현재 화면은 <b>가상 샘플 데이터</b>입니다." : "");
    h += '<div class="disc">' + disc + '</div>';
    h += newsHTML(m);            // 최하단: 최근 3개월 에너지 기사 (에너지원 라벨 포함)
    h += '</div>';
    var modal = document.getElementById("modal"); modal.innerHTML = h;
    modal.querySelector(".x").onclick = closeModal;
    document.getElementById("overlay").classList.add("on");
  }
  function closeModal(){ document.getElementById("overlay").classList.remove("on"); }

  // ---------- view toggle ----------
  function renderViewToggle() {
    Array.prototype.forEach.call(document.querySelectorAll("#viewToggle button"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-view") === state.view);
      b.onclick = function () { state.view = b.getAttribute("data-view"); applyView(); };
    });
  }
  function applyView() {
    var asm = state.view === "assembly";
    document.getElementById("assemblyView").classList.toggle("hidden", !asm);
    document.getElementById("cabinetView").classList.toggle("hidden", asm);
    document.getElementById("filterbarWrap").classList.toggle("hidden", !asm);
    renderViewToggle();
  }

  function renderAll() { renderChips(); renderRegionSelect(); renderMap(); renderStats(); renderCards(); }

  // ---------- init ----------
  var badgeEl = document.getElementById("sampleBadge");
  if (META.isSample) { badgeEl.textContent = "샘플 데이터"; badgeEl.classList.remove("hidden"); }
  else if (META.stancePending) { badgeEl.textContent = "실명단 · 성향 분석 전"; badgeEl.classList.remove("hidden"); }
  else badgeEl.classList.add("hidden");
  document.getElementById("foot").innerHTML = "데이터 갱신: " + META.updatedAt +
    (META.isSample ? " · 현재 <b>샘플</b> 데이터 (실데이터는 파이프라인 실행 후 반영)"
      : META.stancePending ? " · 실제 22대 국회의원 명단(위키백과 기준). <b>에너지 성향은 회의록 분석 후</b> 채워집니다."
        : "");
  document.getElementById("overlay").onclick = function (e) { if (e.target.id === "overlay") closeModal(); };
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  var search = document.getElementById("search");
  search.oninput = function () { state.query = search.value; renderMap(); renderStats(); renderCards(); };

  // 청와대 조직도 — 장관 렌더 (2026-07 공개 조직도, 참고용)
  var CABINET = [
    { pos: "교육부장관", who: "최교진" }, { pos: "외교부장관", who: "조현" },
    { pos: "통일부장관", who: "정동영", concurrent: true }, { pos: "법무부장관", who: "정성호", concurrent: true },
    { pos: "국방부장관", who: "안규백", concurrent: true }, { pos: "행정안전부장관", who: "윤호중", concurrent: true },
    { pos: "국가보훈부장관", who: "권오을" }, { pos: "문화체육관광부장관", who: "최휘영" },
    { pos: "농림축산식품부장관", who: "송미령" }, { pos: "산업통상부장관", who: "김정관", energy: true },
    { pos: "보건복지부장관", who: "정은경" }, { pos: "기후에너지환경부장관", who: "김성환", concurrent: true, energy: true },
    { pos: "고용노동부장관", who: "김영훈" }, { pos: "성평등가족부장관", who: "원민경" },
    { pos: "국토교통부장관", who: "김윤덕", concurrent: true }, { pos: "해양수산부장관", who: "황종우" },
    { pos: "중소벤처기업부장관", who: "공석", vacant: true }, { pos: "기획예산처장관", who: "박홍근", concurrent: true }
  ];
  (function renderCabinet() {
    var host = document.getElementById("ministers"); if (!host) return;
    host.innerHTML = CABINET.map(function (m) {
      var cls = "org-box" + (m.energy ? " energy" : "") + (m.concurrent ? " concurrent" : "") + (m.vacant ? " vacant" : "");
      return '<div class="' + cls + '"><span class="pos">' + m.pos + '</span><span class="who">' + m.who + "</span></div>";
    }).join("");
  })();

  // ── 청와대 회의록 분석 (window.CABINET_DATA) ──
  var CAB = window.CABINET_DATA || null;
  function bizLabelC(id) { var m = { LNG: "LNG", H2: "수소", RE: "재생E", CITYGAS: "도시가스", POWER: "전력" }; return m[id] || id; }
  function stmtHTML(q) {
    var s = stanceInfo(q.stance);
    var biz = (q.businesses || []).map(bizLabelC).join(", ");
    return '<div class="stmt"><div class="sh">' +
      (q.speaker ? '<span class="sp">' + q.speaker + '</span><span class="rl">' + (q.role || "") + "</span>" : "") +
      '<span class="slv" style="background:' + s.color + '">' + s.label + "</span>" +
      (biz ? '<span class="rl">[' + biz + "]</span>" : "") +
      '<span class="mt">' + (q.meeting || "") + "</span></div>" +
      '<div class="qt">“' + q.quote + '”</div>' + (q.note ? '<div class="nt">→ ' + q.note + "</div>" : "") + "</div>";
  }
  function enrichCabinet() {
    if (!CAB) return;
    var byName = {}; CAB.speakers.forEach(function (s) { byName[s.name] = s; });
    Array.prototype.forEach.call(document.querySelectorAll("#cabinetView .org-box"), function (box) {
      var whoEl = box.querySelector(".who"); if (!whoEl) return;
      var sp = byName[whoEl.textContent.trim()]; if (!sp) return;
      var chips = BIZ.filter(function (b) { return sp.stance[b.id] && sp.stance[b.id] !== "unknown"; })
        .map(function (b) { var s = stanceInfo(sp.stance[b.id]); return '<span class="ob" style="background:' + s.color + '" title="' + b.label + " " + s.label + '">' + b.label + "</span>"; }).join("");
      if (chips) { var row = document.createElement("div"); row.className = "obadges"; row.innerHTML = chips; box.appendChild(row); }
      box.classList.add("clickable");
      box.addEventListener("click", function () { openCabinetModal(sp); });
    });
  }
  function openCabinetModal(sp) {
    var h = '<div class="mhd"><div><div style="font-size:19px;font-weight:800">' + sp.name + '</div><div style="font-size:12.5px;color:var(--muted);margin-top:5px">' + (sp.role || "") + " · 회의록 발언 " + sp.count + '건</div></div><button class="x" aria-label="닫기">×</button></div><div class="mbd">';
    h += '<div style="font-size:13px;font-weight:800;color:var(--brand);margin-bottom:2px">사업별 성향</div><div class="stancegrid">' +
      BIZ.map(function (b) { var s = stanceInfo(sp.stance[b.id] || "unknown"); return '<div class="sg"><div class="b">' + b.label + '</div><div class="v" style="background:' + s.bg + ";color:" + s.color + '">' + s.label + "</div></div>"; }).join("") + "</div>";
    h += '<div style="font-size:13px;font-weight:800;color:var(--brand);margin:6px 0 4px">근거 발언 (' + sp.quotes.length + ")</div>";
    h += sp.quotes.map(stmtHTML).join("");
    h += '<div class="disc">회의록 원문 발췌 기반. 성향은 SK E&amp;S 사업 관점(우호/중립/비우호) 해석입니다.</div></div>';
    var modal = document.getElementById("modal"); modal.innerHTML = h;
    modal.querySelector(".x").onclick = closeModal;
    document.getElementById("overlay").classList.add("on");
  }
  function renderCabinetSummary() {
    if (!CAB) return; var host = document.getElementById("cabSummary"); if (!host) return;
    function cs(n, l, c) { return '<div class="cs"><div class="n"' + (c ? ' style="color:' + c + '"' : "") + ">" + n + '</div><div class="l">' + l + "</div></div>"; }
    host.innerHTML = cs(CAB.totalStatements, "발췌 발언") + cs(CAB.speakers.length, "발언자") +
      cs(CAB.stanceCount.favor || 0, "우호", META.stance.favor.color) + cs(CAB.stanceCount.neutral || 0, "중립", META.stance.neutral.color) + cs(CAB.stanceCount.oppose || 0, "비우호", META.stance.oppose.color);
  }
  var cabBiz = "all";
  function renderCabChips() {
    if (!CAB) return; var host = document.getElementById("cabBizChips"); if (!host) return; host.innerHTML = "";
    META.businesses.forEach(function (b) {
      var cnt = b.id === "all" ? CAB.totalStatements : (CAB.bizCount[b.id] || 0);
      var el = document.createElement("button"); el.className = "chip" + (cabBiz === b.id ? " on" : "");
      el.textContent = b.label + " " + cnt; el.onclick = function () { cabBiz = b.id; renderCabChips(); renderCabStatements(); };
      host.appendChild(el);
    });
  }
  function renderCabStatements() {
    if (!CAB) return; var host = document.getElementById("cabStatements"); if (!host) return;
    var list;
    if (cabBiz === "all") { var seen = {}; list = []; BIZ.forEach(function (b) { (CAB.byBusiness[b.id] || []).forEach(function (q) { var k = q.speaker + "|" + (q.quote || "").slice(0, 30); if (!seen[k]) { seen[k] = 1; list.push(q); } }); }); }
    else list = (CAB.byBusiness[cabBiz] || []).slice();
    var ord = { oppose: 0, favor: 1, neutral: 2 };
    list.sort(function (a, b) { return (ord[a.stance] - ord[b.stance]) || (a.meeting < b.meeting ? 1 : -1); });
    var cntEl = document.getElementById("cabStmtCount"); if (cntEl) cntEl.textContent = list.length + "건";
    host.innerHTML = list.map(stmtHTML).join("") || '<div style="color:var(--muted);font-size:13px">해당 사업 발언이 없습니다.</div>';
  }

  // 처음(랜딩) 화면 + ?view 딥링크
  var landing = document.getElementById("landing");
  function enterView(v) { state.view = v; if (landing) landing.classList.add("hidden"); applyView(); }
  Array.prototype.forEach.call(document.querySelectorAll("#landing .navcard"), function (c) {
    c.onclick = function () { enterView(c.getAttribute("data-view")); };
  });
  var initialView = new URLSearchParams(location.search).get("view");
  if (initialView === "cabinet" || initialView === "assembly") { state.view = initialView; if (landing) landing.classList.add("hidden"); }
  document.getElementById("homeBtn").onclick = function () { if (landing) landing.classList.remove("hidden"); };

  // 업데이트 버튼 핸들러
  var updateBtn = document.getElementById("updateBtn");
  if (updateBtn) {
    updateBtn.onclick = function () {
      if (updateBtn.classList.contains("loading")) return;
      updateBtn.classList.add("loading");
      updateBtn.textContent = "🔄 업데이트 중…";
      updateBtn.disabled = true;

      fetch("/api/update", { method: "POST" })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          updateBtn.classList.remove("loading");
          updateBtn.disabled = false;
          if (data.success) {
            updateBtn.textContent = "✓ 완료";
            setTimeout(function () {
              updateBtn.textContent = "🔄 업데이트";
              location.reload();
            }, 1500);
          } else {
            updateBtn.textContent = "❌ 실패";
            console.error("Update error:", data.error);
            setTimeout(function () { updateBtn.textContent = "🔄 업데이트"; }, 2000);
          }
        })
        .catch(function (err) {
          updateBtn.classList.remove("loading");
          updateBtn.disabled = false;
          updateBtn.textContent = "❌ 오류";
          console.error("Update request error:", err);
          setTimeout(function () { updateBtn.textContent = "🔄 업데이트"; }, 2000);
        });
    };
  }

  renderViewToggle(); applyView(); renderAll();
  if (CAB) { enrichCabinet(); renderCabinetSummary(); renderCabChips(); renderCabStatements(); }
})();
