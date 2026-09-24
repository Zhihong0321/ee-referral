const BAILEYS_URL = "https://ee-baileys-2.up.railway.app";
const SESSION_ID = "0182920127";
const WEBHOOK_URL = "https://referral.atap.solar/api/whatsapp-agent/webhook";

async function syncUnansweredMessages() {
  console.log(`Fetching unanswered messages for session ${SESSION_ID} from Baileys...`);
  
  const getResponse = await fetch(`${BAILEYS_URL}/sessions/${SESSION_ID}/messages/unanswered?limit=50`);
  if (!getResponse.ok) {
    throw new Error(`Failed to fetch unanswered messages: HTTP ${getResponse.status} - ${await getResponse.text()}`);
  }

  const payload = await getResponse.json();
  const count = payload.messages?.length || 0;
  
  console.log(`Found ${count} unanswered messages in the Baileys cache.`);

  if (count === 0) {
    console.log("Nothing to sync.");
    return;
  }

  console.log(`Forwarding ${count} messages to the AI Agent webhook at ${WEBHOOK_URL}...`);
  
  // The EE - Referral webhook normalizer is designed to accept Baileys payloads with a "messages" array!
  const postResponse = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!postResponse.ok) {
    throw new Error(`Webhook rejected the payload: HTTP ${postResponse.status} - ${await postResponse.text()}`);
  }

  const webhookResult = await postResponse.json();
  console.log(`Success! Webhook processed ${webhookResult.processed} messages.`);
  console.log("Results:", JSON.stringify(webhookResult.results, null, 2));
}

syncUnansweredMessages().catch(console.error);
