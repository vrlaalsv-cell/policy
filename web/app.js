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
  function regionOf(m) { return m.sido; }

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
  function corners(cx, cy) {
    var p = [];
    for (var i = 0; i < 6; i++) { var a = Math.PI / 180 * (60 * i - 30); p.push((cx + DRAW * Math.cos(a)).toFixed(1) + "," + (cy + DRAW * Math.sin(a)).toFixed(1)); }
    return p.join(" ");
  }

  // 정당별 반원(半円) 의석 배치도: 큰 정당부터 좌→우로 이어붙여, 여러 겹의 아치 행(row)에
  // 걸친 "쐐기" 모양으로 뭉치게 배치한다. 육각형 1개 = 의원 1명(비례대표도 동일하게 포함).
  var cellOf = {};      // memberId -> {fx,fy}
  var partySpan = {};   // party -> {mid, count} (라벨 위치용)
  var ARC_LABEL_R = 0;
  (function layout() {
    var ARC_SPACING = SIZE * 1.9;   // 행 안/행 간 최소 중심 간격
    var ARC_R0 = SIZE * 12;         // 안쪽 반지름(가운데 캡션 공간 확보)
    var rows = [], r = ARC_R0, totalCap = 0;
    while (totalCap < MEMBERS.length) {
      var cap = Math.round(Math.PI * r / ARC_SPACING) + 1;
      rows.push({ r: r, cap: cap, count: cap }); totalCap += cap; r += ARC_SPACING;
    }
    // 초과분(shortfall)은 한 행에 몰아서 자르지 않고 모든 행에 골고루 조금씩 나눠서 뺀다.
    // (한 행을 통째로 비우면 그 행의 좌석이 폭 전체에 늘어나며 정당 뭉치가 흐트러짐)
    var shortfall = totalCap - MEMBERS.length, ri = 0;
    while (shortfall > 0) {
      if (rows[ri % rows.length].count > 1) { rows[ri % rows.length].count--; shortfall--; }
      ri++;
    }
    var slots = [];
    rows.forEach(function (row) {
      var step = row.cap > 1 ? Math.PI / (row.cap - 1) : 0;
      for (var j = 0; j < row.count; j++) { slots.push({ r: row.r, angle: Math.round((Math.PI - j * step) * 1e6) / 1e6 }); }
    });
    slots.sort(function (a, b) { return (b.angle - a.angle) || (a.r - b.r); }); // 왼쪽(π) → 오른쪽(0)

    var byParty = {};
    MEMBERS.forEach(function (m) { (byParty[m.party] = byParty[m.party] || []).push(m); });
    var partyOrder = Object.keys(byParty).sort(function (a, b) { return byParty[b].length - byParty[a].length; });
    var k = 0;
    partyOrder.forEach(function (p) {
      var list = byParty[p], angles = [];
      list.forEach(function (m) {
        var s = slots[k++];
        cellOf[m.id] = { fx: s.r * Math.cos(s.angle), fy: -s.r * Math.sin(s.angle) };
        angles.push(s.angle);
      });
      partySpan[p] = { mid: (Math.max.apply(null, angles) + Math.min.apply(null, angles)) / 2, count: list.length };
    });
    ARC_LABEL_R = rows[rows.length - 1].r + SIZE * 2.5;
  })();
  function posOf(m) { var c = cellOf[m.id]; if (!c) return null; return { x: c.fx, y: c.fy }; }

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
    // 정당별 라벨 (해당 정당 쐐기의 바깥쪽)
    Object.keys(partySpan).forEach(function (p) {
      var sp = partySpan[p];
      var lx = ARC_LABEL_R * Math.cos(sp.mid) + ox, ly = -ARC_LABEL_R * Math.sin(sp.mid) + oy;
      svg += '<text class="region-label" x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '">' + partyShort(p) + " " + sp.count + "석</text>";
    });
    // 가운데 캡션
    svg += '<text class="region-label" x="' + ox.toFixed(1) + '" y="' + (SIZE * 2 + oy).toFixed(1) + '">국회의원 · 총 ' + MEMBERS.length + "석</text>";
    svg += "</svg>";

    var map = document.getElementById("map");
    map.innerHTML = svg;
    map.querySelector("svg").addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest(".hexm") : null;
      if (t) openModal(byId[t.getAttribute("data-id")]);
    });
    document.getElementById("mapTitle").textContent = "의석 배치도 · " + Object.keys(cellOf).length + "석" + (state.business === "all" ? " (정당)" : " (" + bizLabel(state.business) + " 우호도)");
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
    var termsTxt = m.terms ? m.terms + "선" : "-";
    var commTxt = (m.committee && m.committee.length) ? m.committee.join(", ") : "-";
    var h = '<div class="mhd"><div><div style="display:flex;align-items:center;gap:8px"><span class="pchip" style="background:' + pc + '">' + partyShort(m.party) + '</span><span style="font-size:19px;font-weight:800">' + m.name + '</span></div></div>' +
      '<button class="x" aria-label="닫기">×</button></div><div class="mbd">';
    h += '<div class="mprofile">' +
      '<div><span class="pl">정당</span><span class="pv">' + m.party + '</span></div>' +
      '<div><span class="pl">선거구</span><span class="pv">' + m.district + '</span></div>' +
      '<div><span class="pl">선수</span><span class="pv">' + termsTxt + '</span></div>' +
      '<div><span class="pl">소속위원회</span><span class="pv">' + commTxt + '</span></div></div>';
    h += '<div style="font-size:13px;font-weight:800;color:var(--brand);margin:4px 0 2px">사업별 우호도</div><div class="stancegrid">' +
      BIZ.map(function (b) { var s = stanceInfo(m.stance[b.id] || "unknown"); return '<div class="sg"><div class="b">' + b.label + '</div><div class="v" style="background:' + s.bg + ";color:" + s.color + '">' + s.label + "</div></div>"; }).join("") + "</div>";
    h += '<div style="font-size:13px;font-weight:800;color:var(--brand);margin:6px 0 2px">근거 발언</div>';
    if (m.quotes && m.quotes.length) {
      h += m.quotes.map(function (q) {
        var hl = (state.business !== "all" && q.biz === state.business);
        var src = q.meeting ? "📄 " + q.meeting : ((q.confer || "") + (q.date ? " · " + q.date : ""));
        var body = (q.core != null)
          ? (q.pre ? esc(q.pre) + " " : "") + "<b>" + esc(q.core) + "</b>" + (q.post ? " " + esc(q.post) : "")
          : esc(q.text || "");
        return '<div class="qt" style="' + (hl ? "border-left-color:#0f7a4d;background:#eefaf3" : "") + '"><span class="badge" style="background:#eef3fb;color:#264a7d;border-color:#d7e2f4;margin-right:6px">' + bizLabel(q.biz) + "</span>" + body +
          '<div class="qmeta">' + (src || "출처 미상") + "</div></div>";
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
    document.querySelector(".updatewrap").classList.toggle("hidden", !asm);
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
  function bizLabelC(id) { var m = { POWER: "전력", LNG: "LNG", RE: "재생E", H2: "수소", CITYGAS: "도시가스", NUCLEAR: "원전" }; return m[id] || id; }
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

  // 마지막 업데이트 시각 표시
  function updateLastUpdateTime() {
    var lastUpdate = localStorage.getItem("lastUpdateTime");
    var el = document.getElementById("lastUpdate");
    if (el) {
      if (lastUpdate) {
        var date = new Date(lastUpdate);
        var now = new Date();
        var diffMs = now - date;
        var diffMins = Math.floor(diffMs / 60000);
        var diffHours = Math.floor(diffMs / 3600000);
        var diffDays = Math.floor(diffMs / 86400000);
        var timeStr;
        if (diffMins < 1) timeStr = "방금";
        else if (diffMins < 60) timeStr = diffMins + "분 전";
        else if (diffHours < 24) timeStr = diffHours + "시간 전";
        else timeStr = diffDays + "일 전";
        el.textContent = "마지막 업데이트: " + timeStr;
      } else {
        el.textContent = "";
      }
    }
  }
  updateLastUpdateTime();

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
          localStorage.setItem("lastUpdateTime", new Date().toISOString());
          updateBtn.classList.remove("loading");
          updateBtn.disabled = false;
          updateBtn.textContent = "✓ 완료";
          updateLastUpdateTime();
          setTimeout(function () {
            updateBtn.textContent = "🔄 업데이트";
          }, 1500);
        })
        .catch(function (err) {
          localStorage.setItem("lastUpdateTime", new Date().toISOString());
          updateBtn.classList.remove("loading");
          updateBtn.disabled = false;
          updateBtn.textContent = "🔄 업데이트";
          updateLastUpdateTime();
          console.error("Update request error:", err);
        });
    };
  }

  renderViewToggle(); applyView(); renderAll();
  if (CAB) { enrichCabinet(); renderCabinetSummary(); renderCabChips(); renderCabStatements(); }
})();
