# 정책돋보기

국회·행정부(청와대) 에너지 정책 성향을 데이터로 분석하는 정책 인텔리전스 프로젝트입니다. (SK E&S · 정책 인텔리전스, 기획안 v1.0 기반)

## 구성

- `app/`, `components/` — Next.js 랜딩 페이지. 로고 + 청와대/국회 카드로 각 대시보드 진입.
- `web/`, `pipeline/`, `data/` — 대시보드 MVP 프로토타입. 22대 국회의원 + 국무위원의 에너지(LNG·수소·재생E·도시가스·전력) 성향을 육각 카토그램 지도·프로필·근거 발언으로 탐색.

## 랜딩 페이지 실행

```bash
npm install
npm run dev
```

http://localhost:3000 에서 확인할 수 있습니다.

- `app/page.tsx` — 랜딩 페이지 (청와대 / 국회 카드)
- `app/blue-house`, `app/assembly` — 대시보드 플레이스홀더 페이지
- `components/NavCard.tsx` — 호버 효과가 있는 카드 컴포넌트

## 대시보드 MVP 미리보기 (샘플 데이터)

> 현재 MVP 화면은 **가상 샘플 데이터**로 동작합니다. `.env`에 키를 넣고 파이프라인을 실행하면 실데이터로 바뀝니다.

```bash
npm run serve      # → http://localhost:8137
```

또는 `web/index.html`을 브라우저로 바로 열어도 됩니다. (샘플 데이터로 동작)

### 폴더 구조

```
web/       # 대시보드(정적) — index.html · styles.css · app.js · data.js
data/      # DB(정형 데이터) — 파이프라인 산출물
  cabinet_minutes/  # 국무회의 회의록을 여기에 넣으세요 (지정 폴더)
  raw/              # 발언 빅데이터 EXCEL/CSV 원본 (수동 다운로드)
pipeline/  # 수집·분석 스크립트 (Node, 외부 패키지 없음)
  1_collect_members.mjs   2_collect_utterances.mjs
  3_analyze_gemini.mjs    4_analyze_cabinet.mjs
  5_collect_news.mjs      build_web_data.mjs   serve.mjs
  lib/ (env·assembly·gemini·config)
.env.example
```

### 설계 원칙

- 국회 회의록을 **전부 수집 → DB화**, 회의록에서 의원별 성향을 분석해 **DB화**.
- **실시간/증분 갱신**: 신규 회의록만 수집·분석해 병합 (`--since`, `--only-new`).
- **국무회의**는 API가 아니라 **지정 폴더(`data/cabinet_minutes/`)**의 파일을 분석 → 국무위원 성향 DB화.
- 무거운 계산(수집·필터·LLM)은 **파이프라인**에서 끝내고, 웹은 결과만 조회(클릭당 AI 호출 0원).

### 실데이터 채우기 (키 발급 후)

1. `.env`에 키 입력 (`.env.example` 참고)
2. 파이프라인 실행:
   ```bash
   npm run collect:members     # 국회의원 명단·지역구·위원회 → data/members.json
   # 발언 빅데이터(dataset.nanet.go.kr) EXCEL/CSV 를 data/raw/ 에 저장한 뒤:
   npm run collect:utterances  # → data/utterances.json
   npm run analyze             # Gemini 사업별 우호도 태깅 → data/analysis.json
   npm run build:data          # 병합 → web/data.js (대시보드 갱신)
   # 선택:
   npm run analyze:cabinet     # 국무회의 지정폴더 분석 → data/cabinet.json
   npm run collect:news        # 네이버 뉴스 → data/news.json
   ```
   또는 한 번에: `npm run pipeline`

### 필요한 API 키 (모두 `.env`)

| 키 | 용도 | 발급 |
|---|---|---|
| `ASSEMBLY_API_KEY` | 국회 인적사항/회의록/표결/발의 | open.assembly.go.kr (무료·즉시) |
| `DATA_GO_KR_API_KEY` | 회의록 전문(ProceedingInfoService) 보완 | data.go.kr (무료) |
| `NAVER_CLIENT_ID/SECRET` | 최근 기사 | developers.naver.com (무료) |
| `GEMINI_API_KEY` | 성향 분석 | ai.google.dev ($30 한도) |

> ⚠ 국회·Gemini 키는 **파이프라인(로컬/CI)에서만** 사용 — 브라우저·배포물에 절대 노출 금지.
> 비용: 1차 배치 실비 약 $2~6 (Batch API 사용 시 절반). `analyze`는 현재 동기 호출이며, 대량 처리 시 Batch API 전환 권장.

### 유의

- 성향 라벨은 **AI 요약·참고용**입니다. 항상 **근거 발언 원문·출처**와 함께 확인하세요. (화면에 면책 표기)
- 실명 정치인 공개 데이터를 다루므로 개인정보·명예에 유의하고, 출처를 표기합니다.
- 엔드포인트 서비스 코드/필드는 착수 시 공식 명세서로 1회 재검증하세요.

## Vercel 배포

- **정적 배포**: `web/`를 배포 루트로 지정하면 그대로 서비스됩니다. (파이프라인이 생성한 `web/data.js` 포함)
- 추후 Next.js로 이전 시: `web/`의 화면 로직을 컴포넌트로 옮기고 `data/*.json`을 import.
  실시간 뉴스가 필요하면 `/api/news` 서버리스 함수에서 네이버 키를 사용(브라우저 비노출).
