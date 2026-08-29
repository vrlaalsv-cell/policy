# pipeline — 수집·분석 (DB화)

외부 패키지 없이 Node 내장 기능만 사용합니다 (`global fetch`, node ≥ 18). 모든 스크립트는 루트 `.env` 를 읽습니다.

## 📡 데이터 출처 (전부 무료·무인증 — 다른 사람이 자기 크레딧으로 수집해도 됨)

이 표에 없는 새 출처를 찾으면 **여기 먼저 한 줄 추가**할 것(재조사 방지 원칙, 상위 `C:\AI\CLAUDE.md` 참고).

| 데이터 | 출처(기관/사이트) | URL | 인증 | 수집 스크립트 |
|---|---|---|---|---|
| 국회 상임위 회의록 발언 | 국회도서관 발언 빅데이터 | `https://dataset.nanet.go.kr/content?...&orgId=NAM&facetDaeNum=22`(목록, 서버렌더 HTML) → `/content/down/ajax`(POST, xlsx 생성) → `/content/down/file?fid=...`(GET, 다운로드) | **불필요** | `collect_assembly_speeches.mjs` — 정확한 쿼리 파라미터·함정은 `data/findings.json`(`id: nanet-speech-bigdata`) |
| 국무회의·차관회의 회의록 PDF | 행정안전부(행안부) 국무회의록 게시판 | `https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardList.do?bbsId=BBSMSTR_000000000430` | **불필요** | `update-cabinet.mjs` (`--pages=N`으로 더 과거까지, `--all`로 인덱스 무시 전량) |
| 국회의원 명단·기본정보 | 열린국회정보 Open API | `https://open.assembly.go.kr` | **API 키 필요**(`ASSEMBLY_API_KEY`) | `1_collect_members.mjs` |
| 의원별 최근 기사 | Google 뉴스 RSS(기본) 또는 네이버 뉴스 검색(키 있으면 우선) | Google: `https://news.google.com/rss/search` / 네이버: `https://openapi.naver.com/v1/search/news.json` | Google=불필요, 네이버=`NAVER_CLIENT_ID/SECRET` | `5_collect_news.mjs` |

⚠ **행안부 다운로드는 최근분만 된다(실측 2026-08-09)** — 2026-01-23 이전(2025-07~2026-01-20) 회의록은
목록엔 뜨지만 다운로드 요청이 전부 `HTTP 400`. 원인 미규명, `data/findings.json`(dead_ends)에 기록됨.
그 구간 PDF를 이미 받아 둔 적이 있다면(이 PC에 없어도) **지우지 말고 보관**해서 팀과 공유하면 재수집이 준다.

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

### 🔎 원문 DB (corpus.db) — 파일 안 열고 바로 검색

**"할 때마다 파일 열어서 읽는" 걸 없애는 도구.** 원본(`C:\AI\_corpus\*_raw/`)을 SQLite+FTS5 로 만들어 둔다.

```bash
node pipeline/build_corpus_db.mjs                  # 원본 → corpus.db (증분: 이미 넣은 파일은 건너뜀)
node pipeline/build_corpus_db.mjs --stats          # 현황만
node pipeline/corpus_query.mjs "반도체 AND 수출규제"           # 발언 검색
node pipeline/corpus_query.mjs "수소" --in=minutes             # 회의록 문단 검색
node pipeline/corpus_query.mjs "HBM OR 고대역폭" --json=out.json   # 후보 저장(AI 판정 입력)
```

| 스크립트 | 역할 |
|---|---|
| `extract_hwpx.mjs` | HWPX → 문단 텍스트. **Node 내장만(의존성 0)**, 파이썬 불필요 |
| `lib/parse_speech_xlsx.mjs` | 발언 xlsx 파서(함정 3종 방어). 수집기·DB빌더가 공유 |
| `build_corpus_db.mjs` | 원본 → `_corpus/corpus.db` (SQLite+FTS5, 증분) |
| `corpus_query.mjs` | 전문검색 · 후보 추출 |

