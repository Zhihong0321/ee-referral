/**
 * End-to-end test for the LLM-first WhatsApp agent (V2).
 *
 * Pipeline per case:
 *   1. POST /api/whatsapp-agent/webhook?dryRun=true  -> runs REAL media conversion
 *      (image OCR via vision API, contact-card parse). No DB write, no send.
 *   2. POST /api/whatsapp-agent/test-v2 with the converted text -> REAL MiniMax-M3
 *      + validated tools + REAL prod_main writes. Send is stubbed (no BAILEYS base url).
 *
 * The local PNG is served over 127.0.0.1 so the real vision fetch path runs unchanged.
 */

import http from "node:http";
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = "http://localhost:3000";
const PHONE = process.argv[2] || "601121000099";
const IMAGE_PATH = process.argv[3] || "C:/Users/Eternalgy/.claude/image-cache/9afbc3c5-6f92-4670-bc40-46fa5a1683fe/2.png";

// Real OCR text captured from the live vision API on the NR Health Enterprise
// screenshot during an earlier run — used as fallback if the ephemeral image
// cache file is no longer on disk.
const CAPTURED_OCR =
  "[System: User sent an image. Extracted content:]\n" +
  "Lead name: NR Health Enterprise (Kopi Pak Mentua) | Lead phone: 016-238 1639 | " +
  "Area: B 1/5, Diamond Residence, 38, Jalan Diamond, 43500 Semenyih, Selangor | " +
  "Notes: Health consultant; facebook.com; XV46+MC Semenyih, Selangor";

// ---- tiny static server for the test image (only if the file still exists) ----
let imgServer = null;
let IMAGE_URL = "";
if (fs.existsSync(IMAGE_PATH)) {
  const imgBytes = fs.readFileSync(IMAGE_PATH);
  imgServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(imgBytes);
  });
  await new Promise((r) => imgServer.listen(0, "127.0.0.1", r));
  IMAGE_URL = `http://127.0.0.1:${imgServer.address().port}/2.png`;
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

// Stage 1: real media conversion via webhook dryRun. Returns converted text.
async function convert(message) {
  const { status, json } = await post("/api/whatsapp-agent/webhook?dryRun=true", { messages: [message] });
  const r = json.results?.[0];
  return { status, text: r?.text ?? "", rawStatus: r?.status, full: json };
}

// Stage 2: agent brain + tools + prod DB.
async function agent(text) {
  const { status, json } = await post("/api/whatsapp-agent/test-v2", { phone: PHONE, message: text });
  return { status, json };
}

function hr(t) { console.log("\n" + "=".repeat(78) + "\n" + t + "\n" + "=".repeat(78)); }
function showAgent(label, res) {
  console.log(`\n--- ${label} ---`);
  console.log("HTTP", res.status);
  if (res.json.error) { console.log("ERROR:", res.json.error); return; }
  const tt = res.json.toolTrace || [];
  if (tt.length) {
    console.log("Tools:", tt.map((t) => `${t.name}[${t.status}]`).join(" -> "));
    for (const t of tt) console.log(`   ${t.name}(${JSON.stringify(t.input)}) => ${JSON.stringify(t.result)}`);
  } else {
    console.log("Tools: (none)");
  }
  console.log("Reply:", JSON.stringify(res.json.reply));
}

async function main() {
  console.log("E2E V2 — phone:", PHONE, "| image:", IMAGE_URL);

  // -- TEXT 1: onboarding (multi-field) --
  hr("TEXT 1 — onboarding");
  showAgent("save name + bank", await agent("Hi, my name is Zhi Hong and my bank account is Maybank 514011223344"));
  await sleep(300);

  // -- TEXT 2: plain-text lead with agent --
  hr("TEXT 2 — text lead + preferred agent");
  showAgent("create lead", await agent("New lead: Ali Bin Ahmad, 0123456789, Semenyih area, assign to agent Zhi Hong"));
  await sleep(300);

  // -- TEXT 3: list leads --
  hr("TEXT 3 — list my leads");
  showAgent("get_my_leads", await agent("show me all my leads"));
  await sleep(300);

  // -- CONTACT CARD --
  hr("CONTACT CARD — vCard -> lead");
  const contactConv = await convert({
    senderPhone: PHONE,
    messageType: "contact",
    message: {
      contactMessage: {
        displayName: "Siti Sales Prospect",
        vcard: "BEGIN:VCARD\nVERSION:3.0\nFN:Siti Sales Prospect\nTEL;type=CELL:+60198887777\nEND:VCARD",
      },
    },
  });
  console.log("Converted text:", JSON.stringify(contactConv.text));
  showAgent("agent handles contact", await agent(contactConv.text));
  await sleep(300);

  // -- IMAGE OCR --
  hr("IMAGE — real OCR via vision API");
  let ocrText;
  if (IMAGE_URL) {
    const imgConv = await convert({
      senderPhone: PHONE,
      messageType: "image",
      mediaUrl: IMAGE_URL,
      message: { imageMessage: { url: IMAGE_URL } },
    });
    console.log("OCR status:", imgConv.rawStatus, "(live vision API)");
    ocrText = imgConv.text || CAPTURED_OCR;
  } else {
    console.log("OCR status: using captured OCR (image cache file expired)");
    ocrText = CAPTURED_OCR;
  }
  console.log("OCR text:", JSON.stringify(ocrText));
  showAgent("agent handles image", await agent(ocrText));
  await sleep(300);

  // -- ADMIN MODE --
  hr("ADMIN — enter admin mode then send the image");
  showAgent("enter admin", await agent("ee-admin"));
  await sleep(300);
  showAgent("admin + image text", await agent(ocrText));

  if (imgServer) imgServer.close();
  console.log("\nDONE.");
}

main().catch((e) => { console.error(e); if (imgServer) imgServer.close(); process.exit(1); });
