# 정책돋보기 대시보드 (web/ 정적 파일) — nginx 단일 이미지
#   빌드 컨텍스트는 저장소 루트: docker compose build 가 알아서 잡는다.
#   web/data.js · web/news.js · web/cabinet.js 는 파이프라인 산출물이라
#   PC 에서 갱신 → git push → NAS 에서 pull + rebuild 하면 반영된다.
FROM nginx:alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY web/ /usr/share/nginx/html/

# 배포 확인용 워터마크 — https://<도메인>/build.txt 로 언제 빌드된 이미지인지 확인
RUN date -u +"build %Y-%m-%d %H:%M UTC" > /usr/share/nginx/html/build.txt

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/healthz || exit 1

EXPOSE 80
