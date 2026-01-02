import { GoogleGenAI } from "@google/genai";

const FRIENDS = ["Aiden", "Lucas", "Maya", "Theo"];

// ✅ 1차 디버그용: CORS 완전 개방(연결부터 성공시키기)
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

  const userLine = userMessage ? `user: ${userMessage}` : "(사용자 발언 없음)";

  return `
너는 "호그와트 5학년 학생 단톡방" 시뮬레이터야. 무조건 **한국어 카톡 말투**로만 말해.

[등장인물(오리지널)]
- Aiden(그리핀도르): 직진/급발진, 말 빠름, "ㅋㅋ" "야" 종종 씀
- Lucas(레번클로): 분석/정리, 과제/시험/규칙 집착, 현실 조언
- Maya(후플푸프): 공감/중재, 다정, 분위기 수습
- Theo(슬리데린): 능청/정보통, 소문/비밀통로 떡밥 잘 던짐

[규칙]
- 절대 엔딩/작별/마무리 금지. (예: "오늘은 여기까지", "자자", "다음에" 금지)
- 매 응답에서 4명이 모두 1~2문장씩 말해.
- 4명 중 최소 1명은 반드시 질문 또는 다음 행동 제안을 해.
- 호그와트 생활 요소(수업, 감점, 기숙사, 도서관, 복도 통행금지, 퀴디치, 교수, 소문)를 자연스럽게 섞어.
- 설명충 금지. 카톡처럼 짧고 자연스럽게.
- 출력은 **오직 JSON**만. 다른 텍스트 금지.
- 대사는 무조건 한국어로.

[출력 JSON 스키마(반드시 준수)]
{
  "messages": [
    { "from": "Aiden", "text": "..." },
    { "from": "Lucas", "text": "..." },
    { "from": "Maya", "text": "..." },
    { "from": "Theo", "text": "..." }
  ],
  "summary_append": ["기억할만한 사실 0~2개(짧게)"]
}

[대화 요약]
${summary || "(없음)"}

[최근 대화]
${recent || "(없음)"}

[사용자 메시지]
${userLine}

위 규칙대로 4명의 메시지를 JSON으로 출력해.
`.trim();
}


export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();

  // 디버그용 (브라우저에서 열면 ok 떠야 함)
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
      generationConfig: { temperature: 0.85, maxOutputTokens: 650 },
    });

    const raw = stripCodeFences(result?.text || "");
    const data = safeJsonParse(raw);

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

    const normalized = normalizeMessages(data.messages);
    const map = new Map(normalized.map((m) => [m.from, m]));
    const filled = FRIENDS.map((name) => map.get(name) || { from: name, text: "..." });

    return res.status(200).json({
      messages: filled,
      summary_append: normalizeSummaryAppend(data.summary_append),
    });
  } catch (e) {
    return res.status(500).json({ error: "server_error", detail: String(e?.message || e) });
  }
}

