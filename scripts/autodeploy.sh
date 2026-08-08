#!/bin/sh
# 자동배포 1회분 — git 에 새 커밋이 있으면 pull 하고 컨테이너를 다시 올린다.
# 변경이 없으면 아무것도 하지 않는다(= 재빌드로 서비스가 끊기지 않음).
#
# 사용: sudo sh /volume2/docker/policy/scripts/autodeploy.sh
# 로그: /volume2/docker/policy/runtime/autodeploy.log
set -u

DIR=/volume2/docker/policy
LOG="$DIR/runtime/autodeploy.log"
mkdir -p "$DIR/runtime"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

cd "$DIR" || { log "폴더 없음: $DIR"; exit 1; }

# ⚠ 스케줄러는 root 로 도는데 repo 는 yongsilver 소유 → git 이 'dubious ownership' 으로 거부한다.
#   이게 자동배포가 조용히 멈추는 1순위 원인이라 매번 확인해서 스스로 고친다.
git config --file /root/.gitconfig --get-all safe.directory | grep -qx "$DIR" 2>/dev/null \
  || git config --file /root/.gitconfig --add safe.directory "$DIR"

BEFORE=$(git rev-parse HEAD 2>/dev/null)
git fetch origin main >/dev/null 2>&1 || { log "fetch 실패(네트워크?)"; exit 1; }

REMOTE=$(git rev-parse origin/main 2>/dev/null)
if [ "$BEFORE" = "$REMOTE" ]; then
  exit 0                      # 변경 없음 — 조용히 종료
fi

log "새 커밋 감지: ${BEFORE%${BEFORE#???????}} -> ${REMOTE%${REMOTE#???????}}"
if ! git pull --ff-only origin main >>"$LOG" 2>&1; then
  log "pull 실패 — 로컬 변경이 있는지 확인 필요 (runtime/ 외 파일을 컨테이너가 건드리면 안 됨)"
  exit 1
fi

log "재빌드 시작"
if docker compose up -d --build >>"$LOG" 2>&1; then
  log "배포 완료: $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"
else
  log "재빌드 실패 — docker compose 로그 확인 필요"
  exit 1
fi
