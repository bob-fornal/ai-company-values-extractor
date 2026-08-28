const pptxgen = require("pptxgenjs");

// ─── Palette ────────────────────────────────────────────────────────────────
const NAVY = "132039";
const NAVY2 = "1B2C4C";
const NAVY3 = "233A63";
const ORANGE = "F38020";
const ORANGE_DEEP = "C25E12";
const ICE = "EDF1F7";
const WHITE = "FFFFFF";
const TEXT_DARK = "16233D";
const TEXT_MUTED = "5B6B85";
const TEXT_MUTED_LIGHT = "AAB8D4";
const CODE_BG = "0D1626";
const CODE_TEXT = "E7ECF5";
const CODE_COMMENT = "7C8CB5";
const GREEN = "1E8E5A";
const RED = "B5452B";

const TITLE_FONT = "Cambria";
const BODY_FONT = "Calibri";
const CODE_FONT = "Courier New";

const PW = 13.333, PH = 7.5;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "Company Values Extractor Workshop";
pres.title = "Building a Production Cloudflare Worker";

// ─── Helpers ────────────────────────────────────────────────────────────────

function badge(slide, { x, y, d = 0.62, bg = ORANGE, textColor = NAVY, text, fontSize = 20 }) {
  slide.addShape("ellipse", { x, y, w: d, h: d, fill: { color: bg }, line: { type: "none" } });
  slide.addText(String(text), {
    x, y, w: d, h: d, align: "center", valign: "middle",
    fontFace: TITLE_FONT, bold: true, fontSize, color: textColor, isTextBox: true, margin: 0,
  });
}

function footer(slide, phaseLabel, pageNum, dark = false) {
  slide.addText(phaseLabel, {
    x: 0.5, y: PH - 0.42, w: 8, h: 0.3, fontFace: BODY_FONT, fontSize: 10,
    color: dark ? TEXT_MUTED_LIGHT : TEXT_MUTED, isTextBox: true, margin: 0,
  });
  slide.addText(String(pageNum), {
    x: PW - 0.9, y: PH - 0.42, w: 0.4, h: 0.3, align: "right", fontFace: BODY_FONT, fontSize: 10,
    color: dark ? TEXT_MUTED_LIGHT : TEXT_MUTED, isTextBox: true, margin: 0,
  });
}

function eyebrow(slide, text, opts = {}) {
  slide.addText(text.toUpperCase(), {
    x: opts.x ?? 0.6, y: opts.y ?? 0.45, w: opts.w ?? 8, h: 0.35,
    fontFace: BODY_FONT, bold: true, fontSize: 13, color: opts.color ?? ORANGE,
    charSpacing: 2, isTextBox: true, margin: 0,
  });
}

function slideTitle(slide, text, opts = {}) {
  slide.addText(text, {
    x: opts.x ?? 0.6, y: opts.y ?? 0.78, w: opts.w ?? 11.8, h: opts.h ?? 0.9,
    fontFace: TITLE_FONT, bold: true, fontSize: opts.fontSize ?? 32,
    color: opts.color ?? TEXT_DARK, isTextBox: true, margin: 0,
  });
}

/** A code block rendered as a dark rounded rectangle with monospace lines. */
function codeBlock(slide, lines, { x, y, w, h, fontSize = 13 }) {
  slide.addShape("roundRect", {
    x, y, w, h, rectRadius: 0.08,
    fill: { color: CODE_BG }, line: { type: "none" },
    shadow: { type: "outer", color: "000000", opacity: 0.35, blur: 8, offset: 3, angle: 90 },
  });
  const paras = lines.map((l) => ({
    text: l.text,
    options: {
      color: l.comment ? CODE_COMMENT : (l.color || CODE_TEXT),
      italic: !!l.comment,
      breakLine: true,
    },
  }));
  slide.addText(paras, {
    x: x + 0.28, y: y + 0.22, w: w - 0.56, h: h - 0.44,
    fontFace: CODE_FONT, fontSize, isTextBox: true, margin: 0, valign: "top",
    lineSpacingMultiple: 1.12,
  });
}

/** Simple left-to-right flow diagram of labeled boxes connected by arrows. */
function flowDiagram(slide, boxes, { x, y, w, h, boxColor = NAVY2, textColor = WHITE, subColor = TEXT_MUTED_LIGHT }) {
  const gap = 0.5;
  const boxW = (w - gap * (boxes.length - 1)) / boxes.length;
  boxes.forEach((b, i) => {
    const bx = x + i * (boxW + gap);
    slide.addShape("roundRect", {
      x: bx, y, w: boxW, h, rectRadius: 0.09,
      fill: { color: b.fill || boxColor }, line: { type: "none" },
    });
    const texts = [{ text: b.label, options: { bold: true, fontSize: 13, color: b.textColor || textColor, breakLine: !!b.sub } }];
    if (b.sub) texts.push({ text: b.sub, options: { fontSize: 10.5, color: b.subColor || subColor } });
    slide.addText(texts, {
      x: bx + 0.12, y, w: boxW - 0.24, h, valign: "middle", align: "center",
      fontFace: BODY_FONT, isTextBox: true, margin: 0,
    });
    if (i < boxes.length - 1) {
      slide.addShape("line", {
        x: bx + boxW, y: y + h / 2, w: gap, h: 0,
        line: { color: ORANGE, width: 2.25, endArrowType: "triangle" },
      });
    }
  });
}

function bulletList(slide, items, { x, y, w, h, fontSize = 15, color = TEXT_DARK, bulletColor = ORANGE, paraSpaceAfter = 12 }) {
  const paras = items.map((it, i) => ({
    text: it,
    options: {
      bullet: { code: "2022", color: bulletColor },
      color, fontSize, breakLine: i < items.length - 1, paraSpaceAfter,
    },
  }));
  slide.addText(paras, { x, y, w, h, fontFace: BODY_FONT, isTextBox: true, margin: 0, valign: "top" });
}

function lightBg(slide) {
  slide.background = { color: WHITE };
}
function iceBg(slide) {
  slide.background = { color: ICE };
}
function navyBg(slide) {
  slide.background = { color: NAVY };
}

let pageNum = 0;
function newSlide(bg) {
  pageNum++;
  const s = pres.addSlide();
  if (bg === "navy") navyBg(s);
  else if (bg === "ice") iceBg(s);
  else lightBg(s);
  return s;
}

