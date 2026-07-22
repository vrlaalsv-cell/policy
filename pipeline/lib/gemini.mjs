// Google Gemini 호출 헬퍼 (generateContent + JSON 구조화 출력)
// ⚠ 대량 1차 배치는 비용 절감을 위해 Batch API 사용 권장 (TODO). 여기서는 동기 호출.
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export async function geminiJSON({ apiKey, model, prompt, schema, maxOutputTokens = 512 }) {
  const url = `${ENDPOINT}/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens,
      responseMimeType: "application/json",
      ...(schema ? { responseSchema: schema } : {}),
      // thinking(추론)은 태깅에서 끄는 것을 권장 — 모델별 파라미터 확인 후 설정
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Gemini 응답 JSON 파싱 실패: ${text.slice(0, 200)}`);
  }
}

// 의원/국무위원 1인 성향 태깅 스키마 (사업별 favor|neutral|oppose|unknown + 근거)
export const STANCE_SCHEMA = {
  type: "object",
  properties: {
    stance: {
      type: "object",
      properties: {
        LNG: { type: "string", enum: ["favor", "neutral", "oppose", "unknown"] },
        H2: { type: "string", enum: ["favor", "neutral", "oppose", "unknown"] },
        RE: { type: "string", enum: ["favor", "neutral", "oppose", "unknown"] },
        CITYGAS: { type: "string", enum: ["favor", "neutral", "oppose", "unknown"] },
        POWER: { type: "string", enum: ["favor", "neutral", "oppose", "unknown"] },
      },
      required: ["LNG", "H2", "RE", "CITYGAS", "POWER"],
    },
    quotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          biz: { type: "string", enum: ["LNG", "H2", "RE", "CITYGAS", "POWER"] },
          text: { type: "string" },
        },
        required: ["biz", "text"],
      },
    },
  },
  required: ["stance"],
};

export function buildTaggingPrompt(name, utterances) {
  const joined = utterances.slice(0, 40).map((u, i) => `(${i + 1}) ${u}`).join("\n");
  return [
    `다음은 "${name}"의 국회/회의 발언 중 에너지 관련으로 필터링된 목록이다.`,
    `이 사람의 각 에너지 사업에 대한 성향을 판정하라.`,
    `사업: LNG, H2(수소), RE(재생에너지), CITYGAS(도시가스), POWER(전력).`,
    `각 사업을 favor(우호)/neutral(중립)/oppose(비우호)/unknown(자료부족) 중 하나로.`,
    `근거가 되는 실제 발언을 사업별로 최대 1개씩 quotes 에 원문 그대로 담아라(없으면 생략).`,
    `발언이 없거나 불명확하면 unknown.`,
    ``,
    `[발언 목록]`,
    joined || "(관련 발언 없음)",
  ].join("\n");
}
