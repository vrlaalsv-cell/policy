# NAS 배포 (Synology + Cloudflare Tunnel)

대시보드를 `pipeline/serve.mjs`(Node) 이미지로 굽고, Cloudflare 터널로 외부에 공개한다.
컨테이너는 **3개**: `policy-web`(Node) + `policy-scheduler`(기사 자동 재수집) + `policy-tunnel`(cloudflared).
포트포워딩·공인IP 불필요.

> nginx 가 아니라 Node 로 띄우는 이유: 화면의 **🔄 업데이트 버튼이 `POST /api/update` 를 호출**하기 때문에
> 정적 서버로만 올리면 그 기능이 404 로 죽는다.

| 항목 | 값 |
|---|---|
| NAS 경로 | `/volume2/docker/policy` |
| 컨테이너 포트 | 8137 (serve.mjs) → 호스트 **8007** (Tailscale `http://ys:8007`) |
| 공개 주소 | `https://7.yes-i-can.kr` (아래 A 에서 직접 만듦) |
| 터널 매핑 | `http://app:8137` |
| 필요 비밀값 | `.env` 의 `CLOUDFLARE_TUNNEL_TOKEN` (`eyJ...`) |
| 선택 비밀값 | 업데이트 버튼용 `ASSEMBLY_API_KEY` · `GOOGLE_CREDENTIALS` · `GOOGLE_FOLDER_ID` |

> ⚠ **토큰은 채팅·git 에 붙여넣지 말 것.** `eyJ...` = Cloudflare 터널 토큰 / `ghp...` = GitHub PAT. 헷갈리면
> 터널 로그에 `Provided Tunnel token is not valid.` 가 무한 반복된다.

---

## A. Cloudflare — 터널 만들고 토큰 받기

1. Cloudflare 대시보드 → **Zero Trust** → Networks → **Tunnels** → Create a tunnel → **Cloudflared** 선택
2. 이름: `policy` → Save. 다음 화면에 뜨는 **긴 토큰(`eyJ...`)** 을 복사 (Docker 설치 명령 안에 들어 있음)
3. **Public hostname** 탭 → Add a public hostname
   - Subdomain `7` / Domain `yes-i-can.kr`  ← 7조라서 `7.yes-i-can.kr`
   - Type `HTTP` / URL `app:8137`
4. (권장) Zero Trust → **Access** → Applications → Add an application → Self-hosted
   - 도메인 `7.yes-i-can.kr`, 정책은 **Emails** 로 팀원 6명 이메일만 허용
   - 조별과제 데이터이므로 Access 없이 두면 **주소만 알면 누구나** 들어온다.
     발표·시연 때만 잠깐 열어두고 싶으면 Access 를 나중에 붙였다 떼도 된다 (코드 수정 0)
   - ⚠ **업데이트 버튼(`POST /api/update`)이 인증 없이 노출**된다. 누르면 국회 API 수집 + Google Drive
     업로드가 돌아가므로, 공개해 둘 거면 Access 를 거는 편이 안전하다.

## B. GitHub — 배포할 코드 올리기 (PC)

```bash
cd C:\AI\policy; git push origin main
```

## C. NAS — 클론 & 기동

PowerShell 에서 NAS 접속:

```bash
ssh yongsilver@ys
```

첫 배포 (한 번만):

```bash
sudo mkdir -p /volume2/docker/policy
sudo chown yongsilver:users /volume2/docker/policy
cd /volume2/docker
git clone https://github.com/vrlaalsv-cell/policy.git policy
cd policy
git config core.autocrlf false
```

`.env` 만들기 — `<토큰>` 자리에 A-2 에서 복사한 `eyJ...` 를 붙여넣는다 (Synology 에는 `nano` 가 없다):

```bash
cd /volume2/docker/policy
echo 'CLOUDFLARE_TUNNEL_TOKEN=<토큰>' > .env
chmod 600 .env
```

기동:

```bash
cd /volume2/docker/policy
sudo docker compose up -d --build
```

**터널 토큰이 아직 없다면** — 대시보드만 먼저 띄우고(Tailscale `http://ys:8007`) 나중에 터널을 붙여도 된다.
`.env` 는 비어 있어도 파일 자체는 있어야 한다:

```bash
cd /volume2/docker/policy
echo 'CLOUDFLARE_TUNNEL_TOKEN=' > .env
sudo docker compose up -d --build app
```

토큰이 생기면 `.env` 를 채우고 전체 기동:

```bash
cd /volume2/docker/policy
sudo docker compose up -d
```

> J4125 라서 첫 빌드에 몇 분 걸린다. 멈춘 것처럼 보여도 **Ctrl+C 금지**.
> `sudo` 비밀번호는 **`yongsilver` 계정 비번**(DSM 로그인 이메일 아님)이고 입력해도 화면에 안 보이는 게 정상.

