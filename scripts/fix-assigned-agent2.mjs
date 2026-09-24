import { readFileSync, writeFileSync } from 'fs';

let src = readFileSync('src/lib/referrals.ts', 'utf8');

// Fix the listReferralsByReferrer return object — remove assignedAgent lines
src = src.replace(
  /      assignedAgentId: mapped\.assignedAgentId,\r?\n      assignedAgentName: mapped\.assignedAgentName,\r?\n/,
  ''
);

writeFileSync('src/lib/referrals.ts', src, 'utf8');

// Confirm
const remaining = src.split('\n').filter(l =>
  (l.includes('assignedAgent') && !l.includes('//')) ||
  (l.includes('assigned_agent') && !l.includes('has_referral_assigned_agent') && !l.includes('hasReferralAssigned') && !l.includes('assigned_agent\n') && !l.includes("column_name = 'assigned_agent'"))
);

console.log('Remaining assigned lines:');
remaining.forEach(l => console.log(' ', l.trim()));
console.log('Done');
