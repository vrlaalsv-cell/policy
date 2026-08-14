# 토큰 절감 지침 + SK E&S 청와대 판정 물려받기 (SKpolicy 방에서 넘어온 것)

> **작성 2026-08-14 · 출처 `C:\AI\SKpolicy`(AI보좌관, SK 그룹사 판).**
> 이 방(`policy`, SK E&S 판)에서 분기해 나간 그 방에서 하루 동안 **44M 토큰**을 쓰며 알아낸 것들이다.
> 여기 적힌 수치는 전부 **A/B 실측**이고, 추정치는 추정이라고 표시했다.
>
> 🔴 **먼저 §1 부터 하라.** 토큰 0으로 청와대 판정이 78→112회의가 된다.

---

## §1. 🎁 먼저 공짜로 받을 것 — 청와대 판정 78 → 112회의

SKpolicy 에서 **SK E&S 관점 청와대(국무·차관회의) 판정을 112/112 전량 완주**했다.
사업 카테고리가 이 방과 **완전히 같으므로**(아래 검증 결과) 파일을 그대로 복사하면 된다.

| | 이 방(policy) | SKpolicy | 차이 |
|---|---:|---:|---:|
| 판정 회의 | 78 | **112** | +34 |
| 발언 | 194 | **309** | +115 |

**호환성은 실측으로 확인했다**(2026-08-14):
- 발언 필드 동일 — `speaker, role, businesses, stance, quote, meeting, note`
- 사업 ID 8개 동일 — `POWER, LNG, RE, H2, CITYGAS, NUCLEAR, ESOL, DISTE`

```bash
cp C:/AI/SKpolicy/data/_cab_results.json C:/AI/policy/data/_cab_results.json
node pipeline/build_cabinet2.mjs
```

⚠ **주의 3가지**
1. SKpolicy 판은 `company`·`configHash`·`updatedAt`·`runs` 필드가 더 붙어 있다. 이 방 스크립트는
   그 필드를 안 보므로 **그냥 둬도 무해**하다(지우지 말 것 — 나중에 어느 판정인지 추적할 근거다).
2. 복사 전에 이 방 `data/_cab_results.json` 을 백업해 둘 것. 되돌릴 일이 생길 수 있다.
3. 이 저장소는 **6인 협업**이다. 복사·커밋 전에 `git status`·`git log` 로 팀 변경이 없는지 보고,
   가능하면 팀에 먼저 알릴 것.

---

## §2. 🔴 토큰의 진짜 주범은 "에이전트 개수"다 — 파일 크기가 아니다

**이게 오늘 얻은 가장 큰 교훈이고, 처음엔 정반대로 진단했다가 A/B 로 정정한 것이다.**

병렬 워크플로에서 **에이전트 1개당 고정비가 약 66K 토큰**이다
(시스템 프롬프트 + 도구 정의 + 판정 지시문 + 스키마). 처리하는 파일이 8K자든 30K자든 똑같이 붙는다.

**실측 — 회의 1건당 82K 토큰 중 66K(80%)가 고정비, 내용은 16K뿐.**

### 처음에 틀렸던 진단 (같은 실수 반복 금지)

"원본 PDF 를 읽어서 비싸다(회의당 129K) → DB 텍스트로 바꾸면 5배 절감" 이라고 두 번 보고했다.
**틀렸다.** 워크플로 전체 토큰을 회의 수로 나눈 값을 파일 내용 탓으로 돌린 계산 착오였다.
같은 회의 2건을 **형식만 바꿔** 돌린 A/B:

| 읽는 방식 | 2건 합계 | 회의당 |
|---|---:|---:|
| 원본 PDF | 165,206 | 82,603 |
| DB 텍스트 | 156,416 | 78,208 |
| **차이** | 8,790 | **5.3% 뿐** |

`Read` 도구가 PDF 를 이미 텍스트로 잘 뽑아 주기 때문에 형식 차이가 작다.

> 🔴 **"파일이 크니까 비싸겠지"라는 직관을 믿지 마라.** 같은 작업을 조건만 바꿔 2회 돌리고
> `subagent_tokens` 를 비교하면 **30초**에 끝난다. 추정으로 큰 결정을 내리지 말 것.

### 그럼 무엇을 줄이나 — 에이전트 1개가 더 많은 일을 하게

| 방법 | 효과 | 이 방에 적용되나 |
|---|---|---|
| **여러 회의를 한 에이전트가 배치로** | 배치 크기만큼 | ✅ **적용됨** — 아래 §3 |
| N개 관점(회사)을 한 번에 판정 | 관점 수만큼 | ❌ 이 방은 SK E&S 단일이라 해당 없음 |
| 파일 형식 최적화(PDF→텍스트) | 5%뿐 | 🟡 하는 게 맞지만 이것만으론 의미 없다 |

