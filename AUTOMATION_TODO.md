# 자동화 잔여 과제 — API 붙일 것들

> **한 줄 요약**: 지금 대시보드에서 **자동으로 도는 건 기사 수집(하루 5회) 하나뿐**이다.
> 청와대 회의록 판정과 인물별 AI 종합분석은 **사람이 Claude Code 대화창에서 돌려야** 갱신된다.
> 이 둘을 무인화하려면 Anthropic API 를 붙여야 하고, 그때 같이 손봐야 할 것들을 여기 모았다.
>
> 작성 2026-08-08. 근거는 전부 이 저장소의 실제 파일에서 확인한 것이고, 파일:줄 을 달아 뒀다.

---

## 0. 현재 자동/수동 경계

| 산출물 | 만드는 스크립트 | 지금 누가 돌리나 |
|---|---|---|
| `web/news.js` (최근 기사) | `5_collect_news` → `6_fetch_excerpts` → `build_news_web` | ✅ **자동** — 컨테이너 `policy-scheduler`, 매일 06/09/12/15/18시 |
| 코드 배포 | `scripts/autodeploy.sh` | ✅ **자동** — DSM 작업 스케줄러 |
| `web/cabinet.js` (청와대 발언·성향) | `update-cabinet` → `extract_minutes.py` → **AI 판정** → `merge_cabinet_judged` → `build_cabinet2` | ⚠️ 1단계만 자동, **판정은 사람** |
| `members.ai` / `speakers.ai` (AI 종합분석) | `build_ai_input` → **AI 분석** → `build_ai` | ❌ **전부 사람** |
| `web/data.js` (국회 성향) | `build_assembly2` | ❌ 동결 — 입력(`data/utt_ctx.json`·`data/_ab2_results.json`)이 저장소에 없어 재생성 불가 |
| `web/bizboard.js` (사업별 보드) | `build_board` | ❌ 자동 트리거 없음 (입력이 커밋돼 있어 재실행은 가능) |

**원본과 DB의 위치 규칙** (2026-08-08 확정)
- **회의록 PDF 원본 = 내 PC에만.** `data/cabinet_minutes/*` 는 `.gitignore` 대상 — 용량이 크고 공개 자료라 굳이 안 올린다.
- **추출·판정 결과(DB) = 항상 커밋해서 서버로.** `_cab_minutes_raw.json`(추출 원문) · `_cab_results.json`(판정) ·
  `cabinet.json` · `web/cabinet.js` · `cabinet_minutes_index.json` 전부 git 에 넣는다.
  → PDF 없이도 재판정·재빌드가 되고, NAS 는 git pull 만으로 최신 데이터를 받는다.

---

## A. 국무회의 회의록 판정 → API

### 지금 흐름
```
node pipeline/update-cabinet.mjs            # ① 행안부에서 PDF 수집 (자동화 가능, 무료)
python pipeline/extract_minutes.py          # ② PDF → 발언 원문 (자동화 가능, 무료)
   ↓  ★ 여기서 끊긴다 — Claude Code 워크플로로 사람이 판정
node pipeline/merge_cabinet_judged.mjs <판정.json> <추출.json>   # ③ 병합 (자동화 가능)
node pipeline/build_cabinet2.mjs && node pipeline/build_ai.mjs  # ④ 빌드
```

### 만들 것
`pipeline/judge_cabinet.mjs` — ②의 출력을 읽어 Anthropic API 로 판정하고 ③의 입력 형식으로 저장.
프롬프트·스키마는 이미 검증된 것이 있다: `pipeline/merge_cabinet_judged.mjs` 헤더 주석의 4중 검증 + 아래 필드.
- 입력: `{ meeting, date, speaker, role, text }`
- 출력: `{ idx, relevant, quote, businesses[], stance, note }`
- **`quote` 는 원문에서 글자 그대로 잘라낸 연속 구간**이어야 한다. 요약을 허용하면 병합 단계에서 전부 걸러진다.

### 비용 (실측 기반)
- 추출 원문은 건당 평균 약 930자, 한 회의당 3~17건.
- 신규 회의는 **주 2회**(국무회의·차관회의) → 한 번에 수십 건 수준.
- 한글 1자 ≈ 1.5토큰으로 잡으면 회의 1건 판정은 입력 5만~10만 토큰 / 출력 1만~2만 토큰 규모.
- Sonnet 5 기준 **회당 수백 원, 월 2~3천 원**. Opus 5 면 그 3~5배.
- 판정은 사실 추출에 가까워 **Sonnet 5 로 충분**하다. 판단이 갈리는 건 `stance` 뿐인데, 이건 애매하면 `neutral` 로 두면 된다.

