# 정책돋보기 대시보드 — pipeline/serve.mjs (정적 web/ + POST /api/update) 단일 이미지
#   nginx 가 아니라 Node 로 띄우는 이유: 동료가 추가한 "🔄 업데이트" 버튼이
#   POST /api/update 를 호출하므로 정적 서버만으로는 그 기능이 죽는다.
#   빌드 컨텍스트는 저장소 루트.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8137

# 의존성 먼저 (소스만 바뀌면 이 레이어는 캐시되어 재빌드가 빠르다)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY pipeline/ ./pipeline/
COPY web/ ./web/
COPY data/ ./data/

# 배포 확인용 워터마크 — https://<도메인>/build.txt
RUN date -u +"build %Y-%m-%d %H:%M UTC" > /app/web/build.txt

EXPOSE 8137

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8137/build.txt > /dev/null || exit 1

CMD ["node", "pipeline/serve.mjs"]
