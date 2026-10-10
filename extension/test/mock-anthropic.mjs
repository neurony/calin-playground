// A stand-in for api.anthropic.com, installed with Playwright request interception.
// It answers like the Messages API (JSON or server-sent events) and records every call.

export const GOOD_KEY = "sk-ant-test-good-key";

// Quick scores per job ad, recognised by a phrase from the ad.
const QUICK_SCORES = [
  ["Kubernetes Platform Engineer", 31, "weak"],
  ["Java Developer", 58, "partial"],
  ["Data Engineer", 40, "weak"],
  ["Engineering Manager", 52, "partial"],
  ["Site Reliability Engineer", 44, "weak"],
  ["Senior Backend Engineer", 82, "strong"],
];

export const CV_NAME = "Maria Popescu";

function tailoredCv(extraBullet) {
  return {
    name: CV_NAME, headline: "Senior Software Engineer (Java, Spring Boot, AWS)",
    contact: { email: "maria@example.com", phone: "+40 700 111 222", location: "Bucharest", links: ["linkedin.com/in/maria-example"] },
    summary: "Backend engineer with seven years of Java, building payment APIs in Spring Boot and running them on AWS.",
    experience: [
      { title: "Senior Software Engineer", company: "Example Fintech", location: "Bucharest", startDate: "03/2021", endDate: "present", description: "",
        bullets: [
          { text: "Built payment processing APIs in Spring Boot", source: "original" },
          { text: "Moved three services from the data centre to AWS (ECS, RDS), with pipelines in GitHub Actions", source: "rephrased" },
          { text: "Mentored two junior engineers through code review and onboarding", source: "rephrased" },
          { text: "On call one week a month for the payment services", source: "answers" },
          ...(extraBullet ? [{ text: "Took part in sprint planning", source: "original" }] : []),
        ] },
      { title: "Software Engineer", company: "Example Retail", location: "Cluj-Napoca", startDate: "2017", endDate: "2021", description: "",
        bullets: [
          { text: "Maintained the stock management system (Java 8, PostgreSQL)", source: "original" },
          { text: "Optimised slow SQL queries", source: "original" },
          { text: "Wrote the internal documentation for the refund API", source: "extra" },
        ] },
    ],
    projects: [],
    education: [{ degree: "BSc Computer Science", institution: "Babeș-Bolyai University", location: "Cluj-Napoca", startDate: "2013", endDate: "2017", details: "" }],
    skills: [{ category: "Backend", items: ["Java", "Spring Boot", "PostgreSQL"] }, { category: "Cloud", items: ["AWS ECS", "AWS RDS", "GitHub Actions"] }],
    certifications: ["AWS Certified Developer – Associate (2022)"],
    languages: [{ language: "Romanian", level: "native" }, { language: "English", level: "C1" }],
  };
}