// ══════════════════════════════════════════════════════════════════════════
// 1. TITLE SLIDE
// ══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide("navy");
  s.addShape("ellipse", { x: 10.6, y: -1.6, w: 5.2, h: 5.2, fill: { color: NAVY2 }, line: { type: "none" } });
  s.addShape("ellipse", { x: 11.9, y: 4.6, w: 3.0, h: 3.0, fill: { color: ORANGE }, line: { type: "none" }, transparency: 78 });

  s.addText("A SIX-PHASE, FOUR-HOUR HANDS-ON WORKSHOP", {
    x: 0.8, y: 2.05, w: 10, h: 0.4, fontFace: BODY_FONT, bold: true, fontSize: 14,
    color: ORANGE, charSpacing: 2, isTextBox: true, margin: 0,
  });
  s.addText("Building a Production\nCloudflare Worker", {
    x: 0.78, y: 2.5, w: 11, h: 2.1, fontFace: TITLE_FONT, bold: true, fontSize: 44,
    color: WHITE, isTextBox: true, margin: 0, lineSpacingMultiple: 1.05,
  });
  s.addText("From an empty wrangler.toml to a debugged, AI-powered Company Values Extractor — built around a real incident log, not a synthetic curriculum.", {
    x: 0.8, y: 4.55, w: 8.4, h: 1.0, fontFace: BODY_FONT, fontSize: 16, italic: true,
    color: TEXT_MUTED_LIGHT, isTextBox: true, margin: 0, lineSpacingMultiple: 1.2,
  });

  const phases = ["Setup", "AI Extraction", "Security", "SPA Rendering", "Diagnostics", "Adaptive Crawl"];
  const chipW = 1.85, chipGap = 0.15, startX = 0.8, chipY = 6.15;
  phases.forEach((p, i) => {
    const cx = startX + i * (chipW + chipGap);
    s.addShape("roundRect", { x: cx, y: chipY, w: chipW, h: 0.55, rectRadius: 0.28, fill: { color: NAVY2 }, line: { color: NAVY3, width: 1 } });
    s.addText([{ text: String(i + 1), options: { color: ORANGE, bold: true } }, { text: "  " + p, options: { color: WHITE } }], {
      x: cx, y: chipY, w: chipW, h: 0.55, align: "center", valign: "middle", fontFace: BODY_FONT, fontSize: 10.5, isTextBox: true, margin: 0,
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════
// 2. AGENDA
// ══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide("ice");
  eyebrow(s, "Workshop Overview");
  slideTitle(s, "Today’s Agenda — 4 Hours");

  const rows = [
    ["0:00", "Welcome & workshop overview", "10 min", NAVY2],
    ["0:10", "Phase 1 — Project Setup & Health Check", "30 min", ORANGE],
    ["0:40", "Phase 2 — Crawling & AI Extraction", "35 min", ORANGE],
    ["1:15", "Phase 3 — Securing the Endpoint", "25 min", ORANGE],
    ["1:40", "Break", "10 min", TEXT_MUTED],
    ["1:50", "Phase 4 — Handling JavaScript-Rendered Pages", "40 min", ORANGE],
    ["2:30", "Phase 5 — Diagnostics, Config Drift & Truncation", "35 min", ORANGE],
    ["3:05", "Break", "10 min", TEXT_MUTED],
    ["3:15", "Phase 6 — Adaptive Crawling & Wrap-Up", "35 min", ORANGE],
    ["3:50", "Retrospective & Q&A", "10 min", NAVY2],
  ];
  const top = 1.85, rowH = 0.5;
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    if (i % 2 === 0) s.addShape("rect", { x: 0.6, y, w: 12.1, h: rowH, fill: { color: WHITE }, line: { type: "none" } });
    s.addText(r[0], { x: 0.75, y, w: 1.0, h: rowH, valign: "middle", fontFace: CODE_FONT, fontSize: 12, color: TEXT_MUTED, isTextBox: true, margin: 0 });
    s.addText(r[1], { x: 1.85, y, w: 8.6, h: rowH, valign: "middle", fontFace: BODY_FONT, fontSize: 13.5, color: TEXT_DARK, bold: r[3] === ORANGE, isTextBox: true, margin: 0 });
    s.addShape("roundRect", { x: 11.15, y: y + 0.08, w: 1.35, h: rowH - 0.16, rectRadius: 0.16, fill: { color: r[3] }, line: { type: "none" } });
    s.addText(r[2], { x: 11.15, y: y + 0.08, w: 1.35, h: rowH - 0.16, align: "center", valign: "middle", fontFace: BODY_FONT, bold: true, fontSize: 10.5, color: WHITE, isTextBox: true, margin: 0 });
  });
  footer(s, "Building a Production Cloudflare Worker", pageNum);
}

// ══════════════════════════════════════════════════════════════════════════
// 3. WHAT WE'RE BUILDING
// ══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide("light");
  eyebrow(s, "The Project");
  slideTitle(s, "What We're Building: the Company Values Extractor");
  s.addText("A Cloudflare Worker that crawls a company website and uses Workers AI to extract its mission, vision, core values, and culture as structured JSON.", {
    x: 0.6, y: 1.65, w: 11.6, h: 0.6, fontFace: BODY_FONT, fontSize: 14.5, color: TEXT_MUTED, isTextBox: true, margin: 0,
  });

  flowDiagram(s, [
    { label: "POST /extract", sub: "{ url }" },
    { label: "Crawl candidate\npages", sub: "plain fetch + render" },
    { label: "Workers AI", sub: "@cf/meta/llama-4-scout", fill: ORANGE, textColor: NAVY, subColor: NAVY },
    { label: "Structured JSON", sub: "values, mission, culture" },
  ], { x: 0.6, y: 2.6, w: 12.1, h: 1.15 });

  const cols = [
    { h: "GET /", d: "Health check — always open, never gated behind auth." },
    { h: "POST /extract", d: "Crawl + AI extraction. Returns structured company values." },
    { h: "POST /extract/full", d: "Same as /extract, plus a generated markdown report." },
  ];
  const colW = 3.85, gap = 0.3, startX = 0.6, y = 4.35;
  cols.forEach((c, i) => {
    const cx = startX + i * (colW + gap);
    s.addShape("roundRect", { x: cx, y, w: colW, h: 1.9, rectRadius: 0.08, fill: { color: ICE }, line: { type: "none" } });
    badge(s, { x: cx + 0.25, y: y + 0.25, d: 0.42, text: i + 1, fontSize: 15 });
    s.addText(c.h, { x: cx + 0.25, y: y + 0.85, w: colW - 0.5, h: 0.4, fontFace: CODE_FONT, bold: true, fontSize: 13, color: NAVY, isTextBox: true, margin: 0 });
    s.addText(c.d, { x: cx + 0.25, y: y + 1.25, w: colW - 0.5, h: 0.55, fontFace: BODY_FONT, fontSize: 11.5, color: TEXT_MUTED, isTextBox: true, margin: 0 });
  });

  s.addText("The reference implementation lives in complete/ — every phase in this workshop builds toward it, one incident at a time.", {
    x: 0.6, y: 6.55, w: 11.8, h: 0.5, fontFace: BODY_FONT, italic: true, fontSize: 12.5, color: TEXT_MUTED, isTextBox: true, margin: 0,
  });
  footer(s, "Building a Production Cloudflare Worker", pageNum);
}