### ⚠️ 이미 겪은 함정 — 코드에 방어가 들어가 있으니 지우지 말 것
1. **2단 조판** — 회의록 591페이지 중 253페이지가 두 칼럼이다. 그냥 뽑으면 좌우가 뒤섞여 문장이 깨진다.
   `extract_minutes.py` 의 거터 폭 판별(`GUTTER_MIN = 0.03`)이 이걸 잡는다. 실측: 1단 0~1.2% / 2단 4.5~9.6%.
2. **불릿 문자가 문서마다 다르다** — 차관회의록은 `ᄋ`(U+110B 첫가끝 초성)을 쓰는데
   호환 자모 `ㅇ`(U+3147)과 **다른 문자**다. 전체 실측: `•` 1334 · `ᄋ` 1044 · `▸` 490 · `ㅇ` 264.
   U+110B 를 빼면 차관회의 발언이 통째로 유실된다.
3. **차관회의록은 발언록이 아니라 의안 심의표다** — `ᄋ 제안설명 : 산업통상부기획조정실장 오승철` /
   `ᄋ 제안이유` 형식이고, 육성 발언 대신 법령 제안이유가 실린다. 발언자 정규식이 두 벌 필요하다.
4. **AI 가 인용문을 지어낸다** — 요약·윤문한 문장을 인용처럼 내놓는다.
   `merge_cabinet_judged.mjs` 가 인용문이 원문에 실제로 있는지 대조해서 버린다.
5. **회의록 목차 찌꺼기** — `[법제처] ᄋ 토 의 : 의견 없음` 같은 게 인용문에 섞인다. 같은 파일에서 거른다.
6. **중복 게시** — 같은 발언을 기존 데이터와 두 번 싣지 않도록 회의·발언자별 인용문 겹침을 본다.
7. **회의명 날짜 포맷** — 추출기는 `(2026.06.23)`, 기존 데이터는 `(2026-06-23)`.
   섞이면 `build_ai_input.mjs` 의 최신순 정렬이 조용히 무너져 **새 발언이 AI 입력에서 잘려나간다**.
   `merge_cabinet_judged.mjs` 의 `fixMeeting()` 이 대시로 통일한다.
8. **증분 기준을 회의일로 잡지 말 것** — 등록일 ≠ 회의일이고 **회의 후 약 6주 뒤** 공개된다
   (제27회 국무회의: 회의일 2026-06-23, 등록일 2026-08-06). 새 PDF 의 회의일은 항상 과거라
   `--since <마지막 판정일>` 로 거르면 신규분이 전부 탈락한다.
   → 증분은 `cabinet_minutes_index.json` 의 `posts` 와 판정 완료 회의 목록을 대조해서 정한다.

---

## B. 인물별 AI 종합분석 → API

### 지금 흐름
```
node pipeline/build_ai_input.mjs      # 배치 생성 (data/_ai/{asm,cab}_b*.json, 6명씩)
   ↓  ★ Claude Code 워크플로(pipeline/wf_ai.js)로 사람이 실행
node pipeline/collect_ai.mjs <워크플로.output>   # → data/_ai_results.json
node pipeline/build_ai.mjs            # → web/data.js(members.ai) + web/cabinet.js(speakers.ai)
```

### 만들 것
`pipeline/run_ai.mjs` — `data/_ai/*.json` 배치를 API 로 처리해 `_ai_results.json` 을 직접 만든다.
`wf_ai.js` 의 프롬프트·스키마를 거의 그대로 쓸 수 있다. 두 군데만 고치면 된다:
- "파일을 Read 도구로 읽어라" → 배치 JSON 을 프롬프트 본문에 인라인
- `agent(..., { schema })` → `output_config.format`

### 비용 (실측 기반)
- 배치 42개(국회 35 + 청와대 7) = 약 19만자, 결과 246명분 약 9.9만자.
- 한글 1자 ≈ 1.5토큰 → **전원 1회 재생성 = 입력 약 0.33M / 출력 약 0.15M 토큰**.
- Sonnet 5 약 **3,000원** / Opus 5 약 **7,500원** (1,400원/달러).

