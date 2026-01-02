import { GoogleGenAI } from "@google/genai";

const FRIENDS = ["민지", "준호", "서연", "태오"];

function setCors(res) {
  const origin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// 모델이 가끔 ```json ``` 같은 걸 붙이는 경우가 있어 제거
function stripCodeFences(s) {
  const t = String(s || "").trim();
  return t
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function normalizeMessages(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((m) => ({
      from: typeof m?.from === "string" ? m.from.trim() : "",
      text: typeof m?.text === "string" ? m.text.trim() : "",
    }))
    .filter((m) => FRIENDS.includes(m.from) && m.text)
    .slice(0, 4);
}

function buildPrompt({ summary, messages, userMessage }) {
  const recent = (Array.isArray(messages) ? messages : [])
    .slice(-30)
    .map((m) => `${m?.from ?? ""}: ${m?.text ?? ""}`)
    .join("\n");

  // 카톡풍: 짧고 자연스러운 톡, 서로 말 이어받기
  return `
너는 '카톡 단톡방' 시뮬레이터다.

[등장인물]
- 민지: 장난+눈치 빠름, 짧게 툭툭, 가끔 ㅋㅋ/이모지(과하지 않게)
- 준호: 현실 조언/정리 담당, 담담한 말투, 가끔 걱정해줌
- 서연: 공감형, 부드럽게 맞장구, 감정 캐치
- 태오: 분위기메이커, 드립/짤 말투(텍스트로만), 텐션 담당

[규칙]
- 한 번의 응답에서 4명이 '자연스럽게 이어서' 각 1~2문장 말한다.
- 너무 길게 쓰지 말고 카톡처럼 짧게.
- 사용자가 방금 한 말에 반응 + 서로 말 이어받기(단톡 느낌).
- 출력은 "오직 JSON"만. 다른 말 금지.
- JSON 스키마(반드시 준수):
{
  "messages": [
    { "from": "민지", "text": "..." },
    { "from": "준호", "text": "..." },
    { "from": "서연", "text": "..." },
    { "from": "태오", "text": "..." }
  ],
  "summary_append": ["기억할만한 사실 1개", "사실 2개"]  // 없으면 빈 배열 가능
}

[대화 요약]
${summary || "(없음)"}

[최근 대화]
${recent || "(없음)"}

[사용자]
me: ${userMessage}
`;
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    const body = req.body || {};
    const userMessage = body.userMessage;

    if (!userMessage || typeof userMessage !== "string") {
      return res.status(400).json({ error: "userMessage required" });
    }

    const summary = typeof body.summary === "string" ? body.summary : "";
    const messages = Array.isArray(body.messages) ? body.messages : [];

    const ai = new GoogleGenAI({ apiKey });

    // 가볍게/빠르게: flash 계열 추천
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const prompt = buildPrompt({ summary, messages, userMessage });

    const result = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      // 너무 길어지는 거 방지(지원되는 경우만 적용됨)
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 600,
      },
    });

    const rawText = stripCodeFences(result?.text || "");
    let data = safeJsonParse(rawText);

    // 파싱 실패하면 최소 안전 응답
    if (!data) {
      return res.status(200).json({
        messages: [
          { from: "민지", text: "어… 방금 뭐라했지? 다시 한번만ㅋㅋ" },
          { from: "준호", text: "잠깐 오류 난 듯. 한 번만 더 보내봐." },
          { from: "서연", text: "괜찮아! 다시 말해주면 이어갈게." },
          { from: "태오", text: "AI도 가끔 버퍼링 타는 날이 있지😵‍💫" },
        ],
        summary_append: [],
      });
    }

    const normalized = normalizeMessages(data.messages);

    // 4개 못 채우면 보정(최소 완성형)
    const byFrom = new Map(normalized.map((m) => [m.from, m]));
    const filled = FRIENDS.map((name) => byFrom.get(name) || { from: name, text: "ㅋㅋㅋ" });

    const summaryAppend = Array.isArray(data.summary_append)
      ? data.summary_append
          .map((x) => (typeof x === "string" ? x.trim() : ""))
          .filter(Boolean)
          .slice(0, 4)
      : [];

    return res.status(200).json({
      messages: filled,
      summary_append: summaryAppend,
    });
  } catch (e) {
    return res.status(500).json({
      error: "server_error",
      detail: String(e?.message || e),
    });
  }
}