function promptText(body) {
  const c = body.messages?.[0]?.content;
  if (typeof c === "string") return c;
  return (c || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

export function classify(body) {
  const text = promptText(body);
  if (/haiku/.test(body.model)) return "score";
  if (text.includes("These images are the pages of a document")) return "transcribe";
  if (text.includes("tell the candidate honestly how well")) return "questions";
  if (text.includes("You check a tailored CV for lost information")) return "check";
  if (text.includes("The current tailored CV lost the items listed above")) return "repair";
  if (text.includes("<section_to_rewrite")) return "rewrite";
  if (text.includes("Tailor the candidate's CV to this job description")) return "generate";
  return "unknown";
}

function answerFor(kind, body, state) {
  const text = promptText(body);
  switch (kind) {
    case "score": {
      const jd = text.split("<job_description>")[1]?.split("</job_description>")[0] || "";
      const hit = QUICK_SCORES.find(([needle]) => jd.includes(needle)) || ["", 50, "partial"];
      // A different CV gets a different score, so the tests can see a re-score.
      const bonus = text.includes("Kubernetes (CKA") ? 5 : 0;
      return { score: hit[1] + bonus, verdict: hit[2] };
    }
    case "transcribe":
      return "Ion Scanat\nion@example.com\n\nEXPERIENCE\nPlatform Engineer – Example Cloud (2019 – present)\n- Ran Kubernetes clusters in production\n- Wrote Terraform modules";
    case "questions":
      return {
        match: { score: 78, verdict: "strong", summary: "Your Java, Spring Boot and AWS work matches the core of this role; Kubernetes is the main gap." },
        questions: [
          { requirement: "Kubernetes", kind: "missing", why: "Your CV does not mention Kubernetes.", question: "Have you worked with Kubernetes? Where, and what did you do with it?", previous: null },
          { requirement: "On-call / production support", kind: "weak", why: "Running services in production is not described.", question: "Were you on call for any services?", previous: null },
          { requirement: "REST API design", kind: "weak", why: "API work is listed without detail.", question: "Which APIs did you design, and who used them?", previous: null },
        ],
      };
    case "generate":
      return {
        cv: tailoredCv(false),
        target: { role: "Senior Backend Engineer – Payments", company: "Example Payments SRL" },
        analysis: {
          matched: [{ requirement: "Java and Spring", evidence: "Spring Boot payment APIs at Example Fintech" }, { requirement: "AWS", evidence: "Moved three services to ECS and RDS" }],
          gaps: ["Kubernetes"],
          notes: "Payments and AWS work moved to the top of the Example Fintech role.",
          matchAfter: 84,
        },
        tips: { header: "", summary: "Name the payment volume if you know it.", experience: ["Add an outcome to the AWS migration.", ""], projects: "", skills: "", education: "", certifications: "", languages: "" },
        labels: { summary: "Profile", experience: "Experience", projects: "Projects", education: "Education", skills: "Skills", certifications: "Certifications", languages: "Languages" },
      };
    case "check":
      state.checks = (state.checks || 0) + 1;
      return { missing: text.includes("Took part in sprint planning") && !text.split("<tailored_cv>")[1].includes("sprint planning")
        ? [{ item: "Took part in sprint planning", section: "Experience" }] : [] };
    case "repair":
      return { cv: tailoredCv(true) };
    case "rewrite":
      return { summary: "Java and Spring Boot engineer who builds payment APIs and runs them on AWS (rewritten).", tip: "Mention the on-call work here too." };
    default:
      return { error: "unknown prompt" };
  }
}

function message(model, text) {
  return {
    id: "msg_test_" + Math.random().toString(36).slice(2), type: "message", role: "assistant", model,
    content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function sse(model, text) {
  const id = "msg_test_" + Math.random().toString(36).slice(2);
  const events = [
    ["message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
  ];
  // Split the text in a few chunks, like a real stream.
  const size = Math.max(1, Math.ceil(text.length / 4));
  for (let i = 0; i < text.length; i += size) events.push(["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: text.slice(i, i + size) } }]);
  events.push(["content_block_stop", { type: "content_block_stop", index: 1 }]);
  events.push(["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 50 } }]);
  events.push(["message_stop", { type: "message_stop" }]);
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };

export async function installAnthropicMock(context, { delayMs: initialDelay = 150 } = {}) {
  let delayMs = initialDelay;
  const calls = [];
  const state = {};
  await context.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const headers = req.headers();
    if (headers["x-api-key"] !== GOOD_KEY) {
      calls.push({ path: url.pathname, kind: "unauthorized" });
      return route.fulfill({ status: 401, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }) });
    }
    if (url.pathname.startsWith("/v1/models")) {
      calls.push({ path: url.pathname, kind: "models" });
      return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ data: [{ type: "model", id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-01-01T00:00:00Z" }], has_more: false, first_id: "claude-opus-5-5", last_id: "claude-opus-5-5" }) });
    }
    if (url.pathname === "/v1/messages") {
      const body = JSON.parse(req.postData() || "{}");
      const kind = classify(body);
      calls.push({ path: url.pathname, kind, model: body.model, body, headers, text: promptText(body) });
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const answer = answerFor(kind, body, state);
      const text = typeof answer === "string" ? answer : JSON.stringify(answer);
      if (body.stream) return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "text/event-stream" }, body: sse(body.model, text) });
      return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(message(body.model, text)) });
    }
    return route.fulfill({ status: 404, headers: CORS, body: "not found" });
  });
  return { calls, of: (kind) => calls.filter((c) => c.kind === kind), setDelay: (ms) => { delayMs = ms; } };
}
