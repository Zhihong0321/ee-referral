import { readFileSync, writeFileSync } from 'fs';

function fix(path) {
  let src = readFileSync(path, 'utf8');
  const orig = src;

  // Remove the duplicate preferredAgentId line in filters object literal
  // Pattern: two consecutive `    preferredAgentId: params...` lines
  src = src.replace(
    /(    preferredAgentId: params\.preferredAgentId\?\.trim\(\) \|\| "",\r?\n)    preferredAgentId: params\.preferredAgentId\?\.trim\(\) \|\| "",\r?\n/,
    '$1'
  );

  // Fix AgentSearchField that still references filters.assignedAgentId / inputName="assignedAgentId"
  // Change defaultAgentId to use filters.preferredAgentId and inputName to preferredAgentId
  src = src.replace(
    /            defaultAgentId=\{filters\.assignedAgentId \|\| null\}\r?\n            inputName="assignedAgentId"\r?\n            label="Agent to handle filter"/g,
    `            defaultAgentId={filters.preferredAgentId || null}\n            inputName="preferredAgentId"\n            label="Agent to handle filter"`
  );

  // Also fix referral card: "Assigned agent:" → "Agent to Handle:"
  src = src.replace(/Assigned agent:/g, 'Agent to Handle:');
  src = src.replace(/Assigned agent: /g, 'Agent to Handle: ');

  // Fix referral card display: assignedAgentName → preferredAgentName
  src = src.replace(/referral\.assignedAgentName/g, 'referral.preferredAgentName');
  src = src.replace(/referral\.assignedAgentId/g, 'referral.preferredAgentId');

  // Fix manager workflow form: AgentSearchField with assignedAgentId input
  // "Assign agent" / "Admin assign to agent" label + defaultAgentId={referral.assignedAgentId} + inputName="assignedAgentId"
  src = src.replace(
    /                  defaultAgentId=\{referral\.assignedAgentId\}\r?\n                  inputName="assignedAgentId"\r?\n                  label="Assign agent"/g,
    `                  defaultAgentId={referral.preferredAgentId}\n                  inputName="preferredAgentId"\n                  label="Agent to Handle"`
  );
  src = src.replace(
    /                  defaultAgentId=\{referral\.assignedAgentId\}\r?\n                  inputName="assignedAgentId"\r?\n                  label="Admin assign to agent"/g,
    `                  defaultAgentId={referral.preferredAgentId}\n                  inputName="preferredAgentId"\n                  label="Agent to Handle"`
  );

  if (src !== orig) {
    writeFileSync(path, src, 'utf8');
    console.log('Fixed:', path);
  } else {
    console.log('No change:', path);
    const lines = src.split('\n');
    lines.forEach((l, i) => {
      if (l.includes('assignedAgent') || l.includes('Assigned agent') || (l.includes('preferredAgentId') && lines[i+1]?.includes('preferredAgentId'))) {
        console.log(`  L${i+1}: ${l}`);
      }
    });
  }
}

fix('src/app/admin/page.tsx');
fix('src/app/dashboard/page.tsx');

// Fix referral-overview page: use preferredAgentName for "Referral Out"
function fixOverview(path) {
  let src = readFileSync(path, 'utf8');
  const orig = src;
  src = src.replace(/referral\.assignedAgentName/g, 'referral.preferredAgentName');
  src = src.replace(/referral\.assignedAgentId/g, 'referral.preferredAgentId');
  if (src !== orig) {
    writeFileSync(path, src, 'utf8');
    console.log('Fixed overview:', path);
  }
}
fixOverview('src/app/referral-overview/page.tsx');
