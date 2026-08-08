# 국무회의·차관회의 회의록 PDF → 발언자별 발언 블록 추출
#   출력: data/_cab_minutes_raw.json  { records:[{ meeting, date, speaker, role, text }] }
#   이 결과를 AI 로 판정해 data/_cab_results.json 에 합친 뒤 build_cabinet2.mjs 로 빌드한다.
#
# 실행: python pipeline/extract_minutes.py [--src <PDF폴더>] [--out <json>]
#   기본 src = data/cabinet_minutes  (update-cabinet.mjs 가 내려받는 곳)
#
# ⚠ 회의록 PDF 는 대부분 2단(두 칼럼) 조판이다. pdfplumber 의 extract_text() 를 그냥 쓰면
#   좌우 칼럼을 한 줄로 훑어 문장이 뒤섞인다("...첫 번째 공동체가 지켜지기 위해서..." 처럼).
#   그래서 페이지 가운데에 '어떤 단어에도 안 덮이는 세로 빈띠(거터)'가 있는지 재서 판별한다.
#   실측(2026-06 회의록 7건): 1단 페이지 거터 0~1.2% · 2단 페이지 4.5~9.6% → 기준 3%.
import argparse
import glob
import json
import os
import re
from collections import Counter

import pdfplumber

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

KW = re.compile(
    r"에너지|전력|전기|발전소|발전|송전|계통|재생|태양광|풍력|원전|원자력|SMR|수소|LNG|가스|"
    r"석유|유가|탄소|기후|온실가스|전기요금|한전|RE100|무탄소|CFE|전력망|배출권"
)

# 발언자 줄: 불릿 + 직위 + 이름. 직위가 반드시 직위어로 끝나야 본문 불릿을 오탐하지 않는다.
TITLE = r"(?:대통령|국무총리|총리|부총리|장관|차관|실장|위원장|처장|청장|본부장|사무총장|차장|부위원장|시장|지사|원장|총장)"
SPEAKER = re.compile(rf"^[ㅇoO○●•]\s*(?P<role>[가-힣A-Za-z0-9\s·겸제]{{2,28}}{TITLE})\s+(?P<name>[가-힣]{{2,4}})\s*$")
BULLET = re.compile(r"^[ㅇoO○●•]")
SECTION = re.compile(r"^▢")
PRES = re.compile(r"^▢\s*(모두\s*말씀|마무리\s*말씀|당부\s*말씀)")
PAGENO = re.compile(r"-\s*\d+\s*-")

GUTTER_MIN = 0.03


def page_lines(page):
    """중앙에 거터가 있으면 2단으로 보고 좌/우 칼럼을 따로 읽는다."""
    words = page.extract_words()
    if len(words) < 30:
        return (page.extract_text() or "").split("\n"), False

    W = page.width
    lo, hi = W * 0.33, W * 0.67
    n = int(hi - lo) + 1
    cov = bytearray(n)
    for w in words:
        a = max(int(w["x0"] - lo), 0)
        b = min(int(w["x1"] - lo) + 1, n)
        for i in range(a, b):
            cov[i] = 1
    best = cur = end = 0
    for i, c in enumerate(cov):
        cur = 0 if c else cur + 1
        if cur > best:
            best, end = cur, i
    left = sum(1 for w in words if w["x1"] <= W * 0.5)
    right = sum(1 for w in words if w["x0"] >= W * 0.5)

    if best / W >= GUTTER_MIN and left > 20 and right > 20:
        cut = lo + end - best / 2  # 빈띠 한가운데가 분단선
        out = []
        for x0, x1 in ((0, cut), (cut, W)):
            out.extend(((page.crop((x0, 0, x1, page.height)).extract_text()) or "").split("\n"))
        return out, True
    return (page.extract_text() or "").split("\n"), False


def meeting_of(path):
    """파일명 '260623 제27회 국무회의록(청와대).pdf' → ('제27회 국무회의 (2026.06.23)', '2026-06-23')"""
    b = os.path.basename(path)
    m = re.match(r"(\d{2})(\d{2})(\d{2})\s*제(\d+)회\s*(국무회의|차관회의)", b)
    if not m:
        return b, None
    yy, mm, dd, no, kind = m.groups()
    return f"제{no}회 {kind} (20{yy}.{mm}.{dd})", f"20{yy}-{mm}-{dd}"


def extract(src, out_path, since=None):
    records, rejected = [], Counter()
    twocol = total = 0

    for f in sorted(glob.glob(os.path.join(src, "*.pdf"))):
        meeting, date = meeting_of(f)
        if since and date and date < since:
            continue
        with pdfplumber.open(f) as pdf:
            lines = []
            for p in pdf.pages:
                ls, two = page_lines(p)
                total += 1
                twocol += 1 if two else 0
                lines.extend(ls)

        state = {"speaker": None, "role": None, "buf": []}

        def flush():
            sp, role, buf = state["speaker"], state["role"], state["buf"]
            state["buf"] = []
            if not sp or not buf:
                return
            text = re.sub(r"\s+", " ", PAGENO.sub(" ", " ".join(x.strip() for x in buf))).strip()
            if len(text) < 60:
                rejected["짧음"] += 1
                return
            if not KW.search(text):
                rejected["에너지 무관"] += 1
                return
            records.append({"meeting": meeting, "date": date, "speaker": sp, "role": role or "", "text": text[:2200]})

        for ln in lines:
            s = ln.strip()
            if not s:
                continue
            if SECTION.match(s):
                flush()
                # 대통령 말씀 섹션엔 발언자 줄이 따로 없다
                state["speaker"], state["role"] = ("이재명", "대통령") if PRES.match(s) else (None, None)
                continue
            m = SPEAKER.match(s)
            if m:
                flush()
                state["speaker"] = m.group("name")
                state["role"] = re.sub(r"\s+", " ", m.group("role")).strip()
                continue
            if BULLET.match(s) and state["role"] != "대통령":
                flush()  # 발언자가 아닌 일반 불릿 → 현재 화자 블록 종료
                state["speaker"], state["role"] = None, None
                continue
            if state["speaker"]:
                state["buf"].append(s)
        flush()

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({"records": records}, fh, ensure_ascii=False, indent=1)

    # 한글 stdout 이 cp949 로 깨지는 환경이 있어 요약은 ASCII 로만 찍는다
    print(f"OK {len(records)} records -> {out_path}")
    print(f"   2-column pages {twocol}/{total} / dropped {dict(rejected)}")
    for k, v in sorted(Counter(r["meeting"] for r in records).items()):
        print(f"   {v:>3}  {k}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(ROOT, "data", "cabinet_minutes"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "_cab_minutes_raw.json"))
    ap.add_argument("--since", help="YYYY-MM-DD 이후 회의만")
    a = ap.parse_args()
    extract(a.src, a.out, a.since)
