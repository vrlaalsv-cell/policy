# pipeline — 수집·분석 (DB화)

외부 패키지 없이 Node 내장 기능만 사용합니다 (`global fetch`, node ≥ 18). 모든 스크립트는 루트 `.env` 를 읽습니다.

| 스크립트 | 입력 | 출력 | 필요 키 |
|---|---|---|---|
| `1_collect_members.mjs` | 열린국회 API | `data/members.json` | `ASSEMBLY_API_KEY` |
| `2_collect_utterances.mjs` | `data/raw/*.csv|json` | `data/utterances.json` | — |
| `3_analyze_gemini.mjs` | members + utterances | `data/analysis.json` | `GEMINI_API_KEY` |
| `4_analyze_cabinet.mjs` | `data/cabinet_minutes/*` | `data/cabinet.json` | `GEMINI_API_KEY` |
| `5_collect_news.mjs` | members (`data/members.json` 또는 `web/data.js`) | `data/news.json` + `web/news.js` | `NAVER_*` (없으면 Google 뉴스 RSS로 자동 대체) |
| `build_news_web.mjs` | `data/news.json` | `web/news.js` | — |
| `build_web_data.mjs` | data/*.json | `web/data.js` | — |
| `serve.mjs` | web/ | (HTTP 서버) | — |

### 국회(상임위 발언) 갱신

| 스크립트 | 입력 | 출력 |
|---|---|---|
| `collect_assembly_speeches.mjs` | 국회도서관 발언 빅데이터 (**인증키 불필요**) | `data/raw_speeches/*.xlsx`(원본) + `data/assembly_speeches.json` |
| `build_tag_batches.mjs` | 위 산출물 | `data/_tag/b*.json` (AI 태깅 입력) |
| *(AI 태깅)* | 위 배치 | 판정 JSON — Claude Code 워크플로, [AUTOMATION_TODO.md](../AUTOMATION_TODO.md) 참고 |
| `build_assembly_speeches.mjs` | 판정 JSON | `web/data.js` 의 `members[].quotes` / `stance` 갱신 |

```bash
node pipeline/collect_assembly_speeches.mjs            # ① 기노위·산업위 22대 전체 (증분)
node pipeline/build_tag_batches.mjs --only-new         # ② 아직 태깅 안 된 것만 배치로
                                                       # ③ AI 태깅 (Claude Code)
node pipeline/build_assembly_speeches.mjs <판정.json> --dry   # ④ --dry 로 먼저 확인
node pipeline/build_ai_input.mjs && node pipeline/build_ai.mjs  # ⑤ AI 종합분석 갱신
```

- **원본 xlsx 는 PC 에만** (`data/raw_speeches/`, gitignore). 정규화·판정 결과는 커밋해서 NAS 로.
- ①은 이미 받은 배치를 건너뛴다. 주기적으로 다시 돌리면 새 회의분만 받는다.
- ④는 인용문이 원문에 실제로 있는지, 기존 발언과 겹치지 않는지 검사해 걸러낸다.
  **기존 발언(다른 상임위·국정감사분)은 보존**한다 — 이번 수집은 두 위원회만이라 덮으면 나머지가 사라진다.
- 함정(한 자리 월·일, 필리버스터 컬럼 밀림, 발언내용1~7 분할 등)은 `node pipeline/findings.mjs 발언` 참고.

### 청와대(국무·차관회의) 갱신

| 스크립트 | 입력 | 출력 |
|---|---|---|
| `update-cabinet.mjs` | 행정안전부 게시판 | `data/cabinet_minutes/*.pdf` + `data/cabinet_minutes_index.json` |
| `extract_minutes.py` | 위 PDF | `data/_cab_minutes_raw.json` (발언 원문) |
| *(AI 판정)* | 위 원문 | 판정 JSON — 지금은 Claude Code 워크플로, [AUTOMATION_TODO.md](../AUTOMATION_TODO.md) 참고 |
| `merge_cabinet_judged.mjs` | 판정 JSON + 원문 | `data/_cab_results.json` (기존 보존·중복 차단) |
| `build_cabinet2.mjs` | `_cab_results.json` | `data/cabinet.json` + `web/cabinet.js` |

```bash
node pipeline/update-cabinet.mjs                 # ① 아직 안 받은 회의록 PDF 받기
python pipeline/extract_minutes.py               # ② PDF → 발언 원문
                                                 # ③ AI 판정 (Claude Code)
node pipeline/merge_cabinet_judged.mjs <판정.json> data/_cab_minutes_raw.json --dry   # ④ 먼저 --dry 로 확인
node pipeline/build_cabinet2.mjs && node pipeline/build_ai.mjs                        # ⑤ 빌드
```

- **PDF 원본은 PC에만 둔다**(`.gitignore`). 추출·판정 결과는 전부 커밋해서 NAS 로 보낸다 —
  PDF 없이도 재판정·재빌드가 되게.
- ④는 인용문이 원문에 실제로 있는지, 목차 찌꺼기가 섞이지 않았는지, 기존 발언과 겹치지 않는지를
  검사해 걸러낸다. **`--dry` 로 먼저 확인**하고 실행할 것.
- ⑤에서 `build_cabinet2` 는 `ai` 필드를 지우므로 **반드시 `build_ai.mjs` 를 이어서** 돌린다.

> ⚠ `extract_minutes.py` 는 pdfplumber 가 필요하다(`pip install pdfplumber`). 회의록 PDF 의 함정
> — 2단 조판, 불릿 문자 불일치(U+110B vs U+3147), 차관회의의 의안심의 형식 — 은 스크립트 주석과
> [AUTOMATION_TODO.md](../AUTOMATION_TODO.md) 에 정리돼 있다.

## 최근 기사 수집 (모달 최하단 · 에너지원 라벨)

```bash
npm run collect:news                                  # ① 기사 목록 (최근 90일 · 의원당 5건)
npm run fetch:excerpts                                # ② 기사마다 원문 링크 + 발췌 1~2줄
node pipeline/5_collect_news.mjs --days=180 --per=8    # 기간·건수 조정
node pipeline/5_collect_news.mjs --only=김성환          # 한 명만 (테스트)
node pipeline/5_collect_news.mjs --source=naver        # 소스 강제 (auto|naver|google)
npm run build:news                                    # 재수집 없이 web/news.js 만 다시 생성
```

- **소스**: `.env` 에 `NAVER_CLIENT_ID/SECRET` 이 있으면 네이버 검색 API, 없으면 **Google 뉴스 RSS**(키 불필요).
  ⚠ Google RSS 는 이용약관상 *개인용 피드 리더* 용도로 제한 — 사내/상업 배포본은 `--source=naver` 를 쓰세요.
- **라벨**: `lib/news_labels.mjs` 의 키워드로 제목에서 `원전·수소·재생E·LNG·도시가스·전력` 을 태깅.
  키워드가 하나도 없으면 "에너지 기사 아님"으로 버립니다(정밀도 우선). 라벨 색도 이 파일에서 나옵니다.
- **한계**: 동명이인을 구분할 수 없습니다. `의원/정당/지역구` 단서가 있는 기사를 위로 정렬(`strong`)하고,
  나머지에는 화면에 "동명이인 확인" 표시를 답니다.
- 산출물 `web/news.js` 는 `web/data.js` 와 **분리**돼 있어 성향 분석 작업과 충돌하지 않습니다.

### 발췌(`6_fetch_excerpts.mjs`)가 하는 일

1. Google 뉴스 링크(리다이렉트 페이지)를 **실제 언론사 기사 URL** 로 복원 — 화면 링크도 이걸 쓴다.
2. 기사에서 `og:description`(리드 문단)을 가져오고, 없으면 본문에서 **키워드가 든 문장**을 고른다.
   네비게이션·저작권 문구는 걸러내고 220자로 자른다.
3. 본문까지 보고 **오탐 제거** — 동명이인 스포츠 기사, `전력질주·전심전력` 같은 全力(동음이의).
4. 화면 강조용 키워드(`hl`)를 저장 → 대시보드에서 그 단어만 굵게 표시.

```bash
node pipeline/6_fetch_excerpts.mjs --force      # 전부 다시
node pipeline/6_fetch_excerpts.mjs --limit=20   # 앞 20건만 (테스트)
```

⚠ 링크 복원은 `news.google.com` 내부 API 를 이용한다. Google 이 바꾸면 복원만 실패하고
기사 목록 자체는 그대로 남는다(발췌가 비어 있으면 제목만 표시). 네이버 소스로 수집했다면
`link` 가 이미 원문이라 이 단계를 건너뛴다.

## 발언 데이터(2단계) 준비 방법
1. 국회도서관 **발언 빅데이터**(dataset.nanet.go.kr)에서 발언 단위 EXCEL/CSV 다운로드
2. `data/raw/` 에 저장 (열: 발언자 / 발언내용 / 회의일자)
3. `npm run collect:utterances` — 에너지 키워드로 사전 필터하여 발언자별로 정리
   - 보조: 공공데이터포털 `ProceedingInfoService` 회의록 전문 → `◯이름 직위` 정규식 분해(TODO 위치 표시됨)

## 실시간/증분 갱신
```bash
node pipeline/2_collect_utterances.mjs --since=2026-01-01   # 신규 회의만
node pipeline/3_analyze_gemini.mjs --only-new               # 신규 의원/변경분만 재분석
node pipeline/build_web_data.mjs
```
스케줄러(GitHub Actions/cron)로 주기 실행하면 자동 갱신됩니다.

## 비용 메모 (Gemini)
- `3_analyze_gemini.mjs` 는 현재 **동기 generateContent** 호출입니다.
- 300명 1차 전체 배치는 **Batch API(50% 할인)** 로 전환 권장 — `lib/gemini.mjs` 에 TODO 표시.
- 절감: 발언 사전 필터(키워드), 의원당 상위 N개 발언 컷, JSON 스키마 강제 + `maxOutputTokens` 캡, thinking off.