// ══════════════════════════════════════════════════════════════════════════
// 4. HOW THIS WORKSHOP WORKS
// ══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide("light");
  eyebrow(s, "Format");
  slideTitle(s, "How This Workshop Works");

  const items = [
    { t: "Built from a real decision log", d: "Every phase is anchored to an actual incident from this project's debugging history — not a hypothetical." },
    { t: "Cumulative, runnable code", d: "Each phase folder is a checkpoint. Code from Phase N is exactly where Phase N+1 starts." },
    { t: "One gap per phase, by design", d: "Starting code ships with one intentional bug to fix or function to implement — tied directly to that phase's case study." },
    { t: "Solutions are there — collapsed", d: "Every lab's README has a solution in a collapsed block. Attempt first; reveal when stuck." },
  ];
  const top = 1.9, rowH = 1.15;
  items.forEach((it, i) => {
    const y = top + i * rowH;
    badge(s, { x: 0.6, y: y + 0.05, d: 0.55, text: i + 1, fontSize: 17 });
    s.addText(it.t, { x: 1.4, y, w: 10.8, h: 0.4, fontFace: BODY_FONT, bold: true, fontSize: 16, color: TEXT_DARK, isTextBox: true, margin: 0 });
    s.addText(it.d, { x: 1.4, y: y + 0.42, w: 10.8, h: 0.6, fontFace: BODY_FONT, fontSize: 13, color: TEXT_MUTED, isTextBox: true, margin: 0 });
  });
  footer(s, "Building a Production Cloudflare Worker", pageNum);
}

// ══════════════════════════════════════════════════════════════════════════
// 5. PREREQUISITES
// ══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide("ice");
  eyebrow(s, "Before We Start");
  slideTitle(s, "Prerequisites & Setup");

  const need = [
    "Node.js installed, plus `npm install -g wrangler`",
    "A Cloudflare account with Workers AI enabled",
    "Comfortable reading/writing JavaScript (ES modules, async/await)",
    "A terminal and an editor — that's the whole toolchain",
  ];
  const nice = [
    "A Cloudflare API token with “Browser Rendering — Edit” permission (Phase 4 onward; degrades gracefully without it)",
    "A test company website to crawl — ideally one with a client-side-rendered (SPA) careers page",
  ];

  s.addShape("roundRect", { x: 0.6, y: 1.85, w: 5.8, h: 4.6, rectRadius: 0.08, fill: { color: WHITE }, line: { type: "none" } });
  s.addText("REQUIRED", { x: 0.9, y: 2.1, w: 5, h: 0.35, fontFace: BODY_FONT, bold: true, fontSize: 13, color: ORANGE, charSpacing: 1.5, isTextBox: true, margin: 0 });
  bulletList(s, need, { x: 0.9, y: 2.55, w: 5.2, h: 3.7, fontSize: 13.5 });

  s.addShape("roundRect", { x: 6.7, y: 1.85, w: 6.0, h: 4.6, rectRadius: 0.08, fill: { color: NAVY }, line: { type: "none" } });
  s.addText("NICE TO HAVE", { x: 7.0, y: 2.1, w: 5, h: 0.35, fontFace: BODY_FONT, bold: true, fontSize: 13, color: ORANGE, charSpacing: 1.5, isTextBox: true, margin: 0 });
  bulletList(s, nice, { x: 7.0, y: 2.55, w: 5.4, h: 3.7, fontSize: 13.5, color: WHITE, paraSpaceAfter: 16 });

  footer(s, "Building a Production Cloudflare Worker", pageNum);
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE DIVIDER helper
// ══════════════════════════════════════════════════════════════════════════
function dividerSlide({ num, title, duration, builds, incident, objectives }) {
  const s = newSlide("navy");
  s.addShape("ellipse", { x: 10.4, y: 4.6, w: 4.6, h: 4.6, fill: { color: NAVY2 }, line: { type: "none" } });
  badge(s, { x: 0.7, y: 0.75, d: 0.95, text: num, fontSize: 34 });
  s.addText(`PHASE ${num} · ${duration}`, { x: 1.85, y: 0.82, w: 6, h: 0.35, fontFace: BODY_FONT, bold: true, fontSize: 13, color: ORANGE, charSpacing: 2, isTextBox: true, margin: 0 });
  s.addText(title, { x: 1.85, y: 1.12, w: 10.5, h: 0.9, fontFace: TITLE_FONT, bold: true, fontSize: 30, color: WHITE, isTextBox: true, margin: 0 });

  s.addText([
    { text: "Builds on: ", options: { bold: true, color: TEXT_MUTED_LIGHT } },
    { text: builds, options: { color: WHITE } },
  ], { x: 1.85, y: 1.95, w: 10.5, h: 0.35, fontFace: BODY_FONT, fontSize: 13, isTextBox: true, margin: 0 });

  s.addShape("roundRect", { x: 0.7, y: 2.55, w: 11.9, h: 1.0, rectRadius: 0.09, fill: { color: NAVY2 }, line: { type: "none" } });
  s.addText([
    { text: "REAL INCIDENT   ", options: { bold: true, fontSize: 11.5, color: ORANGE, charSpacing: 1.5, breakLine: true } },
    { text: incident, options: { fontSize: 14, color: WHITE, italic: true } },
  ], { x: 1.0, y: 2.55, w: 11.3, h: 1.0, valign: "middle", fontFace: BODY_FONT, isTextBox: true, margin: 0 });

  s.addText("LEARNING OBJECTIVES", { x: 0.7, y: 3.85, w: 6, h: 0.35, fontFace: BODY_FONT, bold: true, fontSize: 12, color: ORANGE, charSpacing: 1.5, isTextBox: true, margin: 0 });
  const paras = objectives.map((o, i) => ({
    text: o, options: { bullet: { code: "2022", color: ORANGE }, color: WHITE, fontSize: 14.5, breakLine: i < objectives.length - 1, paraSpaceAfter: 10 },
  }));
  s.addText(paras, { x: 0.7, y: 4.25, w: 11.3, h: 2.7, fontFace: BODY_FONT, isTextBox: true, margin: 0, valign: "top" });

  footer(s, `Phase ${num} — ${title}`, pageNum, true);
  return s;
}

