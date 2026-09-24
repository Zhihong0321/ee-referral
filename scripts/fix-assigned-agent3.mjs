import { readFileSync, writeFileSync } from 'fs';

function fix(path) {
  let src = readFileSync(path, 'utf8');
  const orig = src;

  // Remove assignedAgentId/assignedAgentName from object literals (mapReferral, buildReferralRow)
  src = src.replace(/    assignedAgentId: row\.assigned_agent_id,\r?\n    assignedAgentName: row\.assigned_agent_name,\r?\n/g, '');

  // Remove assigned_agent_id / assigned_agent_name from type definitions
  src = src.replace(/  assigned_agent_id: string \| null;\r?\n  assigned_agent_name: string \| null;\r?\n/g, '');
  src = src.replace(/  assigned_agent_id: string \| null,\r?\n  assigned_agent_name: string \| null,\r?\n/g, '');

  // Fix duplicate preferredAgentId in searchParams types (admin/page and dashboard/page)
  // pattern: assignedAgentId?: string;\n    preferredAgentId?: string;
  src = src.replace(/    assignedAgentId\?: string;\r?\n    preferredAgentId\?: string;\r?\n/g, '    preferredAgentId?: string;\n');
  // also: assignedAgentId?: string; (standalone in type)
  src = src.replace(/    assignedAgentId\?: string;\r?\n/g, '');

  if (src !== orig) {
    writeFileSync(path, src, 'utf8');
    console.log('Fixed:', path);
  } else {
    console.log('No change:', path);
  }
}

fix('src/lib/agent/whatsapp-data.ts');
fix('src/lib/agent/sandbox-data.ts');
fix('src/app/admin/page.tsx');
fix('src/app/dashboard/page.tsx');
