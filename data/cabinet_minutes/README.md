# 국무회의 회의록 지정 폴더

청와대/국무회의 **회의록 파일을 이 폴더에 넣어주세요.** 파이프라인이 이 폴더를 읽어
각 **국무위원(총리·장차관)** 의 에너지 성향을 분석하고 DB화합니다.

## 넣는 방법
- 지원 형식(권장): `.txt`, `.md`, `.pdf`, `.hwp→변환 텍스트`
- 파일명 예: `2026-03-15_국무회의.txt`, `2026-04-02_국무회의.pdf`
- 회의 날짜가 파일명이나 본문 첫 줄에 있으면 자동 인식에 도움이 됩니다.

## 처리 흐름
옛 `4_analyze_cabinet.mjs`(Gemini) 경로는 2026-11-01 삭제했다. 지금 흐름은 `pipeline/README.md` '청와대(국무·차관회의) 갱신'
(update-cabinet → extract → cab_todo → wf_cabinet → collect_cab → build_cabinet2).

> 이 폴더의 실제 회의록 파일은 `.gitignore` 로 git 에서 제외됩니다(개인정보/저작권).
> 경로는 `.env` 의 `CABINET_MINUTES_DIR` 로 바꿀 수 있습니다.