// ══════════════════════════════════════════════════════════════════════════
// CONCEPT slide helper
// ══════════════════════════════════════════════════════════════════════════
function conceptHeader(s, num, phaseTitle, kicker, title) {
  badge(s, { x: 0.6, y: 0.42, d: 0.5, text: num, fontSize: 16 });
  s.addText(kicker.toUpperCase(), { x: 1.28, y: 0.42, w: 9, h: 0.28, fontFace: BODY_FONT, bold: true, fontSize: 11.5, color: ORANGE, charSpacing: 1.5, isTextBox: true, margin: 0 });
  s.addText(title, { x: 1.28, y: 0.7, w: 11.4, h: 0.65, fontFace: TITLE_FONT, bold: true, fontSize: 24, color: TEXT_DARK, isTextBox: true, margin: 0 });
  footer(s, `Phase ${num} — ${phaseTitle}`, pageNum);
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 1
// ══════════════════════════════════════════════════════════════════════════
dividerSlide({
  num: 1, title: "Project Setup & Health Check", duration: "30 min", builds: "nothing — starting point",
  incident: "“wrangler deploy” warns about workers_dev / preview_urls not being set explicitly.",
  objectives: [
    "Explain what each wrangler.toml field controls",
    "Run a Worker locally with wrangler dev, deploy with wrangler deploy",
    "Add a routed endpoint and a shared JSON response helper",
    "Tell a real warning apart from a cosmetic config-explicitness one",
  ],
});

{
  const s = newSlide("light");
  conceptHeader(s, 1, "Project Setup & Health Check", "Concept", "Anatomy of wrangler.toml");
  codeBlock(s, [
    { text: 'name = "company-values-extractor"' },
    { text: 'main = "src/index.js"' },
    { text: 'compatibility_date = "2024-11-01"' },
    { text: 'compatibility_flags = ["nodejs_compat"]' },
    { text: "" },
    { text: "# Set explicitly — silences a real deploy warning", comment: true },
    { text: "workers_dev = true" },
    { text: "preview_urls = true" },
  ], { x: 0.6, y: 1.6, w: 6.3, h: 3.6 });

  bulletList(s, [
    "Every later phase adds to this same fetch() handler — same shape, same shared jsonResponse() helper",
    "workers_dev / preview_urls default to true either way — setting them explicitly is about silencing noise, not changing behavior",
    "Not every warning is a bug — but silencing a known-safe one keeps real warnings from getting lost later",
  ], { x: 7.2, y: 1.7, w: 5.5, h: 3.4, fontSize: 14 });

  s.addShape("roundRect", { x: 0.6, y: 5.5, w: 12.1, h: 1.1, rectRadius: 0.08, fill: { color: ICE }, line: { type: "none" } });
  s.addText([
    { text: "TRY IT   ", options: { bold: true, fontSize: 11.5, color: ORANGE_DEEP, charSpacing: 1.5 } },
    { text: "wrangler dev  →  curl http://localhost:8787/  →  confirm a 404 on an unknown path", options: { fontFace: CODE_FONT, fontSize: 13, color: TEXT_DARK } },
  ], { x: 0.9, y: 5.5, w: 11.5, h: 1.1, valign: "middle", isTextBox: true, margin: 0 });
  footer(s, "Phase 1 — Project Setup & Health Check", pageNum);
}

{
  const s = newSlide("ice");
  conceptHeader(s, 1, "Project Setup & Health Check", "Hands-On Lab", "Add a GET /version Endpoint");
  bulletList(s, [
    "Return { \"version\": \"1.0.0-phase1\" } from a new GET /version route",
    "Reuse jsonResponse() — don't hand-roll another new Response(...)",
    "Unmatched paths must still return 404, same as today",
  ], { x: 0.6, y: 1.75, w: 11.8, h: 1.8, fontSize: 15.5 });

  codeBlock(s, [
    { text: 'if (url.pathname === "/version" && request.method === "GET") {' },
    { text: '  return jsonResponse({ version: "1.0.0-phase1" });' },
    { text: "}" },
    { text: "" },
    { text: "// solution — see phase-1-project-setup/README.md", comment: true },
  ], { x: 0.6, y: 3.6, w: 12.1, h: 2.5 });
  footer(s, "Phase 1 — Project Setup & Health Check", pageNum);
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 2
// ══════════════════════════════════════════════════════════════════════════
dividerSlide({
  num: 2, title: "Crawling & AI Extraction", duration: "35 min", builds: "Phase 1",
  incident: "TypeError: ((intermediate value) ?? \"\").trim is not a function — in the Cloudflare dashboard console.",
  objectives: [
    "Wire up the AI binding and call env.AI.run()",
    "Fetch multiple pages concurrently with Promise.allSettled",
    "Combine several pages' text into one bounded prompt context",
    "Recognize and fix a real Workers AI response-shape bug",
  ],
});

{
  const s = newSlide("light");
  conceptHeader(s, 2, "Crawling & AI Extraction", "Concept", "From URL to Structured JSON");
  flowDiagram(s, [
    { label: "Fixed path list", sub: "12 recommended paths" },
    { label: "fetch() each page", sub: "Promise.allSettled" },
    { label: "stripHtml()", sub: "+ buildContext()" },
    { label: "AI.run()", sub: "llama-4-scout", fill: ORANGE, textColor: NAVY, subColor: NAVY },
  ], { x: 0.6, y: 1.7, w: 12.1, h: 1.1 });

  bulletList(s, [
    "Promise.allSettled, not Promise.all — some pages 404ing is a normal outcome, not a failure",
    "buildContext() splits the character budget evenly across every successful page (simple — not done yet, see Phase 5)",
    "The AI is prompted for one exact JSON shape: company, mission, vision, values[], culture[], summary",
  ], { x: 0.6, y: 3.15, w: 12.1, h: 1.8, fontSize: 14.5 });
  footer(s, "Phase 2 — Crawling & AI Extraction", pageNum);
}

{
  const s = newSlide("ice");
  conceptHeader(s, 2, "Crawling & AI Extraction", "Case Study", "The Bug Hiding Behind ??");
  codeBlock(s, [
    { text: "const raw = (response?.response ?? \"\").trim();" },
    { text: "" },
    { text: "// TypeError: ...trim is not a function", comment: true },
  ], { x: 0.6, y: 1.65, w: 6.3, h: 1.7, fontSize: 14 });

  bulletList(s, [
    "?? only substitutes when the value is null or undefined",
    "Workers AI can return response.response as a non-string object — truthy, so it sails right past ??",
    "An object has no .trim() — hence the TypeError, in production, on real traffic",
  ], { x: 7.2, y: 1.75, w: 5.5, h: 2.6, fontSize: 14 });

  s.addText("HANDS-ON LAB", { x: 0.6, y: 3.65, w: 6, h: 0.3, fontFace: BODY_FONT, bold: true, fontSize: 12, color: ORANGE_DEEP, charSpacing: 1.5, isTextBox: true, margin: 0 });
  codeBlock(s, [
    { text: "function aiResponseToText(response) {" },
    { text: "  const value = response?.response;" },
    { text: '  if (typeof value === "string") return value;' },
    { text: "  if (value == null) return \"\";" },
    { text: "  return JSON.stringify(value);" },
    { text: "}" },
    { text: "" },
    { text: "// check typeof explicitly — don't just try/catch around it", comment: true },
  ], { x: 0.6, y: 4.0, w: 12.1, h: 2.5 });
  footer(s, "Phase 2 — Crawling & AI Extraction", pageNum);
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 3
// ══════════════════════════════════════════════════════════════════════════
dividerSlide({
  num: 3, title: "Securing the Endpoint", duration: "25 min", builds: "Phase 2",
  incident: "An API token pasted into wrangler.toml's [vars] printed in plaintext on the next wrangler deploy.",
  objectives: [
    "Explain the difference between a [vars] entry and a Wrangler secret",
    "Protect a route with an optional API key check",
    "Explain why GET / should stay unprotected",
    "Set, list, and rotate a secret without ever seeing its value",
  ],
});

{
  const s = newSlide("light");
  conceptHeader(s, 3, "Securing the Endpoint", "Concept", "Vars vs. Secrets");
  const colW = 5.6, gap = 0.5, y = 1.75, h = 3.6;
  s.addShape("roundRect", { x: 0.6, y, w: colW, h, rectRadius: 0.08, fill: { color: "F7E4D3" }, line: { color: RED, width: 1.25 } });
  s.addText("[vars]  —  PLAINTEXT", { x: 0.9, y: y + 0.25, w: colW - 0.6, h: 0.4, fontFace: BODY_FONT, bold: true, fontSize: 15, color: RED, isTextBox: true, margin: 0 });
  bulletList(s, [
    "Visible in the dashboard",
    "Printed in cleartext by wrangler deploy whenever local config differs from live",
    "Never put a credential here — not even “just for testing”",
  ], { x: 0.9, y: y + 0.85, w: colW - 0.6, h: h - 1.1, fontSize: 13.5, bulletColor: RED });

  const x2 = 0.6 + colW + gap;
  s.addShape("roundRect", { x: x2, y, w: colW, h, rectRadius: 0.08, fill: { color: "DCEFE4" }, line: { color: GREEN, width: 1.25 } });
  s.addText("wrangler secret put", { x: x2 + 0.3, y: y + 0.25, w: colW - 0.6, h: 0.4, fontFace: CODE_FONT, bold: true, fontSize: 15, color: GREEN, isTextBox: true, margin: 0 });
  bulletList(s, [
    "Encrypted at rest",
    "Never printed — not in diffs, not in wrangler secret list (names only)",
    "Rule of thumb: if it's a credential, it's a secret, full stop",
  ], { x: x2 + 0.3, y: y + 0.85, w: colW - 0.6, h: h - 1.1, fontSize: 13.5, bulletColor: GREEN });
  footer(s, "Phase 3 — Securing the Endpoint", pageNum);
}

{
  const s = newSlide("ice");
  conceptHeader(s, 3, "Securing the Endpoint", "Case Study", "The Token That Leaked in Plain Sight");
  const steps = [
    ["WHAT HAPPENED", "A token was pasted into [vars] instead of set as a secret — same mistake, dashboard “Variable” UI or wrangler.toml either way."],
    ["HOW IT SURFACED", "The next wrangler deploy printed the literal token value in its config-diff output — into terminal scrollback and CI logs."],
    ["THE FIX", "Revoke the token immediately (it's compromised the moment it's printed), then: wrangler secret put CLOUDFLARE_API_TOKEN"],
  ];
  const top = 1.85, rowH = 1.35;
  steps.forEach((st, i) => {
    const y = top + i * rowH;
    s.addShape("roundRect", { x: 0.6, y, w: 12.1, h: rowH - 0.2, rectRadius: 0.08, fill: { color: WHITE }, line: { type: "none" } });
    s.addText(st[0], { x: 0.9, y: y + 0.15, w: 2.6, h: rowH - 0.5, fontFace: BODY_FONT, bold: true, fontSize: 12, color: ORANGE_DEEP, charSpacing: 1, valign: "top", isTextBox: true, margin: 0 });
    s.addText(st[1], { x: 3.6, y: y + 0.15, w: 8.9, h: rowH - 0.5, fontFace: BODY_FONT, fontSize: 13.5, color: TEXT_DARK, valign: "top", isTextBox: true, margin: 0 });
  });
  footer(s, "Phase 3 — Securing the Endpoint", pageNum);
}

{
  const s = newSlide("light");
  conceptHeader(s, 3, "Securing the Endpoint", "Hands-On Lab", "Protect /extract and /extract/full");
  codeBlock(s, [
    { text: "$ wrangler secret put API_KEY" },
    { text: "" },
    { text: "# no key → 401", comment: true },
    { text: "$ curl -i -X POST .../extract -d '{\"url\":\"...\"}' " },
    { text: "" },
    { text: "# correct key → succeeds", comment: true },
    { text: '$ curl -X POST .../extract -H "X-Api-Key: <key>" -d \'{"url":"..."}\'' },
  ], { x: 0.6, y: 1.75, w: 12.1, h: 3.0 });
  bulletList(s, [
    "GET / must still succeed with no key at all, always",
    "No API_KEY secret set at all → the auth check is a no-op, everything succeeds",
  ], { x: 0.6, y: 5.0, w: 12.1, h: 1.2, fontSize: 14.5 });
  footer(s, "Phase 3 — Securing the Endpoint", pageNum);
}

// ══════════════════════════════════════════════════════════════════════════
// BREAK 1
// ══════════════════════════════════════════════════════════════════════════
function breakSlide(minutes, nextLabel) {
  const s = newSlide("navy");
  s.addShape("ellipse", { x: 5.4, y: 1.3, w: 2.5, h: 2.5, fill: { color: NAVY2 }, line: { type: "none" } });
  s.addText("☕", { x: 5.4, y: 1.3, w: 2.5, h: 2.5, align: "center", valign: "middle", fontSize: 60, isTextBox: true, margin: 0 });
  s.addText(`${minutes}-MINUTE BREAK`, { x: 0, y: 4.05, w: PW, h: 0.6, align: "center", fontFace: TITLE_FONT, bold: true, fontSize: 30, color: WHITE, isTextBox: true, margin: 0 });
  s.addText(`Up next: ${nextLabel}`, { x: 0, y: 4.75, w: PW, h: 0.45, align: "center", fontFace: BODY_FONT, italic: true, fontSize: 15, color: TEXT_MUTED_LIGHT, isTextBox: true, margin: 0 });
  footer(s, "Building a Production Cloudflare Worker", pageNum, true);
}
breakSlide(10, "Phase 4 — Handling JavaScript-Rendered (SPA) Pages");

// ══════════════════════════════════════════════════════════════════════════
// PHASE 4
// ══════════════════════════════════════════════════════════════════════════
dividerSlide({
  num: 4, title: "Handling JavaScript-Rendered (SPA) Pages", duration: "40 min", builds: "Phase 3",
  incident: "A company's real Core Values never appeared — they were injected client-side by an Angular SPA with no SSR.",
  objectives: [
    "Explain why plain fetch() can silently miss a page's real content",
    "Design a cheap heuristic (looksThin) for when rendering is worth it",
    "Explain why the /markdown quick action beat /json here",
    "Fix a subtle SPA client-routing bug: a fake “successful” render",
  ],
});

{
  const s = newSlide("light");
  conceptHeader(s, 4, "Handling JavaScript-Rendered (SPA) Pages", "The Problem", "A Plain fetch() Never Runs JavaScript");
  flowDiagram(s, [
    { label: "fetch(/careers)", sub: "gets server HTML" },
    { label: "“Core Values”", sub: "heading present" },
    { label: "— nothing —", sub: "JS never ran", fill: RED },
  ], { x: 0.6, y: 1.75, w: 8.2, h: 1.05 });
  s.addText("A Worker's fetch() gets exactly what the origin server returns — nothing more. Content that JavaScript injects after page load simply isn't in that HTML.", {
    x: 0.6, y: 3.1, w: 12.1, h: 0.7, fontFace: BODY_FONT, fontSize: 15, color: TEXT_DARK, isTextBox: true, margin: 0,
  });
  s.addShape("roundRect", { x: 0.6, y: 4.0, w: 12.1, h: 1.9, rectRadius: 0.08, fill: { color: ICE }, line: { type: "none" } });
  s.addText([
    { text: "SYMPTOM TO WATCH FOR   ", options: { bold: true, fontSize: 11.5, color: ORANGE_DEEP, charSpacing: 1.5, breakLine: true } },
    { text: "A heading like “Our Core Values,” immediately followed by unrelated content, with nothing filled in between — not a fetch error, not a timeout. The content just isn't there to find.", options: { fontSize: 15, italic: true, color: TEXT_DARK } },
  ], { x: 0.9, y: 4.15, w: 11.5, h: 1.6, valign: "top", fontFace: BODY_FONT, isTextBox: true, margin: 0 });
  footer(s, "Phase 4 — Handling JavaScript-Rendered (SPA) Pages", pageNum);
}

{
  const s = newSlide("ice");
  conceptHeader(s, 4, "Handling JavaScript-Rendered (SPA) Pages", "Concept", "A Two-Tier Fetch Strategy");
  flowDiagram(s, [
    { label: "Plain fetch()", sub: "cheap, fast, first" },
    { label: "looksThin()?", sub: "< 300 chars, or < 5% of raw HTML", fill: ORANGE, textColor: NAVY, subColor: NAVY },
    { label: "Browser Rendering", sub: "/markdown quick action" },
  ], { x: 0.6, y: 1.75, w: 12.1, h: 1.15 });

  bulletList(s, [
    "A flat character minimum isn't reliable — a real page can render 2,000 narrative characters and still miss the one section that matters",
    "The working signal: extracted-text-to-raw-HTML ratio — an SPA shell has a large JS bundle translating to very little static text",
    "Plain fetch always runs first; rendering only pays for the pages that actually need it",
  ], { x: 0.6, y: 3.25, w: 12.1, h: 2.2, fontSize: 14.5 });
  footer(s, "Phase 4 — Handling JavaScript-Rendered (SPA) Pages", pageNum);
}

{
  const s = newSlide("light");
  conceptHeader(s, 4, "Handling JavaScript-Rendered (SPA) Pages", "Case Study", "/json Looked Right and Failed Every Time");
  const colW = 5.6, gap = 0.5, y = 1.75, h = 3.9;
  s.addShape("roundRect", { x: 0.6, y, w: colW, h, rectRadius: 0.08, fill: { color: "F7E4D3" }, line: { color: RED, width: 1.25 } });
  s.addText("/json  —  HTTP 422 every time", { x: 0.9, y: y + 0.25, w: colW - 0.6, h: 0.4, fontFace: CODE_FONT, bold: true, fontSize: 14, color: RED, isTextBox: true, margin: 0 });
  bulletList(s, [
    "Renders the page, then asks an internal AI model to extract fields as JSON",
    "Asking it to return a whole page as one JSON string field: the model reliably fails to escape the text correctly",
    "Fails on every real page tried — not a fluke",
  ], { x: 0.9, y: y + 0.85, w: colW - 0.6, h: h - 1.1, fontSize: 13, bulletColor: RED });

  const x2 = 0.6 + colW + gap;
  s.addShape("roundRect", { x: x2, y, w: colW, h, rectRadius: 0.08, fill: { color: "DCEFE4" }, line: { color: GREEN, width: 1.25 } });
  s.addText("/markdown  —  the reliable choice", { x: x2 + 0.3, y: y + 0.25, w: colW - 0.6, h: 0.4, fontFace: CODE_FONT, bold: true, fontSize: 14, color: GREEN, isTextBox: true, margin: 0 });
  bulletList(s, [
    "Mechanical HTML-to-markdown conversion — no AI step",
    "No JSON-escaping failure mode to hit, because there's no JSON generation involved",
    "Reserve /json for small, well-defined field extraction — not “give me all the text”",
  ], { x: x2 + 0.3, y: y + 0.85, w: colW - 0.6, h: h - 1.1, fontSize: 13, bulletColor: GREEN });
  footer(s, "Phase 4 — Handling JavaScript-Rendered (SPA) Pages", pageNum);
}

{
  const s = newSlide("ice");
  conceptHeader(s, 4, "Handling JavaScript-Rendered (SPA) Pages", "Hands-On Lab", "The Fake-Homepage Bug");
  bulletList(s, [
    "A nonexistent path like /mission gets a real 404 from plain fetch() — but 0 characters also “looks thin”",
    "Browser Rendering navigates like a real browser — many SPAs serve the homepage (200) to any unmapped route so client-side routing can take over",
    "Result: several “successful” renders that are silently duplicate homepage content, outvoting the one real page",
  ], { x: 0.6, y: 1.75, w: 12.1, h: 1.9, fontSize: 14.5 });

  codeBlock(s, [
    { text: "// the fix: trust a confirmed non-2xx status — don't", comment: true },
    { text: "// “rescue” it with a render", comment: true },
    { text: "if (plain.status != null && !plain.ok) return plain;" },
  ], { x: 0.6, y: 3.85, w: 12.1, h: 1.65 });
  footer(s, "Phase 4 — Handling JavaScript-Rendered (SPA) Pages", pageNum);
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 5
// ══════════════════════════════════════════════════════════════════════════
dividerSlide({
  num: 5, title: "Diagnostics, Config Drift & the Truncation Bug", duration: "35 min", builds: "Phase 4",
  incident: "A clean crawl, correct rendering — and the extracted values were STILL from the homepage.",
  objectives: [
    "Explain why appearing in sourcePages doesn't prove a page contributed content",
    "Add response-level diagnostics that replace guessing with checking",
    "Recognize config drift as a process failure, not a code bug",
    "Diagnose and fix a silent truncation bug in a shared character budget",
  ],
});

{
  const s = newSlide("light");
  conceptHeader(s, 5, "Diagnostics, Config Drift & the Truncation Bug", "Concept", "Diagnostics Beat Guessing");
  bulletList(s, [
    "“/careers disappeared from sourcePages” — root cause found via git diff, not logs: an invalid [[rules]] block was silently failing every wrangler deploy",
    "“/careers is present, but values are still from the homepage” — CLOUDFLARE_ACCOUNT_ID was never actually set; the render fallback never once ran",
    "Both were invisible from the outside until pageStats and skippedPages existed in the response itself",
  ], { x: 0.6, y: 1.75, w: 12.1, h: 2.1, fontSize: 14.5 });

  codeBlock(s, [
    { text: "pageStats: [" },
    { text: '  { url, source: "plain" | "browser-rendering", textLength }' },
    { text: "]," },
    { text: "skippedPages: [ { url, status, error } ]" },
  ], { x: 0.6, y: 4.0, w: 12.1, h: 1.6 });
  footer(s, "Phase 5 — Diagnostics, Config Drift & the Truncation Bug", pageNum);
}

{
  const s = newSlide("ice");
  conceptHeader(s, 5, "Diagnostics, Config Drift & the Truncation Bug", "Discussion", "Config Drift: Code Problem or Process Problem?");
  s.addText("CLOUDFLARE_ACCOUNT_ID was later found reverted back to unset between working sessions — traced via git diff to wrangler.toml being hand-edited outside the normal deploy flow.", {
    x: 0.6, y: 1.85, w: 12.1, h: 0.85, fontFace: BODY_FONT, fontSize: 15, color: TEXT_DARK, isTextBox: true, margin: 0,
  });
  const cols = [
    { h: "No amount of defensive code…", d: "…fixes a config file someone else keeps editing out from under you." },
    { h: "Mitigation 1", d: "Commit the working config to git for a clear, reviewable change history." },
    { h: "Mitigation 2", d: "Move volatile-but-not-secret values into a secret so a stray local edit can't silently unset them." },
  ];
  const colW = 3.85, gap = 0.3, y = 3.0;
  cols.forEach((c, i) => {
    const cx = 0.6 + i * (colW + gap);
    s.addShape("roundRect", { x: cx, y, w: colW, h: 2.6, rectRadius: 0.08, fill: { color: i === 0 ? NAVY : WHITE }, line: { type: "none" } });
    s.addText(c.h, { x: cx + 0.25, y: y + 0.25, w: colW - 0.5, h: 0.75, fontFace: BODY_FONT, bold: true, fontSize: 14, color: i === 0 ? ORANGE : TEXT_DARK, isTextBox: true, margin: 0 });
    s.addText(c.d, { x: cx + 0.25, y: y + 1.05, w: colW - 0.5, h: 1.4, fontFace: BODY_FONT, fontSize: 12.5, color: i === 0 ? WHITE : TEXT_MUTED, isTextBox: true, margin: 0 });
  });
  footer(s, "Phase 5 — Diagnostics, Config Drift & the Truncation Bug", pageNum);
}

{
  const s = newSlide("light");
  conceptHeader(s, 5, "Diagnostics, Config Drift & the Truncation Bug", "Hands-On Lab", "Find the Truncation Bug");
  bulletList(s, [
    "With MAX_PAGE_CHARS = 8000 and a strict even split across ~4 pages, what's each page's budget?",
    "Browser-Rendered markdown carries overhead a plain-fetched page doesn't: nav links as full [Label](url) syntax, title/description frontmatter, a logo reference",
    "The real “Our Core Values” section sits past that overhead — and past the per-page slice",
  ], { x: 0.6, y: 1.75, w: 12.1, h: 2.0, fontSize: 14.5 });

  codeBlock(s, [
    { text: "const homeBudget = Math.floor(maxTotalChars * 0.25);" },
    { text: "const otherBudget = Math.floor(" },
    { text: "  (maxTotalChars - homeBudget) / Math.max(1, successful.length - 1)" },
    { text: ");" },
    { text: "" },
    { text: "// + raise MAX_PAGE_CHARS from 8,000 to 30,000", comment: true },
  ], { x: 0.6, y: 3.9, w: 12.1, h: 1.85 });
  footer(s, "Phase 5 — Diagnostics, Config Drift & the Truncation Bug", pageNum);
}

// ══════════════════════════════════════════════════════════════════════════
// BREAK 2
// ══════════════════════════════════════════════════════════════════════════
breakSlide(10, "Phase 6 — Adaptive Crawling & Wrap-Up");

// ══════════════════════════════════════════════════════════════════════════
// PHASE 6
// ══════════════════════════════════════════════════════════════════════════
dividerSlide({
  num: 6, title: "Adaptive Crawling & Job-Listing Follow-Up", duration: "35 min", builds: "Phase 5",
  incident: "A real test site: most of RECOMMENDED_PATHS 404'd, and its actual values lived only under /careers.",
  objectives: [
    "Explain why a fixed guess list will always miss some real sites",
    "Scrape a page's own links to discover its actual structure",
    "Rank discovered candidates so an unbounded footer doesn't become an unbounded crawl",
    "Implement a narrow, one-hop-deeper follow-up (careers → job posting)",
  ],
});

{
  const s = newSlide("light");
  conceptHeader(s, 6, "Adaptive Crawling & Job-Listing Follow-Up", "Concept", "From a Guess List to Real Site Structure");
  flowDiagram(s, [
    { label: "Fetch homepage\nfirst", sub: "on its own" },
    { label: "discoverPaths()", sub: "scrape same-origin links" },
    { label: "Rank by relevance", sub: "about, career, value, ...", fill: ORANGE, textColor: NAVY, subColor: NAVY },
    { label: "Cap at 10", sub: "MAX_DISCOVERED_PATHS" },
  ], { x: 0.6, y: 1.75, w: 12.1, h: 1.1 });

  bulletList(s, [
    "The homepage is fetched first — specifically so its links are available before the rest of the crawl is built",
    "This also keeps it at crawlResults[0], which buildContext()'s homepage-share logic still depends on",
    "MIN_OTHER_PAGE_CHARS puts a floor under the per-page budget — page count is no longer fixed, so a strict division would reintroduce Phase 5's bug",
  ], { x: 0.6, y: 3.15, w: 12.1, h: 2.1, fontSize: 14 });
  footer(s, "Phase 6 — Adaptive Crawling & Job-Listing Follow-Up", pageNum);
}

{
  const s = newSlide("ice");
  conceptHeader(s, 6, "Adaptive Crawling & Job-Listing Follow-Up", "Hands-On Lab", "Implement findJobListingLink()");
  bulletList(s, [
    "Some companies state their values inside individual job postings, not on the careers page itself",
    "Rule 1 — nested: the link sits under the careers page's own path (/careers/software-engineer)",
    "Rule 2 — keyword: the link's path contains job, position, opening, apply, or role — even if not nested",
  ], { x: 0.6, y: 1.75, w: 12.1, h: 1.85, fontSize: 14.5 });

  codeBlock(s, [
    { text: "function findJobListingLink(careersResult) {" },
    { text: "  // careersResult.links: absolute, same-origin URLs", comment: true },
    { text: "  // return the first link matching rule 1 or 2, else null", comment: true },
    { text: "}" },
  ], { x: 0.6, y: 3.75, w: 12.1, h: 1.75 });
  footer(s, "Phase 6 — Adaptive Crawling & Job-Listing Follow-Up", pageNum);
}

{
  const s = newSlide("light");
  conceptHeader(s, 6, "Adaptive Crawling & Job-Listing Follow-Up", "Checkpoint", "You've Reached the Reference Implementation");
  s.addText("Your code now matches complete/src/index.js. Run a full extraction against a real company site and inspect every diagnostic field.", {
    x: 0.6, y: 1.75, w: 12.1, h: 0.6, fontFace: BODY_FONT, fontSize: 15, color: TEXT_DARK, isTextBox: true, margin: 0,
  });
  const fields = ["sourcePages", "pageStats[].discovery", "skippedPages", "discoveredPaths", "jobListingPage"];
  const chipW = 2.25, gap = 0.2, y = 2.7;
  fields.forEach((f, i) => {
    const x = 0.6 + i * (chipW + gap);
    s.addShape("roundRect", { x, y, w: chipW, h: 0.6, rectRadius: 0.3, fill: { color: NAVY }, line: { type: "none" } });
    s.addText(f, { x, y, w: chipW, h: 0.6, align: "center", valign: "middle", fontFace: CODE_FONT, fontSize: 10.5, color: ORANGE, isTextBox: true, margin: 0 });
  });
  s.addShape("roundRect", { x: 0.6, y: 3.8, w: 12.1, h: 1.9, rectRadius: 0.08, fill: { color: ICE }, line: { type: "none" } });
  s.addText([
    { text: "KNOWN LIMITATION (accepted, not fixed)   ", options: { bold: true, fontSize: 11.5, color: ORANGE_DEEP, charSpacing: 1.5, breakLine: true } },
    { text: "Discovered links are deduplicated by URL, not content — a homepage linking to itself under two paths (/ and /home) can cause one redundant fetch. Low-cost tradeoff, not a bug.", options: { fontSize: 14.5, italic: true, color: TEXT_DARK } },
  ], { x: 0.9, y: 3.95, w: 11.5, h: 1.6, valign: "top", fontFace: BODY_FONT, isTextBox: true, margin: 0 });
  footer(s, "Phase 6 — Adaptive Crawling & Job-Listing Follow-Up", pageNum);
}

// ══════════════════════════════════════════════════════════════════════════
// RETROSPECTIVE
// ══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide("navy");
  eyebrow(s, "Retrospective", { color: ORANGE });
  s.addText("Five Takeaways", { x: 0.6, y: 0.78, w: 10, h: 0.8, fontFace: TITLE_FONT, bold: true, fontSize: 32, color: WHITE, isTextBox: true, margin: 0 });

  const lessons = [
    ["A symptom can have several stacked causes", "“Values are wrong” was, in sequence: rendering, leaked credential, stale deploy, unset config, wrong endpoint, unread body, SPA routing, config drift, truncation."],
    ["Diagnostics beat guessing", "Code review alone repeatedly missed the actual cause. Real logging and response-level diagnostics found each root cause in one round-trip."],
    ["Reproduce outside the system under test", "A direct curl against the target site ruled out “is this the Worker's fault” faster than redeploying and re-testing."],
    ["Config drift is a real failure mode", "Not everything wrong with a deployed system is a code bug — some of it is process."],
    ["A fixed guess list will always miss some sites", "Scraping a site's actual structure catches what a static list can't."],
  ];
  const top = 1.75, rowH = 0.98;
  lessons.forEach((l, i) => {
    const y = top + i * rowH;
    badge(s, { x: 0.6, y: y + 0.05, d: 0.5, text: i + 1, fontSize: 16 });
    s.addText(l[0], { x: 1.35, y, w: 10.9, h: 0.35, fontFace: BODY_FONT, bold: true, fontSize: 15, color: WHITE, isTextBox: true, margin: 0 });
    s.addText(l[1], { x: 1.35, y: y + 0.38, w: 10.9, h: 0.55, fontFace: BODY_FONT, fontSize: 12, color: TEXT_MUTED_LIGHT, isTextBox: true, margin: 0 });
  });
  footer(s, "Building a Production Cloudflare Worker", pageNum, true);
}

// ══════════════════════════════════════════════════════════════════════════
// CLOSING
// ══════════════════════════════════════════════════════════════════════════
{
  const s = newSlide("navy");
  s.addShape("ellipse", { x: -1.5, y: -1.8, w: 5.5, h: 5.5, fill: { color: NAVY2 }, line: { type: "none" } });
  s.addShape("ellipse", { x: 10.8, y: 4.3, w: 3.6, h: 3.6, fill: { color: ORANGE }, line: { type: "none" }, transparency: 80 });

  s.addText("Thank You", { x: 0, y: 2.1, w: PW, h: 1.0, align: "center", fontFace: TITLE_FONT, bold: true, fontSize: 44, color: WHITE, isTextBox: true, margin: 0 });
  s.addText("Questions, edge cases you hit, or sites that broke something new — let's talk through them.", {
    x: 0, y: 3.1, w: PW, h: 0.5, align: "center", fontFace: BODY_FONT, italic: true, fontSize: 15, color: TEXT_MUTED_LIGHT, isTextBox: true, margin: 0,
  });

  const links = [
    ["complete/", "Reference implementation"],
    ["complete/docs/decision.md", "Full incident-by-incident log"],
    ["complete/docs/cloudflare-skill.md", "Reusable, project-agnostic lessons"],
  ];
  const top = 4.15, rowW = 8.4, startX = (PW - rowW) / 2;
  links.forEach((l, i) => {
    const y = top + i * 0.62;
    s.addShape("roundRect", { x: startX, y, w: rowW, h: 0.5, rectRadius: 0.08, fill: { color: NAVY2 }, line: { type: "none" } });
    s.addText(l[0], { x: startX + 0.25, y, w: 3.6, h: 0.5, valign: "middle", fontFace: CODE_FONT, bold: true, fontSize: 12.5, color: ORANGE, isTextBox: true, margin: 0 });
    s.addText(l[1], { x: startX + 3.9, y, w: rowW - 4.1, h: 0.5, valign: "middle", fontFace: BODY_FONT, fontSize: 12.5, color: WHITE, isTextBox: true, margin: 0 });
  });
  footer(s, "Building a Production Cloudflare Worker", pageNum, true);
}

pres.writeFile({ fileName: "cloudflare-worker-workshop.pptx" }).then(() => {
  console.log("Wrote cloudflare-worker-workshop.pptx with", pageNum, "slides");
});
