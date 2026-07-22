# pipeline — 수집·분석 (DB화)

외부 패키지 없이 Node 내장 기능만 사용합니다 (`global fetch`, node ≥ 18). 모든 스크립트는 루트 `.env` 를 읽습니다.

| 스크립트 | 입력 | 출력 | 필요 키 |
|---|---|---|---|
| `1_collect_members.mjs` | 열린국회 API | `data/members.json` | `ASSEMBLY_API_KEY` |
| `2_collect_utterances.mjs` | `data/raw/*.csv|json` | `data/utterances.json` | — |
| `3_analyze_gemini.mjs` | members + utterances | `data/analysis.json` | `GEMINI_API_KEY` |
| `4_analyze_cabinet.mjs` | `data/cabinet_minutes/*` | `data/cabinet.json` | `GEMINI_API_KEY` |
| `5_collect_news.mjs` | members | `data/news.json` | `NAVER_*` |
| `build_web_data.mjs` | data/*.json | `web/data.js` | — |
| `serve.mjs` | web/ | (HTTP 서버) | — |

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
