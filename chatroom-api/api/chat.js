const { GoogleGenAI } = require("@google/genai");

const FRIENDS = ["Aiden", "Lucas", "Maya", "Theo"];

function setCors(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN;
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
  return String(s || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractJsonObject(text) {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return text.slice(first, last + 1);
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
      from: String(m.from || "").trim(),
      text: String(m.text || "").trim(),
    }))
    .filter((m) => FRIENDS.includes(m.from) && m.text)
    .slice(0, 4);
}

function buildPrompt({ summary, messages, userMessage }) {
  const recent = (messages || [])
    .slice(-30)
    .map((m) => `${m.from}: ${m.text}`)
    .join("\n");

  return `
You are a Hogwarts group chat simulator.
4 students talk endlessly even if the user is silent.

Characters:
Aiden (Gryffindor), Lucas (Ravenclaw), Maya (Hufflepuff), Theo (Slytherin).

Rules:
- Never end the conversation
- All 4 speak every time
- 1-2 sentences each
- Always continue the topic

Output ONLY JSON:
{
 "messages":[
  {"from":"Aiden","text":"..."},
  {"from":"Lucas","text":"..."},
  {"from":"Maya","text":"..."},
  {"from":"Theo","text":"..."}
 ],
 "summary_append":[]
}

Summary:
${summary}

Recent:
${recent}

User:
${userMessage || "(none)"}
`;
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") return res.status(200).json({ ok: true });
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const prompt = buildPrompt({
      summary: req.body.summary || "",
      messages: req.body.messages || [],
      userMessage: req.body.userMessage || "",
    });

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const raw = stripCodeFences(result.text || "");
    const data = safeJsonParse(raw);

    if (!data || !data.messages) {
      return res.status(200).json({
        messages: [
          { from: "Aiden", text: "Lol my spell fizzled, say that again?" },
          { from: "Lucas", text: "Something glitched. Try again." },
          { from: "Maya", text: "It's okay! What were you saying?" },
          { from: "Theo", text: "Magic lag, happens. Anyway—what's up?" },
        ],
        summary_append: [],
      });
    }

    const normalized = normalizeMessages(data.messages);
    const filled = FRIENDS.map(
      (n) => normalized.find((m) => m.from === n) || { from: n, text: "..." }
    );

    res.status(200).json({
      messages: filled,
      summary_append: data.summary_append || [],
    });
  } catch (e) {
    res.status(500).json({ error: "server_error", detail: String(e) });
  }
};
