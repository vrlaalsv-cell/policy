#!/bin/sh
# 국회의원 사진 썸네일 만들기 — 원본(web/images/parliament_photos, 최대 22MB)은 그대로 두고
# 화면용 작은 jpg 를 web/images/parliament_thumbs/<이름>.jpg 로 만든다.
# 화면 칸이 140×160(폰 160×200)이라 2배인 320×400 을 꽉 채우는 크기로 줄인다(잘림은 CSS object-fit 이 맡음).
# 같은 이름의 jpg·png 가 둘 다 있으면 jpg 를 쓴다(예전 화면이 jpg 를 먼저 불렀다).
# 이미 있고 원본보다 새 썸네일은 건너뛴다. 새 사진을 넣으면 다시 돌리면 된다. 필요: ImageMagick(convert).
#   사용: sh scripts/make_thumbs.sh
set -e
cd "$(dirname "$0")/.."
SRC=web/images/parliament_photos
DST=web/images/parliament_thumbs
mkdir -p "$DST"
made=0
for f in "$SRC"/*.jpg "$SRC"/*.jpeg "$SRC"/*.png; do
  [ -e "$f" ] || continue
  name=$(basename "$f"); name=${name%.*}
  case "$f" in *.png) [ -e "$SRC/$name.jpg" ] && continue ;; esac
  out="$DST/$name.jpg"
  [ -e "$out" ] && [ "$out" -nt "$f" ] && continue
  convert "$f[0]" -auto-orient -thumbnail '320x400^' -background white -flatten \
    -strip -quality 82 -sampling-factor 4:2:0 -interlace JPEG "$out"
  made=$((made + 1))
done
echo "썸네일 $made 장 새로 만듦 → $DST ($(ls "$DST" | wc -l) 장)"
