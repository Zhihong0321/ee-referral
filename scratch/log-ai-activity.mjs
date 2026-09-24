const proxyUrl = "https://pg-proxy-production.up.railway.app/api/sql";
const authToken = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3ODM1NzIyNTMsImV4cCI6MTgxOTU3MzM2NCwiZGJfbmFtZSI6InByb2RfbWFpbiIsImFjY2VzcyI6InJlYWRfb25seSIsInByb3h5X3VybCI6Imh0dHBzOi8vcGctcHJveHktcHJvZHVjdGlvbi51cC5yYWlsd2F5LmFwcC8iLCJhcGlfZG9jc191cmwiOiJodHRwczovL3BnLXByb3h5LXByb2R1Y3Rpb24udXAucmFpbHdheS5hcHAvZG9jcyJ9.XUCRoOwjXM-hjDSN9m3LhLgnt11lT6rUtKdOT_NiFfY";

async function testQuery() {
  try {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authToken
      },
      body: JSON.stringify({
        db_name: "prod_main",
        sql: "SELECT id, app, agent, action, description, occurred_at FROM ai_activity_log ORDER BY id DESC LIMIT 5",
        params: []
      })
    });
    const data = await res.json();
    console.log("Query result:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error querying proxy:", err.message);
  }
}

testQuery();
