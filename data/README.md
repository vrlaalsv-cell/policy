# 데이터 레이어 (DB화 대상)

> ⚠ 이 문서는 MVP 초기 설계안이라 낡았다(사업 카테고리 5개만 나열, `analysis.json`/`meta.json`은 실제로
> 존재하지 않음, `1_~4_`·`build_web_data` 옛 스크립트는 2026-11-01 삭제됨). **현행 파이프라인·산출물은 `pipeline/README.md`를 참고할 것.**

수정된 핵심 설계 원칙에 따라, 파이프라인은 원본을 수집→분석해 **아래 정형 데이터(DB)** 로 만듭니다.
MVP 단계에서는 이 스키마를 `web/data.js`(브라우저 인라인)로 미리 채워 화면을 확인합니다.
실데이터 단계에서는 파이프라인이 `data/*.json`(또는 SQLite/Postgres)으로 씁니다.

## 파일
| 파일 | 내용 | 생성 |
|---|---|---|
| `members.json` | 국회의원 300명 인적사항·지역구·위원회 | (옛 `1_collect_members`, 2026-11-01 삭제 — 지금 명단은 `web/data.js`) |
| `utterances.json` | 의원별 에너지 관련 발언(원문·출처·회의일) | (옛 `2_collect_utterances`, 삭제 — 아무도 안 읽음) |
| `analysis.json` | 의원별 사업(LNG/수소/재생E/도시가스/전력) 우호도 + 근거 | (옛 `3_analyze_gemini`, 삭제) |
| `cabinet.json` | 국무위원 성향 | `pipeline/build_cabinet2.mjs` (화면은 `web/cabinet.js` 를 읽음) |
| `news.json` | 의원별 최근 에너지 기사(선택) | `pipeline/5_collect_news.mjs` |
| `meta.json` | 사업/정당/색상/갱신시각 | 공통 |

## 핵심 스키마

### Member
```jsonc
{
  "id": "MONA_CD",            // 열린국회 의원코드
  "name": "홍길동",
  "party": "더불어민주당",
  "sido": "SEOUL",           // 시도 코드 (meta.sido)
  "district": "서울 종로",     // ORIG_NM
  "committee": ["산업통상자원중소벤처기업위원회"],
  "terms": 3                 // 당선 대수
}
```

### EnergyStance (analysis.json 항목)
```jsonc
{
  "memberId": "MONA_CD",
  "stance": { "LNG":"favor", "H2":"neutral", "RE":"favor", "CITYGAS":"neutral", "POWER":"oppose" },
  // favor=우호 / neutral=중립 / oppose=비우호 / unknown=자료부족
  "quotes": [
    { "biz":"LNG", "text":"...", "source":"회의록 URL", "date":"2025-11-03", "confer":"산자위" }
  ],
  "updatedAt": "2026-07-22"
}
```

## 실시간/증분 갱신
- 옛 `2_collect_utterances`·`3_analyze_gemini` 경로는 2026-11-01 삭제. 지금 흐름은 `pipeline/README.md`.