**SKpolicy 실측**: 10개사 관점을 한 에이전트가 동시 판정 → 회의 3건 254,649 토큰
(회사별로 돌렸다면 2.46M) = **9.7배 절감**. 전량 72회의를 7.04M 으로 완주했다.

---

## §3. 이 방에 바로 적용할 것 — 회의 배치 처리

이 방은 단일 회사라 §2의 "다회사 동시판정"은 못 쓴다. 대신 **회의를 묶어라.**

지금 `wf_cabinet.js` 는 **회의 1건 = 에이전트 1개** 구조다. 회의당 66K 가 고정비로 나간다.

```
지금:      112회의 × (66K 고정 + 내용) ≈ 9.2M
5건씩 묶음: 23에이전트 × (66K + 5×16K) ≈ 3.4M   ← 약 2.7배 (추정)
```

⚠ **이건 추정치다** — SKpolicy 에서 배치 방식은 실측하지 않았다(다회사 방식으로 갔기 때문).
적용하기 전에 5건짜리 배치 1개를 돌려 `subagent_tokens` 를 재고, 기존 판정과 대조해
**재현율(놓친 발언이 없는지)** 을 확인할 것. 한 에이전트가 회의 5건을 동시에 보면
품질이 떨어질 수 있다.

---

## §4. 🔴🔴 **원본은 최초 1회만 읽는다 — 그 뒤 모든 소비는 JSON/DB 에서** (최우선 구조 원칙)

> 사용자 지시(2026-08-14):
> "엑셀·PDF 원본은 **최초 1회 json으로 DB화 하고 다시 읽지 않는 것을 원칙으로** 하고,
> 모든 데이터는 최초에 json 같은 읽기 쉬운 것으로 DB화를 하고 **거기서만 읽는 것으로 모든 경로를 바꿔줘.**"
> "어떤 프로젝트든 PDF와 엑셀같은건 **최초 1회만 읽는 거야.** 다 DB화를 해서 그 파일에서 가져오라고… **여러 번 읽지 말고.**"

**이건 토큰 얘기가 아니라 구조 원칙이다.** PDF·엑셀·HWPX 같은 원본 포맷은
**DB 를 만들 때 딱 한 번** 읽는 재료일 뿐이고, 그 뒤 분석·판정·검색은 **전부 변환본에서** 한다.

```
[원본 PDF·엑셀·HWPX]  ──최초 1회──▶  [corpus.db / JSON]  ──▶  모든 소비자
   _corpus/*_raw/                      corpus.db              판정·검색·화면빌드
   ⚠ 여기서 끝. 다시 안 읽는다.        ⚠ 여기서만 읽는다.
```

**새 데이터 소스를 붙일 때 맨 먼저 정할 것**: 원본을 어디에 두고 / 어떤 형태로 변환하고 /
소비자는 무엇을 읽는가. 이걸 안 정하면 나중에 전 경로를 뜯어고쳐야 한다.

### 🔴 이 방의 현재 상태 (2026-08-14 실측 — **전 항목 미적용**)

`corpus.db` 를 **만들어 놓고도 아무도 안 쓰고 있다**(`build_corpus_db.mjs`·`corpus_query.mjs` 만 존재).

| 점검 | 이 방 | 무엇을 읽고 있나 |
|---|---|---|
| `cab_todo.mjs` (청와대) | ❌ | `cabinet_minutes_index.json` → **PDF 원본 경로**를 AI 에 넘김 |
| `collect_assembly_speeches.mjs` (국회) | ❌ | **엑셀 전량 재파싱** — L237 `for (const f of files) recs = recs.concat(parseXlsx(f))`. 다운로드는 증분인데(이미 받은 건 경로만 반환) **파싱은 매번 전부** 한다. corpus.db 에 이미 같은 내용이 들어 있다. |
| `update-cabinet.mjs` | ❌ | 원본만 받고 추출·DB적재를 안 부름 → **DB 가 조용히 낡는다** |
| `wf_cabinet.js` | ❌ | 원본 경로가 와도 그대로 `Read` 시킴(방어 없음) |

→ **고칠 순서**: ① `cab_todo.mjs` 를 `corpus.db` minutes 기반으로(SKpolicy 판 그대로 이식 가능)
② `update-cabinet.mjs` 에 적재 고리 연결(아래) ③ `wf_cabinet.js` 에 원본경로 방어
④ `collect_assembly_speeches.mjs` 는 **다운로드까지만** 하게 하고, 발언 산출은 corpus.db 에서 읽는 별도 빌더로 분리

### 왜 DB 가 원본보다 나은가 (토큰 5%가 아니라 **완전성·정확성**)

