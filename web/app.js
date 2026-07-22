/* 국회·행정부 에너지 성향 대시보드 — 프론트 로직 (의원 1인 = 육각형 1개) */
(function () {
  "use strict";
  var D = window.APP_DATA;
  if (!D) { document.body.innerHTML = "<p style='padding:24px'>데이터를 불러오지 못했습니다 (data.js).</p>"; return; }

  var META = D.meta, SIDO = D.sido, MEMBERS = D.members;
  var BIZ = META.businesses.filter(function (b) { return b.id !== "all"; });
  var byId = {}; MEMBERS.forEach(function (m) { byId[m.id] = m; });

  // 앵커(시도 q,r) 및 이름/순서
  var ANCHOR = {}, SIDONAME = {}, SIDOORDER = [];
  SIDO.forEach(function (s) { ANCHOR[s.code] = [s.q, s.r]; SIDONAME[s.code] = s.name; SIDOORDER.push(s.code); });
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

  // 각 의원에게 셀(q,r) 배정 — 모든 시도 앵커에서 링을 동시 확장(다중 소스).
  // 같은 반경(d)에서 지역별로 가장 가까운 빈 셀을 차지 → 빈틈 없이 맞물린 연결 카토그램.
  var cellOf = {};        // memberId -> {q,r}
  var regionCells = {};   // region -> [[q,r],...]
  (function layout() {
    var byRegion = {};
    MEMBERS.forEach(function (m) { var rg = regionOf(m); if (rg === "PROP") return; (byRegion[rg] = byRegion[rg] || []).push(m); });
    var codes = Object.keys(byRegion), occupied = {}, remaining = {};
    codes.forEach(function (c) { regionCells[c] = []; remaining[c] = byRegion[c].length; });
    for (var d = 0; d < 140; d++) {
      var anyLeft = false;
      for (var ci = 0; ci < codes.length; ci++) {
        var code = codes[ci]; if (remaining[code] <= 0) continue; anyLeft = true;
        var a = ANCHOR[code] || [0, 0], cells = ring(a[0], a[1], d);
        for (var i = 0; i < cells.length && remaining[code] > 0; i++) {
          var key = cells[i][0] + "," + cells[i][1];
          if (!occupied[key]) { occupied[key] = true; regionCells[code].push(cells[i]); remaining[code]--; }
        }
      }
      if (!anyLeft) break;
    }
    codes.forEach(function (code) {
      byRegion[code].forEach(function (m, idx) { var c = regionCells[code][idx]; if (c) cellOf[m.id] = { q: c[0], r: c[1] }; });
    });
  })();

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
      var c = cellOf[m.id]; if (!c) return; var p = px(c.q, c.r);
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    });
    var W = (maxX - minX) + PAD * 2 + DRAW * 2, H = (maxY - minY) + PAD * 2 + DRAW * 2;
    var ox = -minX + PAD + DRAW, oy = -minY + PAD + DRAW;
    var filtering = state.region !== "ALL" || state.query.trim() !== "";
    var ids = filtering ? currentIds() : null;

    var svg = '<svg viewBox="0 0 ' + W.toFixed(0) + ' ' + H.toFixed(0) + '" role="img" aria-label="국회의원 육각 지도">';
    MEMBERS.forEach(function (m) {
      var c = cellOf[m.id]; if (!c) return; var p = px(c.q, c.r);
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
    svg += "</svg>";

    var map = document.getElementById("map");
    map.innerHTML = svg;
    map.querySelector("svg").addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest(".hexm") : null;
      if (t) openModal(byId[t.getAttribute("data-id")]);
    });
    document.getElementById("mapTitle").textContent = "전국 지도 · 지역구 " + Object.keys(cellOf).length + "명" + (state.business === "all" ? " (정당)" : " (" + bizLabel(state.business) + " 우호도)");
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
    h += '<div class="disc">' + disc + '</div></div>';
    var modal = document.getElementById("modal"); modal.innerHTML = h;
    modal.querySelector(".x").onclick = closeModal;
    document.getElementById("overlay").classList.add("on");
  }
  function closeModal() { document.getElementById("overlay").classList.remove("on"); }

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

  // 진입 뷰: URL ?view=assembly|cabinet (기본 assembly). 랜딩페이지의 국회/청와대 카드에서 연결됨.
  var initialView = new URLSearchParams(location.search).get("view");
  if (initialView === "cabinet" || initialView === "assembly") state.view = initialView;
  document.getElementById("homeBtn").onclick = function () { window.location.href = document.referrer || "/"; };

  renderViewToggle(); applyView(); renderAll();
})();