### 증분 전략 — 매번 전원 재생성하지 말 것
기사는 하루 5번 갱신되지만, 사람의 **성향**이 하루에 다섯 번 바뀌지는 않는다. 재생성 기준은:
- 그 사람의 **발언이 추가됐을 때** (회의록 판정 후)
- 그 사람의 **기사가 새로 붙었을 때**, 그리고 **직전 생성 이후 7일 이상** 지났을 때
- 그 외에는 그대로 둔다 → 주간 재생성 대상은 보통 수십 명 → **월 1천 원 안팎**

### ⚠️ 함정
1. **`data/_ai_manual.json` 이 `_ai_results.json` 을 덮어쓴다** (`build_ai.mjs`, 나중에 로드되는 쪽이 이김).
   여기에 옛 1차 스냅샷 51건이 남아 있어서, 2026-08-08 에 재생성한 분석이 **화면에 안 나오고 있었다.**
   지금은 비워 뒀다. 손으로 고친 것만 넣을 것.
2. **`build_ai.mjs` 는 실패하면 기존 분석을 지운다.** 결과가 비면 `catch` 로 `[]` 가 되고,
   `web/data.js`·`web/cabinet.js` 의 `ai` 필드 246명분을 `delete` 한 뒤 제자리에 덮어쓴다. 원본이 안 남는다.
   → API 판 스크립트에는 **대량 실패 가드**가 반드시 필요하다. 본보기가 이미 있다:
   `5_collect_news.mjs` 의 "🛑 대량 실패 안전장치" (2026-08-08 에 336명 중 9명만 성공해 기사 전체가
   0건으로 덮여쓰인 사고 이후 넣은 것). 성공률 60% 미만이면 아무것도 쓰지 않고 종료한다.
3. **`build_cabinet2.mjs` 도 같은 위험** — `_cab_results.json` 을 통째로 읽어 `cabinet.json`/`cabinet.js` 를
   전량 재작성한다. 판정이 대부분 비면 청와대 화면이 통째로 빈다.
4. **`extract_minutes.py` 는 0건이어도 성공처럼 끝난다** (`OK 0 records`, exit 0).
   조판이 바뀌어 판별이 깨지면 조용히 0건이 된다. → 0건이거나 직전 대비 급감이면 exit 1 로 바꿀 것.

---

## C. 컨테이너에서 돌리려면

1. **API 키** — `C:\AI\CLAUDE.md` 의 표준 절차대로 **NAS 안에서** 만든다.
   ⚠ 이 프로젝트는 `.env` 에 이미 Cloudflare 터널 토큰이 있으니 **반드시 `>>` 로 덧붙일 것** (`>` 면 토큰이 날아간다).
   ```
   echo 'ANTHROPIC_API_KEY=sk-ant-...' >> /volume2/docker/policy/.env
   ```
   `docker-compose.yml` 이 `env_file` 로 두 컨테이너에 이미 주입하므로 코드 수정은 없다. `.env.example` 에 키 이름만 추가.

2. **Python + pdfplumber** — 현재 이미지는 `node:22-alpine` 이라 파이썬이 없다.
   alpine(musl)은 휠이 없어 소스 빌드로 떨어질 위험이 있고 NAS CPU(Celeron J4125)에선 수십 분 걸린다.
   `node:22-bookworm-slim` + `python3-venv` 로 바꿔 manylinux 휠을 쓰는 편이 낫다. 이미지 +150~250MB, 빌드 +2~4분.
   ⚠ 베이스를 바꾸면 `deploy/Dockerfile` 의 `HEALTHCHECK` 가 깨진다 — `wget` 은 alpine(busybox) 내장이라 있는 것이고
   Debian slim 에는 없다. `node -e "fetch(...)"` 로 바꿀 것.

3. **`runtime/` 마운트** — `./runtime:/app/data` 바인드 마운트가 이미지의 `/app/data` 를 통째로 가린다.
   커밋한 `_cab_results.json`·`_ai_results.json` 이 컨테이너에서 안 보이므로 첫 배포 때 `runtime/` 으로 복사해야 한다.
   또 산출물이 `web/` 으로 나가는데 `web/` 은 공유 볼륨이 아니라, 스케줄러가 만든 `cabinet.js`/`data.js` 는
   `app` 컨테이너에 도달하지 않는다. 기사만 `serve.mjs` 가 `data/news.js` 를 우선 서빙하는 우회가 돼 있다 —
   같은 폴백을 `cabinet.js`·`data.js` 로 넓혀야 한다.

