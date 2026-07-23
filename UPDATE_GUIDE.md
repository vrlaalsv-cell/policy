# 국회의원 데이터 자동 업데이트 가이드

## 기능 개요

대시보드 오른쪽 위에 "🔄 업데이트" 버튼을 추가하여, 최신 국회의원 데이터를 자동으로 수집하고 Google Drive에 Excel 형식으로 업로드합니다.

## 필수 환경 변수

다음 3가지 환경 변수를 설정해야 합니다:

### 1. `ASSEMBLY_API_KEY` (국회 API 키)
```
ASSEMBLY_API_KEY=785a898e8c674fa2883460654223154e
```

### 2. `GOOGLE_FOLDER_ID` (Google Drive 폴더 ID)
```
GOOGLE_FOLDER_ID=1FbC3BrfAlgWTActBQLQFSn_BP6PR0lOh
```

폴더 ID는 Google Drive 폴더 링크에서 추출합니다:
- 링크: `https://drive.google.com/drive/folders/{FOLDER_ID}`

### 3. `GOOGLE_CREDENTIALS` (Google Service Account JSON)

JSON 전체를 환경 변수로 설정합니다. 방법은 두 가지입니다:

**옵션 A: 환경 변수 직접 설정**
```bash
# Windows (PowerShell)
$env:GOOGLE_CREDENTIALS = '{"type":"service_account",...}'

# Linux/Mac
export GOOGLE_CREDENTIALS='{"type":"service_account",...}'
```

**옵션 B: .env 파일 사용 (권장)**
```bash
# .env 파일 생성
ASSEMBLY_API_KEY=785a898e8c674fa2883460654223154e
GOOGLE_FOLDER_ID=1FbC3BrfAlgWTActBQLQFSn_BP6PR0lOh
GOOGLE_CREDENTIALS={"type":"service_account","project_id":"seventh-terrain-449806-t5",...}
```

## 사용 방법

### 1. 대시보드에서 업데이트 버튼 클릭
- 대시보드 오른쪽 위에서 "🔄 업데이트" 버튼을 찾습니다
- 클릭하면 자동으로 다음을 수행합니다:
  1. 국회 API에서 최신 의원 데이터 수집
  2. 기존 데이터와 비교하여 변경사항 확인
  3. 변경이 있으면 Excel 파일 생성
  4. Google Drive 지정 폴더에 업로드

### 2. CLI에서 직접 실행
```bash
# 환경 변수 설정 후 실행
node pipeline/update-assembly.mjs
```

## 생성되는 Excel 파일

- **파일명**: `국회의원_YYYY-MM-DD.xlsx`
- **시트 1**: 의원목록
  - 순번, 이름, 정당, 시도, 지역구, 위원회, 선수
- **시트 2**: 정당통계
  - 정당별 의원 인원 통계

## 응답 메시지

| 메시지 | 의미 |
|--------|------|
| ✔ 변경사항 없음 | 데이터가 이미 최신 상태 |
| ✔ Google Drive 업로드 완료 | 새 데이터로 Excel 파일이 생성되고 업로드됨 |
| ❌ 실패 | API 호출 실패 또는 Google Drive 업로드 실패 |

## 주의사항

- 업데이트 버튼은 한 번에 하나씩만 실행됩니다 (중복 클릭 방지)
- 변경사항이 없으면 Excel 파일을 생성하지 않습니다
- 업데이트 완료 후 자동으로 페이지를 새로고침합니다
- 타임아웃: 최대 5분 이내에 완료되어야 합니다
