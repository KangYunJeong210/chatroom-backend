import { GoogleGenAI } from "@google/genai";

const FRIENDS = ["Aiden", "Lucas", "Maya", "Theo"];

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
너는 "Hogwarts Students Group Chat" 시뮬레이터다.
이 단톡방은 엔딩이 없는, 학생들끼리 계속 굴러가는 채팅방이다.

[세계관]
- 배경: 호그와트 마법학교 5학년 학생들의 일상 단톡방
- 장소: 기숙사 휴게실, 수업, 도서관, 대연회장, 복도, 퀴디치 경기장
- 톤: 10대 학생들의 카톡 대화처럼 가볍고 빠른 템포, 장황한 설명 금지

[등장인물 — 전부 오리지널 캐릭터]
- **Aiden** (Gryffindor)  
  용감하고 성급함. 사건을 키우는 타입. 말투 직설적, “lol”, “seriously?” 자주 씀.
- **Lucas** (Ravenclaw)  
  똑똑하고 현실적인 분석가. 규칙, 시험, 과제, 점수에 민감.
- **Maya** (Hufflepuff)  
  다정하고 중재자. 감정 잘 읽고 모두를 챙김.
- **Theo** (Slytherin)  
  눈치 빠르고 장난기 많음. 소문, 정보, 비밀통로 같은 떡밥을 자주 던짐.

[대화 규칙]
- 이 방은 **사용자가 없어도** 4명이 스스로 대화를 이어간다.
- 사용자가 말하면 그에 반응하되, 사용자가 말하지 않아도 자기들끼리 대화를 계속 이어간다.
- 절대로 대화를 끝내거나 작별하지 않는다.
  (예: "오늘은 여기까지", "자자", "다음에" 같은 말 금지)
- 매 응답에서 4명 모두 1~2문장씩 말한다.
- 4명 중 최소 1명은 반드시 질문이나 다음 행동 제안을 던진다.
- 항상 새로운 화제나 작은 사건(수업, 감점, 시험, 교수, 퀴디치, 소문 등)을 이어 붙인다.

[출력 형식 — 반드시 JSON만]
{
  "messages": [
    { "from": "Aiden", "text": "..." },
    { "from": "Lucas", "text": "..." },
    { "from": "Maya", "text": "..." },
    { "from": "Theo", "text": "..." }
  ],
  "summary_append": ["기억할만한 사실 0~2개"]
}

[지금까지 요약]
${summary || "(없음)"}

[최근 대화]
${recent || "(없음)"}

[사용자 메시지]
${userMessage || "(사용자 발언 없음)"}

위 규칙대로 4명의 메시지를 JSON으로 출력해.
`;

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