- **DB 가 더 완전하다** — `corpus.db` minutes 는 **112회의·284만자**, PDF 는 **102회의·263만자**.
  HWPX 만 있는 회의가 10건 더 있고, HWPX 는 네이티브 텍스트라 PDF 2단 조판 추출보다 손실이 적다.
  → **"원본이 진짜"라는 직관을 의심할 것.** 무엇이 더 완전한지는 세어 보고 정해라.
- `_corpus/extracted/cabinet_pdf_text.json`(102회의)은 **DB 를 만들기 위한 중간물**이지 소비 대상이 아니다.
- 🔴 **원본 경로가 박힌 캐시 파일을 조심하라.** SKpolicy 에서 DB 전환 뒤에도 `_cab_todo_*.json`
  6개에 **PDF 경로 232건**이 남아 있었다 — 그걸 재사용하면 전환이 통째로 무효가 된다.
  전환 후 그런 캐시를 **삭제**하고, 워크플로 진입점에 **원본 확장자면 즉시 에러**를 박아 둘 것.

### 왜 DB 가 원본보다 나은가 (토큰 아니라 **완전성·정확성**)

- **DB 가 더 완전하다** — `corpus.db` minutes 는 **112회의·284만자**, PDF 는 **102회의·263만자**.
  HWPX 만 있는 회의가 10건 더 있고, HWPX 는 네이티브 텍스트라 PDF 2단 조판 추출보다 손실이 적다.
  → **"원본이 진짜"라는 직관을 의심할 것.** 무엇이 더 완전한지는 세어 보고 정해라.
- `_corpus/extracted/cabinet_pdf_text.json`(102회의)은 **DB 를 만들기 위한 중간물**이지 소비 대상이 아니다.

### 🔴 끊긴 고리 — 새 회의록을 받아도 DB 가 안 늘어난다

`update-cabinet.mjs` 가 원본만 받아 두고 추출·적재를 안 부른다. 이 상태면 새 회의록을
받아 놓고도 **DB 가 조용히 낡아 판정 대상에 영영 안 뜬다.** SKpolicy 는 이렇게 이었다:

```javascript
// update-cabinet.mjs 맨 끝, 신규가 있을 때만
if (ok > 0) {
  const { spawnSync } = await import("node:child_process");
  spawnSync("python", ["pipeline/extract_pdf_text.py", "--since", "2025-06-05"],
            { stdio: "inherit", shell: process.platform === "win32" });
  spawnSync("node", ["pipeline/build_corpus_db.mjs"],
            { stdio: "inherit", shell: process.platform === "win32" });
}
```

참고 구현: `C:\AI\SKpolicy\pipeline\update-cabinet.mjs` 끝부분 · `cab_todo.mjs` 전체.

---

## §5. 🔴 실패한 판정이 "완료"로 기록되던 버그 — 이 방에도 있다

**데이터가 조용히 망가지는 종류라 토큰보다 이게 더 급하다.**

`wf_cabinet.js` 가 에이전트 실패(`null`)와 성공-0건(`{statements:[]}`)을 **둘 다 빈 배열**로
뭉갰다. JS 에서 빈 배열은 **truthy** 라 `results.filter(Boolean)` 이 아무것도 못 거른다.

**SKpolicy 실사고(2026-08-13)**: 102건 중 24건이 세션 한도로 실패했는데 `filesOk` 가 **102**로
찍혔다. 그대로 믿었으면 **실패한 24건이 `judgedMeetings` 에 들어가 영영 재판정 대상에서 빠질** 뻔했다.

**고치는 법** — 각 항목의 성공 여부를 결과와 **따로** 들고 다닌다:

```javascript
// wf_cabinet.js
const one = (i) =>
  agent(prompt(items[i].file), { ... })
    .then((r) => ({
      meeting: items[i].meeting,
      ok: !!r,                                    // ← 실패/성공을 여기서 구분
      statements: (r && r.statements) ? r.statements.map(...) : [],
    }))
const perItem = [firstItem, ...restItems]
const okMeetings = perItem.filter((x) => x.ok).map((x) => x.meeting)
return { fileCount: items.length, filesOk: okMeetings.length, okMeetings, statements }
```

```javascript
// collect_cab.mjs — okMeetings 없으면 아예 멈춘다(옛 결과로 잘못 채우는 사고 차단)
const okMeetings = obj.okMeetings || (obj.result && obj.result.okMeetings) || null;
if (!okMeetings) { console.error("✗ okMeetings 없음 — wf_cabinet.js 가 옛 버전"); process.exit(1); }
const judgedMeetings = [...new Set([...(archive.judgedMeetings || []), ...okMeetings])];
```

⚠ 곁다리: `collect_cab.mjs` 가 "이번 요청 건수"를 `_cab_todo_*.json`(캐시 파일)에서 읽으면
실패분만 골라 재실행할 때 **엉뚱한 숫자가 찍힌다.** 워크플로 결과의 `fileCount` 를 쓸 것.

