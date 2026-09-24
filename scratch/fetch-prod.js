const url = "https://pg-proxy-production.up.railway.app/api/sql";
const token = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3ODI3MjA4MDksImV4cCI6MTc4MzA4MDgzMSwiZGJfbmFtZSI6InByb2RfbWFpbiIsImFjY2VzcyI6ImZ1bGwiLCJwcm94eV91cmwiOiJodHRwczovL3BnLXByb3h5LXByb2R1Y3Rpb24udXAucmFpbHdheS5hcHAvIiwiYXBpX2RvY3NfdXJsIjoiaHR0cHM6Ly9wZy1wcm94eS1wcm9kdWN0aW9uLnVwLnJhaWx3YXkuYXBwL2RvY3MifQ.O1fPUpPYfT0lFSWvnUH3ksU1GCExoppZMAJOHjqMDZA";

async function run() {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": token
    },
    body: JSON.stringify({
      db_name: "prod_main",
      sql: `
        SELECT id, sender_phone, process_status, last_error, updated_at
        FROM wa_inbound_inbox
        ORDER BY updated_at DESC LIMIT 10
      `,
      params: []
    })
  });
  console.log(await response.text());
}
run();
