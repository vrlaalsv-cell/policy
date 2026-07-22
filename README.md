# 정책돋보기

국회·청와대 발언을 데이터로 분석하는 정책 인텔리전스 프로젝트입니다.

## 개발 서버 실행

```bash
npm install
npm run dev
```

http://localhost:3000 에서 확인할 수 있습니다.

## 구조

- `app/page.tsx` — 랜딩 페이지 (청와대 / 국회 카드)
- `app/blue-house`, `app/assembly` — 대시보드 플레이스홀더 페이지
- `components/NavCard.tsx` — 호버 효과가 있는 카드 컴포넌트
