const processUrl = "https://referral.atap.solar/api/whatsapp-agent/process";
// Replace this with the WHATSAPP_AGENT_PROCESS_SECRET from your Railway environment variables
const processSecret = "YOUR_SECRET_HERE";

async function retryFailedMessages() {
  console.log(`Triggering manual retry on ${processUrl}...`);
  
  const response = await fetch(processUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${processSecret}`
    },
    body: JSON.stringify({
      source: "database",
      dryRun: false,
      limit: 50,
      lookbackMinutes: 10080, // Look back 7 days (10080 minutes)
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(`Failed with HTTP ${response.status}:`, payload);
    return;
  }

  console.log(`Successfully processed ${payload.processed} messages!`);
  console.log("Results:", JSON.stringify(payload.results, null, 2));
}

retryFailedMessages().catch(console.error);
