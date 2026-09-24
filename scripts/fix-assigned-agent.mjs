import { readFileSync, writeFileSync } from 'fs';

let src = readFileSync('src/lib/referrals.ts', 'utf8');
const orig = src;

// 1. Remove assignedAgentIdSchema definition block
src = src.replace(
  /\r?\nconst assignedAgentIdSchema = z\r?\n  \.string\(\)\r?\n  \.trim\(\)\r?\n  \.max\(20, "Assigned agent is invalid"\)\r?\n  \.refine\([^;]+;\r?\n/,
  '\n'
);

// 2. Remove assignedAgentId + assignedAgentName from ReferralRow type
src = src.replace(/  assignedAgentId: string \| null;\r?\n  assignedAgentName: string \| null;\r?\n/, '');

// 3. Remove assignedAgentId from ManagerReferralFilters
src = src.replace(/  assignedAgentId\?: string;\r?\n/, '');

// 4. Remove assignedAgent select/join variables from listReferralsByReferrer and listManagerReferralLeads
// These appear twice in the file - both occurrences
src = src.replace(
  /  const assignedAgentIdSelect = capabilities\.hasReferralAssignedAgent\r?\n    \? "r\.assigned_agent AS assigned_agent_id"\r?\n    : "NULL::text AS assigned_agent_id";\r?\n  const assignedAgentNameSelect =\r?\n    capabilities\.hasReferralAssignedAgent && capabilities\.hasUserTable\r?\n      \? "assigned_agent\.name AS assigned_agent_name"\r?\n      : "NULL::text AS assigned_agent_name";\r?\n  const assignedAgentJoin =\r?\n    capabilities\.hasReferralAssignedAgent && capabilities\.hasUserTable\r?\n      \? 'LEFT JOIN "user" assigned_agent ON assigned_agent\.id::text = r\.assigned_agent'\r?\n      : "";\r?\n/g,
  ''
);

// 5. Remove ${assignedAgentIdSelect}, and ${assignedAgentNameSelect}, from SQL queries
src = src.replace(/        \$\{assignedAgentIdSelect\},\r?\n/g, '');
src = src.replace(/        \$\{assignedAgentNameSelect\},\r?\n/g, '');
src = src.replace(/      \$\{assignedAgentJoin\}\r?\n/g, '');

// 6. Remove assignedAgentId and assignedAgentName from mapReferralRow return
src = src.replace(/    assignedAgentId: row\.assigned_agent_id,\r?\n    assignedAgentName: row\.assigned_agent_name,\r?\n/, '');

// 7. Also remove from the query row type hints in listManagerReferralLeads and listReferralsByReferrer
src = src.replace(/    assigned_agent_id: string \| null;\r?\n    assigned_agent_name: string \| null;\r?\n/g, '');

// 8. Remove assignedAgentId filter logic from listManagerReferralLeads
src = src.replace(
  /\r?\n  if \(filters\.assignedAgentId\?\.trim\(\)\) \{[\s\S]*?  \}\r?\n(?=\r?\n  if \(filters\.search)/,
  '\n'
);

// 9. Change assignment filter to use linked_agent instead of assigned_agent
src = src.replace(
  /  if \(filters\.assignment === "assigned"\) \{\r?\n    if \(capabilities\.hasReferralAssignedAgent\) \{\r?\n      whereClauses\.push\("r\.assigned_agent IS NOT NULL AND BTRIM\(r\.assigned_agent\) <> ''"\);\r?\n    \} else \{\r?\n      whereClauses\.push\("FALSE"\);\r?\n    \}\r?\n  \} else if \(filters\.assignment === "unassigned"\) \{\r?\n    if \(capabilities\.hasReferralAssignedAgent\) \{\r?\n      whereClauses\.push\("\(r\.assigned_agent IS NULL OR BTRIM\(r\.assigned_agent\) = ''\)"\);\r?\n    \}\r?\n  \}/,
  `  if (filters.assignment === "assigned") {\n    if (capabilities.hasReferralLinkedAgent) {\n      whereClauses.push("r.linked_agent IS NOT NULL AND BTRIM(r.linked_agent) <> ''");\n    } else {\n      whereClauses.push("FALSE");\n    }\n  } else if (filters.assignment === "unassigned") {\n    if (capabilities.hasReferralLinkedAgent) {\n      whereClauses.push("(r.linked_agent IS NULL OR BTRIM(r.linked_agent) = '')");\n    }\n  }`
);

// 10. Fix updateReferralManagerWorkflow to write to linked_agent instead of assigned_agent
src = src.replace(
  /    const assignedAgentId = await normalizeAgentId\(client, parsed\.data\.assignedAgentId, "Assigned agent"\);\r?\n\r?\n    await client\.query\(\r?\n      `\r?\n        UPDATE referral\r?\n        SET\r?\n          assigned_agent = \$1,\r?\n          status = \$2,\r?\n          updated_at = NOW\(\)\r?\n        WHERE id = \$3\r?\n      `,\r?\n      \[assignedAgentId, parsed\.data\.status, parsed\.data\.referralId\],\r?\n    \);/,
  `    const preferredAgentId = await normalizeAgentId(client, parsed.data.preferredAgentId, "Preferred agent");\n\n    await client.query(\n      \`\n        UPDATE referral\n        SET\n          linked_agent = $1,\n          status = $2,\n          updated_at = NOW()\n        WHERE id = $3\n      \`,\n      [preferredAgentId, parsed.data.status, parsed.data.referralId],\n    );`
);

// 11. Also fix the capability check in updateReferralManagerWorkflow
src = src.replace(
  /    if \(!capabilities\.hasReferralAssignedAgent\) \{\r?\n      throw new ReferralError\("Referral assignment columns are not available yet\. Run the latest migration first\."\);\r?\n    \}/,
  `    if (!capabilities.hasReferralLinkedAgent) {\n      throw new ReferralError("Preferred agent column is not available yet. Run the latest migration first.");\n    }`
);

// 12. listAssignedReferrals: change assignedAgentId to preferredAgentId
src = src.replace(
  /  return listManagerReferralLeads\(\{\r?\n    assignedAgentId: agentId,\r?\n  \}\);/,
  `  return listManagerReferralLeads({\n    preferredAgentId: agentId,\n  });`
);

const changed = src !== orig;
console.log('Changed:', changed);

if (changed) {
  writeFileSync('src/lib/referrals.ts', src, 'utf8');
  console.log('Written successfully');

  // Verify key patterns removed
  const remaining = [
    'assignedAgentId: string',
    'assignedAgentName: string',
    'assignedAgentId?: string',
    'assigned_agent_id,',
    'assigned_agent_name,',
    'assignedAgentId: row.',
    'assignedAgentName: row.',
    'assigned_agent =',
    'assignedAgentId: agentId',
  ];
  for (const p of remaining) {
    if (src.includes(p)) {
      console.log('STILL PRESENT:', p);
    }
  }
  console.log('Verification done');
} else {
  console.log('No changes - patterns may not have matched');
  // Show what the file has around key points
  const lines = src.split('\n');
  lines.forEach((l, i) => {
    if (l.includes('assigned') || l.includes('Assigned')) {
      console.log(`Line ${i+1}: ${l}`);
    }
  });
}
