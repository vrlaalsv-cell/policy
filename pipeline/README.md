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
