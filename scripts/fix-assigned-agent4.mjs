import { readFileSync, writeFileSync } from 'fs';

function fix(path) {
  let src = readFileSync(path, 'utf8');
  const orig = src;

  // Remove duplicate preferredAgentId line from searchParams type
  // The pattern is two consecutive preferredAgentId lines
  src = src.replace(/(    preferredAgentId\?: string;\r?\n)    preferredAgentId\?: string;\r?\n/g, '$1');

  // Fix filters object: assignedAgentId → preferredAgentId (dedup: if preferredAgentId already exists, remove assignedAgentId line)
  // Pattern: preferredAgentId: ...,\n    assignedAgentId: ...
  src = src.replace(/    preferredAgentId: ([^\n]+),\r?\n    assignedAgentId: [^\n]+,\r?\n/g, '    preferredAgentId: $1,\n');
  // Also: assignedAgentId: ... standalone in filters object
  src = src.replace(/    assignedAgentId: params\.assignedAgentId[^\n]*,\r?\n/g, '');
  src = src.replace(/    assignedAgentId: params\.assignedAgentId[^\n]*\r?\n/g, '');

  if (src !== orig) {
    writeFileSync(path, src, 'utf8');
    console.log('Fixed:', path);
  } else {
    console.log('No change:', path);
    // Debug
    const lines = src.split('\n');
    lines.forEach((l, i) => {
      if (l.includes('preferredAgentId') || l.includes('assignedAgentId')) {
        console.log(`  L${i+1}: ${l}`);
      }
    });
  }
}

fix('src/app/admin/page.tsx');
fix('src/app/dashboard/page.tsx');
