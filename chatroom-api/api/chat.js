import { GoogleGenAI } from "@google/genai";

const FRIENDS = ["Aiden", "Lucas", "Maya", "Theo"];

/**
 * CORS: GitHub Pages에서 Vercel API 호출 시 preflight(OPTIONS)가 먼저 옴.
 * - ALLOWED_ORIGIN 이 있으면 그 Origin만 허용
 * - 없으면 개발용으로 전체 허용(*)
 */
function setCors(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN; // 예: https://kangyunjeong210.github.io
  const origin = req.headers.origin;

  if (!allowed) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin === allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function stripCodeFences(s) {
  const t = String(s || "").trim();
  return t
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
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

  // “사용자 발언 없음”이어도 자기들끼리 굴러가게 만들기
  const userLine = userMessage ? `user: ${userMessage}` : "(사용자 발언 없음)";

  return `
You are a "Hogwarts Students Group Chat" simulator.
This group chat never ends. Even if the user is silent, the 4 students keep chatting.

[World]
- Hogwarts, 5th-year student life: classes, library, Great Hall, dorm common rooms, house points, curfew, Quidditch.
- Keep it casual like a real chat app. No long narration.

[Characters — original students ONLY]
- Aiden (Gryffindor): bold, impulsive, direct; uses "lol", "seriously?" sometimes.
- Lucas (Ravenclaw): analytical, organized; cares about rules, exams, homework, points.
- Maya (Hufflepuff): warm mediator; empathetic, supportive, keeps the peace.
- Theo (Slytherin): witty, observant; drops rumors, secret passages, clever hints.

[Hard Rules]
- NEVER end the conversation. No goodbyes, no "let's stop", no "that's it", no "sleep now".
- In EVERY response, ALL FOUR speak (Aiden, Lucas, Maya, Theo) and each writes 1–2 sentences.
- At least ONE of them must ask a follow-up question OR propose the next action.
- Always leave at least ONE "hook" that naturally continues the chat (new topic, rumor, small event).
- If the user did not speak, continue naturally from the recent chat.
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

export default async function handler(req, res) {
  setCors(req, res);

  // Preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  // (디버그용) 브라우저에서 열면 살아있는지 확인 가능
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "/api/chat" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    const body = req.body || {};
    const summary = typeof body.summary === "string" ? body.summary : "";
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const userMessage =
      typeof body.userMessage === "string" ? body.userMessage.trim() : "";

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

    const rawText = stripCodeFences(result?.text || "");
    const data = safeJsonParse(rawText);

    // 파싱 실패 시 안전 응답
    if (!data) {
      return res.status(200).json({
        messages: [
          { from: "Aiden", text: "Uh… my spell fizzled. Say that again? lol" },
          { from: "Lucas", text: "Looks like a glitch. Try sending one more time." },
          { from: "Maya", text: "It’s okay! We can pick it back up—what happened?" },
          { from: "Theo", text: "Even magic lags sometimes. Anyway—did you hear that rumor?" },
        ],
        summary_append: [],
      });
    }

    // messages 보정 (항상 4명)
    const normalized = normalizeMessages(data.messages);
    const map = new Map(normalized.map((m) => [m.from, m]));
    const filled = FRIENDS.map((name) => map.get(name) || { from: name, text: "…" });

    const summary_append = normalizeSummaryAppend(data.summary_append);

    return res.status(200).json({
      messages: filled,
      summary_append,
    });
  } catch (e) {
    return res.status(500).json({
      error: "server_error",
      detail: String(e?.message || e),
    });
  }
}
