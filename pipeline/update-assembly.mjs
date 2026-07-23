import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import XLSX from "xlsx";
import { fetchAll, SERVICE } from "./lib/assembly.mjs";
import { uploadFile } from "./lib/google-drive.mjs";
import { districtToSido } from "./lib/config.mjs";

// 환경 변수 확인
const API_KEY = process.env.ASSEMBLY_API_KEY;
const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS;
const GOOGLE_FOLDER_ID = process.env.GOOGLE_FOLDER_ID;

if (!API_KEY) throw new Error("ASSEMBLY_API_KEY 환경변수 필요");

const DATA_DIR = join(process.cwd(), "data");
const MEMBERS_FILE = join(DATA_DIR, "members.json");

console.log("🔄 국회의원 데이터 업데이트 중…");

try {
  // 기존 데이터 읽기
  let existingMembers = [];
  try {
    const existing = readFileSync(MEMBERS_FILE, "utf8");
    existingMembers = JSON.parse(existing);
  } catch {
    console.log("  (기존 데이터 없음)");
  }

  // API에서 새 데이터 수집
  const rows = await fetchAll(API_KEY, SERVICE.members);
  console.log(`  ${rows.length}명 수신`);

  // 데이터 변환
  const members = rows.map((r) => {
    const committee = (r.CMITS || r.CMIT_NM || "")
      .split(/[,\/]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const terms = (r.UNITS || "").split(",").filter(Boolean).length || undefined;
    return {
      id: r.MONA_CD || r.HG_NM,
      name: r.HG_NM,
      party: r.POLY_NM || "무소속",
      sido: districtToSido(r.ORIG_NM),
      district: r.ORIG_NM || "비례대표",
      committee,
      terms,
    };
  });

  // 새로운 데이터가 있는지 확인
  const isChanged =
    members.length !== existingMembers.length ||
    JSON.stringify(members) !== JSON.stringify(existingMembers);

  // 새 데이터 저장
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(MEMBERS_FILE, JSON.stringify(members, null, 2), "utf8");
  console.log(`✔ data/members.json 저장 (${members.length}명)`);

  // 변경사항이 있을 때만 Excel 생성 및 업로드
  if (isChanged && GOOGLE_CREDENTIALS && GOOGLE_FOLDER_ID) {
    // Excel 파일 생성
    const wb = XLSX.utils.book_new();

    // 시트 1: 의원 목록
    const ws1Data = members.map((m, idx) => ({
      순번: idx + 1,
      이름: m.name,
      정당: m.party,
      시도: m.sido || "미등록",
      지역구: m.district,
      위원회: m.committee.join(", "),
      선수: m.terms || "-",
    }));
    const ws1 = XLSX.utils.json_to_sheet(ws1Data);
    ws1["!cols"] = [
      { wch: 6 },
      { wch: 12 },
      { wch: 10 },
      { wch: 10 },
      { wch: 16 },
      { wch: 20 },
      { wch: 6 },
    ];
    XLSX.utils.book_append_sheet(wb, ws1, "의원목록");

    // 시트 2: 정당별 통계
    const partyStats = {};
    members.forEach((m) => {
      partyStats[m.party] = (partyStats[m.party] || 0) + 1;
    });
    const ws2Data = Object.entries(partyStats)
      .sort((a, b) => b[1] - a[1])
      .map(([party, count], idx) => ({
        순번: idx + 1,
        정당: party,
        인원: count,
      }));
    const ws2 = XLSX.utils.json_to_sheet(ws2Data);
    ws2["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws2, "정당통계");

    // 파일 저장
    const timestamp = new Date().toISOString().split("T")[0];
    const excelPath = join(DATA_DIR, `members_${timestamp}.xlsx`);
    XLSX.writeFile(wb, excelPath);
    console.log(`✔ Excel 파일 생성: members_${timestamp}.xlsx`);

    // Google Drive에 업로드
    console.log("📤 Google Drive에 업로드 중…");
    const fileId = await uploadFile(
      GOOGLE_FOLDER_ID,
      excelPath,
      `국회의원_${timestamp}.xlsx`,
      GOOGLE_CREDENTIALS
    );
    console.log(`✔ Google Drive 업로드 완료 (ID: ${fileId})`);
    console.log(`  https://drive.google.com/file/d/${fileId}`);
  } else if (!isChanged) {
    console.log("  변경사항 없음");
  } else if (!GOOGLE_CREDENTIALS || !GOOGLE_FOLDER_ID) {
    console.log("  ⚠️  Google Drive 환경변수 없음 (파일 업로드 스킵)");
  }

  console.log("✔ 업데이트 완료");
  process.exit(0);
} catch (error) {
  console.error("❌ 오류:", error.message);
  process.exit(1);
}