- 🔴 **데이터 범위를 넘기지 말 것** — 넓히면 정보가 느는 게 아니라 **오염된다.**
  - 국회 발언 = **22대만**(2024-05-30~). 수집기가 `facetDaeNum=22` + 시작일로 이중 강제.
  - 회의록 = **이재명 정부만**(2025-06-05~). `--minutes-since` 기본값이 그 이전을 DB 에서 제외한다.
    경계 근거: 주재자 표기가 `250528`까지 대통령권한대행 → `250605`부터 대통령.
    ⚠ **총리 기준으로 자르면 안 된다** — 김민석 총리는 250705부터라 6월분이 통째로 빠진다.
- **`node:sqlite` 는 Node 22.5+ 내장** — npm 설치도 네이티브 빌드도 없다(NAS 에서도 그대로).
- FTS5 문법: `A AND B` · `A OR B` · `A NOT B` · `"연속 구절"` · `접두사*`
- ⚠️ **`.hwp`(구형) 은 제외**된다 — `.hwpx`(ZIP+XML)와 달리 OLE 바이너리라 포맷이 다르다.
  실측 122개, 전부 2021~2022년이고 대체본 없음.
- `corpus.db` 는 **파생물이라 백업 대상이 아니다.** 백업할 건 `_corpus/*_raw/` 원본.

### 국회(상임위 발언) 갱신

| 스크립트 | 입력 | 출력 |
|---|---|---|
| `collect_assembly_speeches.mjs` | 국회도서관 발언 빅데이터 (**인증키 불필요**) | `data/raw_speeches/*.xlsx`(원본) + `data/assembly_speeches.json` |
| `build_tag_batches.mjs` | 위 산출물 | `data/_tag/b*.json` (AI 태깅 입력) |
| *(AI 태깅)* | 위 배치 | 판정 JSON — Claude Code 워크플로, [AUTOMATION_TODO.md](../AUTOMATION_TODO.md) 참고 |
| `build_assembly_speeches.mjs` | 판정 JSON | `web/data.js` 의 `members[].quotes` / `stance` 갱신 |

```bash
node pipeline/collect_assembly_speeches.mjs             # ① 기본 위원회(기후에너지환경노동위·산업통상자원중소벤처기업위) 22대 전체 (증분)
node pipeline/collect_assembly_speeches.mjs --committees=<위원회명,...> --by-keyword   # ①' 그 외 위원회
node pipeline/build_tag_batches.mjs --only-new [--committees=<위원회명,...>]   # ② 아직 태깅 안 된 것만 배치로
                                                       # ③ AI 태깅 (Claude Code)
node pipeline/build_assembly_speeches.mjs <판정.json> [--committees=<위원회명,...>] --dry   # ④ --dry 로 먼저 확인
node pipeline/build_ai_input.mjs --todo --batch=8       # ⑤ AI 종합분석 — 근거가 바뀐 사람만 배치로
                                                       # ⑥ wf_ai_verified.js 워크플로 (생성 + 근거 검증)
node pipeline/collect_ai.mjs <워크플로결과.json>        # ⑦ 증분 병합 (덮어쓰지 않는다)
node pipeline/build_ai.mjs                             # ⑧ web/data.js·cabinet.js 에 반영
```

- ⭐ **⑤는 `--todo` 를 쓸 것.** 인물별 근거(성향·발언·기사) payload 를 해시해 `_ai_results.json` 에 같이
  저장해 두고, 지금 해시와 같으면 건너뛴다. 기사는 하루 5번 갱신되지만 **사람의 성향이 하루에
  다섯 번 바뀌지는 않는다** — 갱신 여부가 아니라 **그 사람에게 실제로 들어가는 근거가 달라졌는지**가 기준이다.
  (플래그 없이 돌리면 근거가 그대로인 사람까지 전원 재생성한다.)
