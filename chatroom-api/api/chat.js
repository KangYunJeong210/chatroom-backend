const { GoogleGenAI } = require("@google/genai");

const FRIENDS = ["Aiden", "Lucas", "Maya", "Theo"];

/**
 * ✅ 1차 디버그용: CORS를 완전 개방(=연결부터 성공시키기)
 * 연결 확인되면 나중에 ALLOWED_ORIGIN 방식으로 잠그자.
 */
function setCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function stripCodeFences(s) {
  return String(s || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

// 모델이 JSON 앞뒤로 말 붙여도 { ... } 만 뽑아 파싱
function extractJsonObject(text) {
  const s = String(text || "");
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return s.slice(first, last + 1);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const extracted = extractJsonObject(text);
    if (!extracted) return null;
    try {
      return JSON.parse(extracted);
    } catch {
      return null;
    }
  }
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

function normalizeSummaryAppend(x) {
  if (!Array.isArray(x)) return [];
  return x
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .slice(0, 4);
}

function buildPrompt({ summary, messages, userMessage }) {
  const recent = (Array.isArray(messages) ? messages : [])
    .slice(-30)
    .map((m) => `${m?.from ?? ""}: ${m?.text ?? ""}`)
    .join("\n");

  const userLine = userMessage ? `user: ${userMessage}` : "(user is silent)";

  return `
You are a "Hogwarts Students Group Chat" simulator.
This chat never ends. Even if the user is silent, the 4 students keep chatting.

[World]
- Hogwarts, 5th-year student life: classes, library, Great Hall, dorm common rooms, house points, curfew, Quidditch.
- Keep it casual like a real chat app. No long narration.

[Characters — original students ONLY]
- Aiden (Gryffindor): bold, impulsive, direct; uses "lol", "seriously?" sometimes.
- Lucas (Ravenclaw): analytical, organized; cares about rules, exams, homework, points.
- Maya (Hufflepuff): warm mediator; empathetic, supportive, keeps the peace.
- Theo (Slytherin): witty, observant; drops rumors, secret passages, clever hints.

[Hard Rules]
- NEVER end the conversation. No goodbyes, no "let's stop", no "sleep now".
- In EVERY response, ALL FOUR speak (Aiden, Lucas, Maya, Theo) and each writes 1–2 sentences.
- At least ONE of them must ask a follow-up question OR propose the next action.
- Always leave at least ONE hook (new rumor, small event, plan, question) that continues the chat.
- If user is silent, continue naturally from the recent chat.
- Output must be JSON ONLY. No extra text.

[Output JSON schema — must match exactly]
{
  "messages": [
    { "from": "Aiden", "text": "..." },
    { "from": "Lucas", "text": "..." },
    { "from": "Maya", "text": "..." },
    { "from": "Theo", "text": "..." }
  ],
  "summary_append": ["0-2 short facts worth remembering"]
}

[Memory Summary]
${summary || "(none)"}

[Recent Chat]
${recent || "(none)"}

[User Message]
${userLine}

Now produce the JSON response.
`.trim();
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  // Preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  // 디버그용: 브라우저에서 열면 살아있는지 확인 가능
  if (req.method === "GET") return res.status(200).json({ ok: true, route: "/api/chat" });

  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    const body = req.body || {};
    const summary = typeof body.summary === "string" ? body.summary : "";
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const userMessage = typeof body.userMessage === "string" ? body.userMessage.trim() : "";

    const ai = new GoogleGenAI({ apiKey });

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const prompt = buildPrompt({ summary, messages, userMessage });

    const result = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 650,
      },
    });

    const raw = stripCodeFences(result?.text || "");
    const data = safeJsonParse(raw);

    // 파싱 실패 시 안전 응답
    if (!data || !data.messages) {
      return res.status(200).json({
        messages: [
          { from: "Aiden", text: "Lol my spell fizzled—say that again?" },
          { from: "Lucas", text: "Something glitched. Try once more." },
          { from: "Maya", text: "It’s okay! What were you saying?" },
          { from: "Theo", text: "Even magic lags. Anyway—did you hear that rumor?" },
        ],
        summary_append: [],
      });
    }

    // 항상 4명 채우기
    const normalized = normalizeMessages(data.messages);
    const map = new Map(normalized.map((m) => [m.from, m]));
    const filled = FRIENDS.map((name) => map.get(name) || { from: name, text: "..." });

    const summary_append = normalizeSummaryAppend(data.summary_append);

    return res.status(200).json({ messages: filled, summary_append });
  } catch (e) {
    return res.status(500).json({
      error: "server_error",
      detail: String(e?.message || e),
    });
  }
};
