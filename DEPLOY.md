# NAS 배포 (Synology + Cloudflare Tunnel)

대시보드를 `pipeline/serve.mjs`(Node) 이미지로 굽고, Cloudflare 터널로 외부에 공개한다.
컨테이너는 **2개**: `policy-web`(Node) + `policy-tunnel`(cloudflared). 포트포워딩·공인IP 불필요.

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

## E. 갱신 (평상시 배포)

코드·데이터를 바꾼 뒤 PC 에서 push → NAS 에서:

```bash
cd /volume2/docker/policy
git pull
sudo docker compose up -d --build
```

**기사 데이터 갱신은 PC 에서** 한다 (수집기는 이미지에 안 들어 있다):

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