- ⭐ **⑥은 `wf_ai.js` 가 아니라 `wf_ai_verified.js`** — 생성 후 근거 기반 적대 검증이 붙어 있다.
  증분 대상은 대개 발언 1~2건짜리 인물이라 AI 가 부풀리기 쉽다(2026-08-27 실측: 23명 중 2명 탈락·재생성).
- 🔴 **⑦을 건너뛰고 결과 파일을 직접 복사하지 말 것.** `collect_ai.mjs` 가 key 기준 증분 병합 + 근거 해시
  기록을 같이 한다. 해시가 안 붙으면 다음 `--todo` 가 그 사람을 또 돌린다.

- **원본 xlsx 는 PC 에만** (`data/raw_speeches/`, gitignore). 정규화·판정 결과는 커밋해서 NAS 로.
- ①은 이미 받은 배치를 건너뛴다. 주기적으로 다시 돌리면 새 회의분만 받는다.
- ⭐ **②는 `data/_assembly_tagged.json` 에 이미 판정이 있는 발언을 통째로 건너뛴다**(2026-08-12).
  예전엔 화면에 실린 **채택분만** 제외해서, 기각된 판정 7,764건이 증분 때마다 다시 AI 로 갔다.
  지금은 증분에서 새 발언이 없으면 `0건 → 0배치` 가 나오고 **AI 태깅 단계를 아예 건너뛰면 된다.**
- ⭐ 판정을 되붙일 때는 **내용 기반 안정 키**(`lib/tagkey.mjs`)로 맞춘다 — 배치 순번(id)이 아니다.
  그래서 ②·④에 `--committees=` 를 다르게 줘도, 수집이 중간에 늘어도 엉뚱한 발언에 붙지 않는다.
  (예전엔 필터를 정확히 재현해야만 맞는 구조라 늘 조심해야 했다. 옛 판정 JSON 은 자동 폴백된다.)
- ④는 인용문이 원문에 실제로 있는지, 기존 발언과 겹치지 않는지 검사해 걸러낸다.
  **기존 발언(다른 상임위·국정감사분)은 보존**한다 — 위원회 단위로 덧붙이는 구조라 한 번에 다 갱신할 필요 없다.
- 함정(한 자리 월·일, 필리버스터 컬럼 밀림, 발언내용1~7 분할 등)은 `node pipeline/findings.mjs 발언` 참고.

**위원회별 수집 방식이 다르다 (실측 2026-08-09):**

| 위원회 | 방식 | 원본(raw_speeches) 범위 |
|---|---|---|
| 기후에너지환경노동위원회 · 산업통상자원중소벤처기업위원회 | 무필터 전량(`--by-keyword` 없이) | 위원회 전체 발언 — 나중에 `ENERGY_KEYWORDS` 를 넓혀도 **로컬 재처리만**으로 끝난다 |
| 기획재정위원회 · 과학기술정보방송통신위원회 · 국토교통위원회 | `--by-keyword`(검색 요청에 키워드를 실어 서버에서 먼저 거름) | **키워드 매칭된 서브셋뿐**이다. 에너지가 본업이 아닌 위원회라 전량(28만여 건)을 받는 게 비현실적이라 이렇게 했다. 키워드 목록을 넓히면 이 위원회들만 **서버 재요청**이 필요하다. |
| 국회운영·법제사법·정무·교육·외교통일·국방·행정안전·문화체육관광·농림축산식품해양수산·보건복지·정보·여성가족(12개) | `--by-keyword` | 22대 상임위 17개 중 나머지 전부. 이 12개도 에너지가 본업이 아니라 키워드 서브셋만 받았다(4,908건 신규 · 채택 698건). 이걸로 **17개 상임위 전 위원회 수집 완료** — 새 위원회는 더 없다. |

### 발전원별 주요인사 보드 갱신

