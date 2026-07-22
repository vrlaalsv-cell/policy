// [1] 국회의원 인적사항 수집 → data/members.json
//     열린국회정보 오픈API(현직 인적사항). ASSEMBLY_API_KEY 필요.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { requireEnv, paths } from "./lib/env.mjs";
import { fetchAll, SERVICE } from "./lib/assembly.mjs";
import { districtToSido } from "./lib/config.mjs";

const key = requireEnv("ASSEMBLY_API_KEY");

console.log("국회의원 인적사항 수집 중…");
const rows = await fetchAll(key, SERVICE.members);
console.log(`  ${rows.length}명 수신`);

const members = rows.map((r) => {
  const committee = (r.CMITS || r.CMIT_NM || "").split(/[,\/]/).map((s) => s.trim()).filter(Boolean);
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

mkdirSync(paths.data, { recursive: true });
writeFileSync(join(paths.data, "members.json"), JSON.stringify(members, null, 2), "utf8");
console.log(`✔ data/members.json 저장 (${members.length}명)`);

const noSido = members.filter((m) => !m.sido).length;
if (noSido) console.log(`  · 비례대표/시도 미매핑: ${noSido}명 (지도에는 표시되지 않음)`);
