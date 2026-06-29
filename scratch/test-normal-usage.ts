import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
process.env.MINIMAX_API_KEY = "sk-cp-Mn15gRFLBQz1Rb5roxtNLoet9MDnGLTiET3I2YmebEWr4WOvgQLOei3D48o2HIrm36pcF8aA1shygKt1WMWrNy-ca5Cr1cij4MxOOTHZkRBmfPLKBpXBMuo";

const originalFetch = global.fetch;
let mockMetadata = {};
let isRegistered = false;

global.fetch = async (url, options) => {
  if (typeof url === "string" && url.includes("pg-proxy-production")) {
    const body = JSON.parse(options.body);
    const sql = body.sql.toLowerCase();
    
    let rows = [];
    if (sql.includes("et_channel_sessions") && sql.includes("insert into")) {
      rows = [{ id: 1, metadata: mockMetadata }];
    } else if (sql.includes("et_channel_sessions") && sql.includes("with existing as")) {
      rows = [{ id: 1, metadata: mockMetadata }];
    } else if (sql.includes("update et_channel_sessions")) {
      if (body.params[3] && typeof body.params[3] === "string") {
        if (body.params[3].includes("mode") || body.params[3].includes("onboarding")) {
          mockMetadata.agentStates = mockMetadata.agentStates || {};
          mockMetadata.agentStates["60199998888"] = JSON.parse(body.params[3]);
        }
      }
      rows = [];
    } else if (sql.includes("information_schema.tables")) {
      rows = [{ has_user_table: true, has_access_level: false }];
    } else if (sql.includes("select u.id, u.name from \"user\" u")) {
      rows = [{ id: 1, name: "Gan" }, { id: 2, name: "Zhi Hong" }];
    } else if (sql.includes("customer c") && sql.includes("unnest")) {
      if (isRegistered) {
        rows = [{ customer_id: "ref_norm", name: "John Doe", phone: "60199998888", notes: "{\"bankAccount\":\"Maybank 123456\"}", is_generic_name: false, match_rank: 1, match_index: 1 }];
      } else {
        rows = [];
      }
    } else if (sql.includes("insert into referral") || sql.includes("createWhatsappReferral")) {
      rows = [{ id: 888 }];
    } else if (sql.includes("update customer")) {
      isRegistered = true;
      rows = [];
    } else if (sql.includes("insert into customer")) {
      // do NOT set isRegistered = true here, user is unregistered initially
      rows = [{ customer_id: "ref_norm", name: body.params[1], phone: body.params[2], notes: "{}", is_generic_name: false }];
    } else if (sql.includes("select r.id, r.bubble_id, r.name")) {
      rows = []; // empty leads
    } else if (sql.includes("select contact from \"user\"")) {
      rows = [{ contact: "60123456789" }];
    }

    return new Response(JSON.stringify({ rows }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  return originalFetch(url, options);
};

async function run() {
  const { runWhatsappAgentTurn } = await import("../src/lib/agent/whatsapp-flow");
  const userPhone = "60199998888"; 
  console.log(`Starting automated test for NORMAL USER with phone: ${userPhone}\n`);
  
  const steps = [
    { title: "STEP 1: Unknown User says Hi", text: "Hi there" },
    { title: "STEP 2: User provides Name", text: "John Doe" },
    { title: "STEP 3: User provides Bank Info", text: "Maybank 12345678" },
    { title: "STEP 4: User submits a Lead", text: "I have a lead, Ali from KL, 0123456789" },
    { title: "STEP 5: User assigns preferred Agent", text: "Assign to Gan" }
  ];

  for (const step of steps) {
    console.log(`--- ${step.title} ---`);
    console.log(`[USER]: ${step.text}`);
    const result = await runWhatsappAgentTurn({ senderPhone: userPhone, text: step.text });
    console.log(`[AGENT]: ${result.reply}`);
    if (result.toolTrace && result.toolTrace.length > 0) {
      console.log(`[TRACE]: ${JSON.stringify(result.toolTrace, null, 2)}`);
    }
    console.log("\n");
  }

  console.log("Test complete.");
}

run().catch(console.error);
