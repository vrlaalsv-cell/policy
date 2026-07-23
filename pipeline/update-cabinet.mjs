import axios from "axios";
import { load } from "cheerio";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { uploadFile } from "./lib/google-drive.mjs";

// 환경 변수 확인
const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS;
const GOOGLE_FOLDER_ID = process.env.GOOGLE_FOLDER_ID;

const DATA_DIR = join(process.cwd(), "data");
const CABINET_MINUTES_DIR = join(DATA_DIR, "cabinet_minutes");
const CABINET_INDEX_FILE = join(DATA_DIR, "cabinet_minutes_index.json");

// 디렉토리 생성
if (!existsSync(CABINET_MINUTES_DIR)) mkdirSync(CABINET_MINUTES_DIR, { recursive: true });

console.log("🔄 정부24 청와대 회의록 업데이트 중…");

try {
  // 기존 인덱스 읽기
  let existingIndex = {};
  try {
    const existing = readFileSync(CABINET_INDEX_FILE, "utf8");
    existingIndex = JSON.parse(existing);
  } catch {
    console.log("  (기존 인덱스 없음)");
  }

  // 정부24 게시판 크롤링
  console.log("  정부24 게시판 크롤링 중…");
  const boardUrl = "https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardList.do?bbsId=BBSMSTR_000000000430";
  const response = await axios.get(boardUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    timeout: 30000,
  });

  const $ = load(response.data);
  const posts = [];

  // 게시글 목록 파싱
  $("table tbody tr").each((idx, el) => {
    const titleEl = $(el).find("a.bbs-title");
    const dateEl = $(el).find("td:nth-child(3)");
    const fileEl = $(el).find("a[href*='file']").first();

    if (titleEl.length && dateEl.length) {
      const title = titleEl.text().trim();
      const dateText = dateEl.text().trim();
      const href = titleEl.attr("href");

      posts.push({
        title,
        date: dateText,
        href,
        hasFile: fileEl.length > 0,
      });
    }
  });

  if (posts.length === 0) {
    console.log("  ⚠ 게시글을 찾을 수 없습니다.");
    process.exit(0);
  }

  console.log(`  총 ${posts.length}개의 게시글 발견`);

  // 7/6 이후의 게시글만 필터링
  const targetDate = new Date(2026, 6, 6); // 2026-07-06
  const newPosts = posts.filter((post) => {
    const postDate = parseDate(post.date);
    return postDate && postDate >= targetDate;
  });

  console.log(`  ${newPosts.length}개의 신규 게시글 발견 (7/6 이후)`);

  // 다운로드할 파일 목록
  let filesDownloaded = [];
  for (const post of newPosts) {
    try {
      console.log(`  다운로드 중: ${post.title}`);

      // 게시글 상세 페이지 접속
      const detailResponse = await axios.get(`https://www.mois.go.kr${post.href}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 30000,
      });

      const detail$ = load(detailResponse.data);
      const fileLinks = detail$("a[href*='download']");

      // 각 첨부파일 다운로드
      for (let i = 0; i < fileLinks.length; i++) {
        const fileHref = detail$(fileLinks[i]).attr("href");
        if (!fileHref) continue;

        const fileUrl = fileHref.startsWith("http") ? fileHref : `https://www.mois.go.kr${fileHref}`;
        const fileName = `${post.title.replace(/[\/\\:*?"<>|]/g, "_")}_${post.date.replace(/\./g, "-")}_${i + 1}.pdf`;

        const fileResponse = await axios.get(fileUrl, {
          responseType: "arraybuffer",
          timeout: 60000,
        });

        const filePath = join(CABINET_MINUTES_DIR, fileName);
        writeFileSync(filePath, fileResponse.data);
        filesDownloaded.push({ fileName, date: post.date, size: fileResponse.data.length });
        console.log(`    ✓ ${fileName} (${(fileResponse.data.length / 1024).toFixed(1)}KB)`);
      }
    } catch (err) {
      console.log(`    ✗ ${post.title} 다운로드 실패: ${err.message}`);
    }
  }

  // 변경사항 확인
  const hasChanges = filesDownloaded.length > 0 && JSON.stringify(existingIndex) !== JSON.stringify(filesDownloaded);

  if (hasChanges && GOOGLE_CREDENTIALS && GOOGLE_FOLDER_ID) {
    console.log("  구글 드라이브 업로드 중…");

    // 모든 다운로드 파일을 하나의 ZIP으로 압축하거나 폴더로 업로드
    // 현재는 각 파일을 개별 업로드 (간단함)
    for (const file of filesDownloaded) {
      try {
        const filePath = join(CABINET_MINUTES_DIR, file.fileName);
        const fileId = await uploadFile(GOOGLE_FOLDER_ID, filePath, file.fileName, GOOGLE_CREDENTIALS);
        console.log(`    ✓ ${file.fileName} 업로드 완료`);
      } catch (err) {
        console.log(`    ✗ ${file.fileName} 업로드 실패: ${err.message}`);
      }
    }
  }

  // 인덱스 저장
  writeFileSync(CABINET_INDEX_FILE, JSON.stringify(filesDownloaded, null, 2));

  console.log(`✔ 청와대 회의록 업데이트 완료 (${filesDownloaded.length}개 파일)`);
  process.exit(0);
} catch (error) {
  console.error(`✗ 오류: ${error.message}`);
  process.exit(1);
}

// 날짜 문자열 파싱 (YYYY.MM.DD 형식)
function parseDate(dateStr) {
  const match = dateStr.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (!match) return null;
  return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
}
