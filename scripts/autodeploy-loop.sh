#!/bin/sh
# 자동배포 루프 — DSM 작업 스케줄러의 '부팅 시 실행' 으로 딱 한 번만 켜면 된다.
#
#   ⭐ DSM 스케줄러는 최소 주기가 1시간이라, 스케줄러에게 주기를 맡기지 않는다.
#      대신 여기서 무한 루프를 돌며 sleep 으로 진짜 주기를 만든다(= 10분).
#      스케줄러는 '점화플러그' 역할만 하므로 1시간 제한과 무관하다.
#
# 등록: DSM 제어판 → 작업 스케줄러 → 생성 → 트리거된 작업 → 사용자 정의 스크립트
#       사용자: root / 이벤트: 부팅 시
#       명령: sh /volume2/docker/policy/scripts/autodeploy-loop.sh
set -u

DIR=/volume2/docker/policy
INTERVAL=600                     # 10분. 5분으로 줄이려면 300
LOCK="$DIR/runtime/autodeploy.lock"
mkdir -p "$DIR/runtime"

# 중복 실행 방지 — 재부팅·수동 실행·(실수로) 예약 작업에 걸어도 루프가 여러 개 쌓이지 않게 한다.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK"
  flock -n 9 || exit 0
else
  # flock 이 없는 환경 대비 — PID 파일로 같은 역할을 한다.
  PIDF="$DIR/runtime/autodeploy-loop.pid"
  if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF" 2>/dev/null)" 2>/dev/null; then
    exit 0                       # 이미 돌고 있음
  fi
  echo $$ > "$PIDF"
  trap 'rm -f "$PIDF"' EXIT INT TERM
fi

while true; do
  sh "$DIR/scripts/autodeploy.sh"
  sleep "$INTERVAL"
done