4. **스케줄** — `scheduler.mjs` 는 지금 `run_news.mjs` 하나만 도는 단일 작업 구조라 요일 개념이 없다.
   회의록은 주 1회면 충분하니 jobs 배열로 일반화하고 `CAB_AT`/`CAB_DOW` 를 추가한다.
   ⚠ **시각을 06/09/12/15/18 과 겹치지 말 것.** 자동배포(3시간 간격)도 그 시각이라,
   겹치면 `docker compose up -d --build` 가 진행 중인 작업을 죽인다. 유료 호출이 붙으면
   "토큰 쓰고 저장 직전에 kill → 재시작 → 같은 돈 재지출" 이 정기적으로 일어난다. **04:30 권장.**
   ⚠ `CAB_ON_START` 는 기본 0 으로. 켜 두면 **커밋할 때마다** 컨테이너가 재시작되며 API 호출이 한 세트 나간다.

5. **PDF 가 PC 에만 있다** — 판정을 NAS 로 옮기면 NAS 가 PDF 를 다시 받아야 한다.
   `update-cabinet.mjs` 기본 `--pages=2` 가 과거분을 커버하는지는 검증된 바 없다(등록이 몰아서 된다). 첫 실행은 `--pages=5` 이상으로.

---

## D. 발표 전에 고칠 것 / 나중에 해도 될 것

### 발표 전 (전부 코드 몇 줄)
- [x] `serve.mjs` — 🔄 업데이트 버튼을 누르면 **정확히 5분 뒤 웹서버가 죽던** 문제 (타이머 미해제 → 이미 끝난 응답에 헤더 재작성 → uncaughtException). 2026-08-08 수정.
- [x] `build_ai_input.mjs` — 국무위원 기사(`CAB:<이름>` 키) 13명 53건이 AI 분석 입력에서 빠지던 문제. 2026-08-08 수정.
      → **수정 후 청와대 40명 AI 분석을 다시 만들어야 반영된다.**
- [x] `.gitignore` — `__pycache__/` 추가.
- [ ] **🔄 업데이트 버튼** — 남겨 둘 거면 두 가지를 같이 고쳐야 한다.
      ① `update-assembly.mjs` 가 만드는 `data/members.json` 의 id 는 열린국회 `MONA_CD`(7자리)인데
         화면 데이터 id 는 `M001~M300` 이다. `5_collect_news.mjs` 는 `members.json` 이 있으면 그걸 **우선** 쓰므로,
         버튼을 한 번 누르면 다음 정기 수집부터 뉴스 키 체계가 갈라져 **대시보드의 최근 기사가 영구 동결**된다.
         화면·로그상으로는 정상으로 보이고 대량실패 가드도 못 잡는다.
      ② `web/app.js` 가 `data.success` 를 보지 않고 무조건 "✓ 완료" 를 띄운다. 실패해도 성공으로 보인다.
      → 발표 동안은 버튼을 감추는 게 가장 싸고 확실하다.
- [ ] `DEPLOY.md` 문구 정정 — "컨테이너 2개"(실제 3개), "비용 0원"(API 붙이면 거짓), "매일 04:30 수집"(실제 06~18시).

### 나중에 (자동화 착수 시)
- [ ] `wf_cabinet.js`·`wf_ai.js` → Anthropic SDK 스크립트로 재작성 (위 A·B)
- [ ] 대량 실패 가드를 회의록·AI 쪽에 이식 (`5_collect_news.mjs` 패턴)
- [ ] Dockerfile 파이썬/베이스 결정, `scheduler.mjs` 다중 작업화
- [ ] `web/data.js` 재생성 입력 복구 (`utt_ctx.json`·`_ab2_results.json` 없음) — 없으면 국회 성향은 계속 동결
- [ ] `data/cabinet.json` 은 아무도 안 읽는 산출물 — 정리할지 결정
- [ ] Next.js 랜딩 앱(`app/`)은 배포 경로 밖이다 (`.dockerignore` 제외, `serve.mjs` 만 뜬다). 쓸지 말지 정리