## D. 확인

```bash
cd /volume2/docker/policy
sudo docker compose ps
curl -s localhost:8007/build.txt
sudo docker compose logs --tail=30 tunnel
```

- `build.txt` 에 방금 빌드 시각이 찍히면 새 이미지가 뜬 것이다.
- 터널 로그에 `Registered tunnel connection` 이 보이면 연결 성공.
- 브라우저: `https://7.yes-i-can.kr` · Tailscale: `http://ys:8007`

## D-2. 자동화 (기사 자동수집 + 자동배포)

두 가지가 따로 돈다. **①은 컨테이너가 알아서** 하고, **②는 DSM 스케줄러에 한 번만 등록**하면 된다.

### ① 기사 자동 재수집 — 등록할 것 없음

`docker compose up -d` 하면 `policy-scheduler` 컨테이너가 같이 뜬다.

- **하루 5번(06 / 09 / 12 / 15 / 18시 KST)** `collect:news → fetch:excerpts` 를 자동 실행
  (정치 뉴스는 시의성이 중요해 업무시간 내내 3시간 간격)
- 컨테이너가 **시작될 때** 데이터가 4시간 넘게 낡았으면 즉시 1회 수집 (재빌드 직후 공백 방지)
- 결과는 `./runtime/` 에 쌓이고, 웹 컨테이너가 `runtime/news.js` 를 **우선 서빙** → 재빌드와 무관하게 최신 유지
- 수집이 실패하면 기존 데이터를 **덮어쓰지 않고** 그대로 둔다 (안전장치 내장)

**이 자동 재수집(①) 자체는 비용 0원** — Google 뉴스 RSS(무료)만 쓰고 유료 API는 이 컨테이너에 없다.
회당 4~5분 걸리고(목록 336명 ≈ 3.8분 + 새 기사 본문만 증분), NAS CPU 부담도 미미하다.

> ⚠ 대시보드의 다른 데이터(청와대 회의록 판정, 국회 발언 성향 태깅, 인물별 AI 종합분석)는 이 자동화
> 범위 밖이다 — PC 에서 Claude Code 세션으로 사람이 주기적으로 돌려 커밋해야 갱신된다. 절차·비용은
> [AUTOMATION_TODO.md](AUTOMATION_TODO.md) 와 `pipeline/README.md` 참고.
횟수를 바꾸려면 `docker-compose.yml` 의 `NEWS_AT` 에 시각을 쉼표로 넣으면 된다:

```yaml
- NEWS_AT=06:00,09:00,12:00,15:00,18:00,21:00
```

> 다만 하루 10회 이상은 권하지 않는다. 실측상 **에너지 관련 새 기사는 하루 10건 안팎**이라 더 자주 돌아도
> 얻는 게 거의 없고, Google 쪽에서 요청 폭주로 차단당할 위험만 커진다.

확인:

```bash
cd /volume2/docker/policy
sudo docker compose logs --tail=20 scheduler
```

`가동 — 매일 06:00,09:00,12:00,15:00,18:00 (KST) 수집` 이 보이면 정상(시각은 `docker-compose.yml` 의
`NEWS_AT` 값 그대로 찍힌다). 수집이 돌면 `수집 시작/완료` 가 찍힌다.

### ② 자동배포 — DSM 작업 스케줄러에 1회 등록 (사용자 작업)

`main` 에 push 되면 NAS 가 알아서 `git pull` + 재빌드한다. **등록 방식이 두 가지**이고 원하는 쪽을 고르면 된다.
둘 다 등록해도 된다 — `autodeploy.sh` 에 잠금이 걸려 있어 동시에 돌지 않는다.

**방법 A — 예약된 작업 (← 현재 운영 중인 설정)**

DSM → 제어판 → 작업 스케줄러 → **생성 → 예약된 작업 → 사용자 정의 스크립트**

| 항목 | 값 |
|---|---|
| 작업 이름 | `policy-autodeploy` |
| 사용자 | **root** |
| 일정 | 매일 · 첫 실행 **06:00** · **3시간마다 반복** |
| 명령 | `sh /volume2/docker/policy/scripts/autodeploy.sh` |

> ⚠️ 명령은 반드시 **`autodeploy.sh`** (루프 아님). `autodeploy-loop.sh` 를 예약에 걸면 끝나지 않는 루프가
> 실행될 때마다 뜨려 한다(지금은 잠금이 있어 사고는 안 나지만, 예약 주기가 무의미해진다).

DSM 이 알아서 관리하므로 프로세스가 죽어도 다음 시간에 되살아나고, 목록에 `다음 실행 시간` 이 보인다.
**단점은 최대 1시간 지연**(DSM 예약 작업의 최소 주기가 1시간이라 더 짧게 잡을 수 없다).

