#!/usr/bin/env python3
"""회의록 PDF → 무필터 문단 텍스트 (코퍼스 DB 적재용)

    python pipeline/extract_pdf_text.py --src C:/AI/_corpus/cabinet_raw --since 2025-06-05
    (기본 출력: C:/AI/_corpus/extracted/cabinet_pdf_text.json — 공용이라 다른 프로젝트도 그대로 쓴다)

🔴 `extract_minutes.py` 와 무엇이 다른가
   그쪽은 **SK E&S 전용**이다 — 발언자 블록으로 자르고 **에너지 키워드로 걸러서**(KW.search)
   에너지와 무관한 발언을 버린다. 그룹사 버전은 반도체·통신·제약도 봐야 하므로 그걸 쓰면 안 된다.
   여기서는 **거르지 않고 문단 그대로** 뽑는다. 분류는 나중에 회사별 AI 판정이 한다.

✅ 2단 조판 처리 로직은 `extract_minutes.py` 의 검증된 것을 그대로 가져왔다.
   회의록 591페이지 중 253페이지가 2단이라, 그냥 뽑으면 좌우가 뒤섞여 문장이 깨진다.
   (GUTTER_MIN=0.03 — 실측: 1단 0~1.2% / 2단 4.5~9.6%)
"""
import argparse
import json
import os
import re
import sys
import glob

import pdfplumber

GUTTER_MIN = 0.03
PAGENO = re.compile(r"-\s*\d+\s*-")


def page_lines(page):
    """중앙에 거터가 있으면 2단으로 보고 좌/우 칼럼을 따로 읽는다. (extract_minutes.py 와 동일 로직)"""
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
        cut = lo + end - best / 2
        out = []
        for x0, x1 in ((0, cut), (cut, W)):
            out.extend(((page.crop((x0, 0, x1, page.height)).extract_text()) or "").split("\n"))
        return out, True
    return (page.extract_text() or "").split("\n"), False


def file_date(name):
    m = re.match(r"(\d{2})(\d{2})(\d{2})", os.path.basename(name))
    return f"20{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else ""


def meeting_of(path):
    b = os.path.basename(path)
    m = re.match(r"(\d{2})(\d{2})(\d{2})\s*제(\d+)회\s*(국무회의|차관회의)", b)
    if not m:
        return re.sub(r"\.pdf$", "", b, flags=re.I)
    yy, mm, dd, no, kind = m.groups()
    return f"제{no}회 {kind} (20{yy}-{mm}-{dd})"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="C:/AI/_corpus/cabinet_raw")
    ap.add_argument("--out", default="C:/AI/_corpus/extracted/cabinet_pdf_text.json",
                    help="기본값은 공용 코퍼스 폴더 — 다른 프로젝트도 그대로 쓴다")
    ap.add_argument("--since", default="", help="YYYY-MM-DD 이후 회의만 (정권 경계 필터)")
    a = ap.parse_args()

    files = sorted(glob.glob(os.path.join(a.src, "*.pdf")))
    if a.since:
        files = [f for f in files if not file_date(f) or file_date(f) >= a.since]
    docs, twocol, total, err = [], 0, 0, 0

    for i, f in enumerate(files, 1):
        try:
            paras = []
            with pdfplumber.open(f) as pdf:
                for page in pdf.pages:
                    total += 1
                    lines, is2 = page_lines(page)
                    if is2:
                        twocol += 1
                    for ln in lines:
                        s = re.sub(r"\s+", " ", PAGENO.sub(" ", ln)).strip()
                        if s:
                            paras.append(s)
            docs.append({"file": os.path.basename(f), "meeting": meeting_of(f),
                         "date": file_date(f), "paragraphs": paras})
        except Exception as e:  # 한 파일이 깨져도 전체를 멈추지 않는다
            err += 1
            print(f"  FAIL {os.path.basename(f)}: {e}", file=sys.stderr)
        if i % 10 == 0 or i == len(files):
            print(f"\r  {i}/{len(files)}", end="", file=sys.stderr)

    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump({"docs": docs}, fh, ensure_ascii=False)
    # 한글 stdout 이 cp949 로 깨지는 환경이 있어 요약은 ASCII 로만 찍는다
    n = sum(len(d["paragraphs"]) for d in docs)
    print(f"\nOK {len(docs)} files / {n} paragraphs -> {a.out}")
    print(f"   2-column pages {twocol}/{total} / failed {err}")


if __name__ == "__main__":
    main()