---

## §6. ⚡ 프롬프트 캐싱 — 두 가지만 지키면 된다

1. **공통 지시문 먼저, 변하는 건 맨 뒤.** 프롬프트 앞에 파일 경로가 끼면 그 뒤 전체가 매번 새 토큰이다.
2. 🔴 **첫 요청은 혼자 보낸다.** N개를 동시에 쏘면 아무도 서로의 캐시 쓰기를 못 읽고 **전원이 쓰기 요금**을 낸다.
   ```javascript
   const first = await one(0)
   const rest = n > 1 ? await parallel(Array.from({length: n-1}, (_, k) => () => one(k+1))) : []
   ```
   SKpolicy 는 SDK·워크플로 **두 경로에서 각각 이걸 빠뜨렸다가** 실측으로 잡았다.

---

## §7. 🐛 화면 — 첫화면 깜빡임 (이 방에도 있음)

랜딩이 HTML 에 보이는 상태로 먼저 그려지고 `app.js`(문서 맨 끝)가 로드돼야 숨겨서 그 사이가 번쩍인다.
이 방은 계열사 탭이 없어 덜 눈에 띄지만, `?view=` 딥링크로 들어올 때 같은 현상이 난다.

`index.html` 의 **랜딩 마크업보다 먼저**:
```html
<script>
(function () {
  var v = new URLSearchParams(location.search).get("view");
  if (v === "assembly" || v === "cabinet") document.write('<style id="nolandFlash">#landing{display:none}</style>');
})();
</script>
```
`app.js` 에서 랜딩 상태를 넘겨받은 직후:
```javascript
var nolandFlash = document.getElementById("nolandFlash");
if (nolandFlash) nolandFlash.remove();
```
🔴 **걷어내지 않으면 "처음 화면"·로고 클릭이 `.hidden` 만 떼서 랜딩이 영영 안 뜬다.**
고친 뒤 그 왕복(처음화면 복귀 → 재진입)까지 반드시 확인할 것.

---

## §8. 💸 아끼려고 쓰는 사용량은 옳다

> 사용자 지시(2026-08-14): "무조건 아끼는 게 원칙이 아니고, **아끼기 위해 사용량을 써야 되면 쓰는 게 맞지.**"

사용량이 아깝다는 말을 듣고 **분석·감사·리팩터까지 멈추는 것은 오판이다.**
SKpolicy 에서 에이전트 6개짜리 감사를 돌려 **PDF 경로가 박힌 캐시 232건**을 찾아냈다 —
그대로 뒀으면 DB 전환이 통째로 무효가 될 뻔했다. 그 감사가 값을 했다.

- **정당한 투자**: 낭비 구조를 찾는 1회성 감사, 전 경로 리팩터, 품질 검증 벤치마크
- **정당하지 않은 것**: 이미 답을 아는 걸 재확인, 같은 원본 반복 읽기, 결과를 안 남겨 다음 세션이 또 하는 조사
- 판단 기준은 **"이번에 쓰는 양"이 아니라 "앞으로 아낄 양"** — 회수 가능하면 써라
- 다만 **쓰기 전에 규모를 한 줄로 알릴 것**(에이전트 몇 개·대략 얼마)

---

## 우선순위 정리

| 순서 | 할 일 | 효과 | 근거 |
|---|---|---|---|
| 1 | **§1 청와대 판정 복사** | 78→112회의 · **토큰 0** | 호환성 실측 완료 |
| 2 | **§5 실패/성공 오판정 수정** | 데이터 무결성 | 실사고 있었음 |
| 3 | **§4 원본→DB 전환 (구조 원칙)** | 완전성·정확성 · 반복 파싱 제거 | 사용자 지시 · A/B 실측 |
| 4 | §6 캐싱 2원칙 | 재판정 때 큼 | 두 경로에서 실측 |
| 5 | §3 회의 배치 처리 | 약 2.7배(**추정**) | 미실측 — 재고 확인 필요 |
| 6 | §7 깜빡임 | UX | 브라우저 검증 완료 |

> **§4 는 순위가 3위지만 성격이 다르다** — 나머지가 "개선"이라면 이건 **지켜야 할 규칙**이다.
> 앞으로 이 방에 새 데이터 소스를 붙일 때마다 적용된다(§4 의 "맨 먼저 정할 것" 참고).

참고 구현은 전부 `C:\AI\SKpolicy\pipeline\` 에 있다.
더 자세한 근거는 `C:\AI\SKpolicy\data\findings.json`
(`node pipeline/findings.mjs <키워드>` 로 조회 — `에이전트`·`한자`·`재분류` 등).