**방법 B — 트리거된 작업 (부팅 시, 10분 주기)**

배포를 10분 안에 반영하고 싶을 때. 생성 → **트리거된 작업** → 사용자 정의 스크립트

| 항목 | 값 |
|---|---|
| 작업 이름 | `policy-autodeploy-loop` |
| 사용자 | **root** |
| 이벤트 | **부팅 시** |
| 명령 | `sh /volume2/docker/policy/scripts/autodeploy-loop.sh` |

만든 뒤 목록에서 선택 → **실행** 을 눌러 바로 켠다. 무한 루프라 목록에 계속 "실행 중" 으로 남는 게 정상이다.

> ⭐ DSM 예약 작업은 최소 주기가 1시간이라, 여기서는 스케줄러를 **점화플러그로만** 쓰고
> 실제 주기는 스크립트 안의 `sleep 600`(10분)이 만든다. 주기는 `autodeploy-loop.sh` 의 `INTERVAL` 로 바꾼다.
> 대신 루프가 죽으면 **재부팅 전까지 되살아나지 않는다** — 그래서 A 를 같이 등록해두면 보험이 된다.

동작 확인:

```bash
tail -20 /volume2/docker/policy/runtime/autodeploy.log
```

변경이 없으면 아무것도 안 찍히는 게 정상이고, 새 커밋이 있을 때만 `새 커밋 감지 → 배포 완료` 가 남는다.

## E. 갱신 (평상시 배포)

코드·데이터를 바꾼 뒤 PC 에서 push → NAS 에서:

```bash
cd /volume2/docker/policy
git pull
sudo docker compose up -d --build
```

> 자동화(D-2)를 켰다면 **아무것도 안 해도 된다** — push 하면 10분 안에 NAS 가 알아서 따라온다.

**기사 데이터는 이제 NAS 스케줄러가 매일 자동 수집한다.** PC 에서 직접 돌려 커밋하고 싶을 때만:

```bash
cd C:\AI\policy; npm run collect:news; git add data/news.json web/news.js; git commit -m "기사 데이터 갱신"; git push origin main
```

그 다음 NAS 에서 위 `git pull` + `up -d --build`.

> 매번 SSH 하기 싫으면 DSM **작업 스케줄러**로 자동배포(10분마다 `git pull` 후 변경 시 rebuild)를 걸 수 있다.
> 패턴과 함정(root 의 git *dubious ownership*, 스케줄러 1시간 하한 우회)은 `C:\AI\CLAUDE.md` 참고.

## F. 트러블슈팅

| 증상 | 원인/조치 |
|---|---|
| 터널 로그에 `Provided Tunnel token is not valid.` 무한 반복 | `.env` 에 GitHub PAT(`ghp...`)를 넣었거나 토큰이 잘림. `eyJ...` 전체인지 확인 |
| `https://7.yes-i-can.kr` 502/1033 | Public hostname URL 이 `app:8137` 인지 확인 (`localhost:8007` 아님 — 컨테이너끼리는 **서비스명:컨테이너포트** 로 통신) |
| 업데이트 버튼이 "❌ 실패" | `.env` 에 `ASSEMBLY_API_KEY`·`GOOGLE_CREDENTIALS`·`GOOGLE_FOLDER_ID` 가 없으면 정상 실패다. `sudo docker compose logs app` 으로 확인 |
| 화면이 옛날 데이터 | 클라 캐시인지 미배포인지 `/build.txt` 로 판별. 브라우저는 시크릿창 또는 `Ctrl+Shift+R` |
| DSM 재부팅 후 Container Manager 에서 프로젝트가 안 보임 | 컨테이너는 살아 있다. `sudo docker compose ps` 로 확인, 재생성하지 말 것 |
| 디스크 부족 | `sudo docker system prune -af` 로 안 쓰는 이미지·빌드캐시 정리 |

## 메모 — 지금 배포되는 것

- 이 구성은 **대시보드(`web/`) + `POST /api/update`** 를 서비스한다. `web/index.html` 자체에
  로고+청와대/국회 랜딩이 들어 있어 그것만으로 완결된 화면이다.
- 검색엔진 차단은 `web/robots.txt` 로 한다(정적 서버라 헤더 주입이 없다). 확실히 막으려면 Cloudflare Access.
- Next.js 랜딩(`app/`)은 아직 배포 대상이 아니다. 나중에 붙이려면 Next `standalone` 빌드 이미지를 만들어
  `app` 서비스를 교체하고, `web/` 을 `public/dash/` 로 복사해 같은 출처에서 서비스하는 방식이 깔끔하다
  (그러면 `NEXT_PUBLIC_DASHBOARD_URL=/dash` 로 상대경로 처리 가능).