`web/bizboard.js`(조직도 하단 "사업별 우호도" 카드)는 국회 발언 DB(`web/data.js`)에서 사업×성향(8×3=24그룹, 2026-08-09
에너지솔루션·분산에너지 추가로 6×3→8×3)별로 가장 임팩트 있는 의원을 AI로 골라 3줄 요약한 것이다.

| 스크립트 | 입력 | 출력 |
|---|---|---|
| `build_board_input2.mjs` | `web/data.js` | `data/_board_input.json` (그룹별 후보 + 발언 표본) |
| *(AI 선정·요약)* | 위 입력 | `pipeline/wf_board.js` 워크플로 결과 |
| `build_board.mjs` | `data/_board_results.json` | `web/bizboard.js` |

```bash
node pipeline/build_board_input2.mjs                 # ① 현재 발언 DB에서 후보 재계산
                                                       # ② AI 선정·요약 (Claude Code, wf_board.js 24그룹)
                                                       #    결과를 data/_board_results.json 형식({results:[{biz,stance,picks}]})으로 저장
node pipeline/build_board.mjs                         # ③ 빌드
```

- `build_board_input2.mjs`는 `web/data.js`의 `members[].quotes`(이미 사업 태깅됨)를 직접 읽는다 — 국회 발언을
  갱신한 뒤에는 반드시 이걸 먼저 돌려 후보를 다시 계산해야 보드가 최신 발언과 일치한다.
  ⚠ 구버전 `build_board_input.mjs`는 `data/utt_ctx.json`(저장소에 없음)을 읽어 재생성이 막혀 있었다 — 쓰지 말 것.
- AI 응답에서 `biz`/`stance`가 `NUCLEAR`/`원전`, `neutral`/`중립`처럼 다른 표기로 섞여 나오거나 같은 그룹이
  중복될 수 있다. 병합할 때 정규화하고 중복은 picks가 더 많은 쪽을 채택할 것(빈 그룹은 후보 부족이면 정상).
- `build_board.mjs`는 실린 인물의 발언 수(count)를 AI 응답이 아니라 `data/_board_input.json`(②의 입력,
  ①이 `web/data.js`에서 직접 센 값)에서 가져와 채운다 — AI가 숫자를 안 써도(또는 틀려도) 화면엔 ①이 계산한
  실제 값이 나간다. 다만 그 값이 최신이려면 ①을 먼저 최신 발언 DB로 다시 돌려야 한다.

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
node pipeline/cab_todo.mjs                       # ②' ⭐ 아직 판정 안 한 회의만 추리기 (0건이면 ③ 건너뜀)
                                                 # ③ AI 판정 (Claude Code, wf_cabinet.js — ②'의 --json 을 args 로)
node pipeline/merge_cabinet_judged.mjs <판정.json> data/_cab_minutes_raw.json --dry   # ④ 먼저 --dry 로 확인
node pipeline/build_cabinet2.mjs && node pipeline/build_ai.mjs                        # ⑤ 빌드
```

- **PDF 원본은 PC에만 둔다**(`.gitignore`). 추출·판정 결과는 전부 커밋해서 NAS 로 보낸다 —
  PDF 없이도 재판정·재빌드가 되게.
- ⭐ **②'를 건너뛰고 보유 PDF 를 통째로 ③에 넘기지 말 것** — wf_cabinet 은 준 파일을 전부 AI 로 보낸다.
  특히 **"에너지 발언 없음"으로 0건 판정된 회의**는 결과에 아무것도 안 남아 *안 한 것*처럼 보인다
  (2026-08-12 실측: 46건 중 22건이 이 경우라, 대장 없이는 매번 46건 전부 재판정).
  → `_cab_results.json` 의 `judgedMeetings` 대장이 그 기록이고, `cab_todo.mjs` 가 그걸 보고 거른다.
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
- **라벨**: `lib/news_labels.mjs` 의 키워드로 제목에서 `원전·수소·재생E·LNG·도시가스·분산에너지·에너지솔루션·전력` (8종, 2026-08-09 분산에너지·에너지솔루션 추가) 을 태깅.
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
