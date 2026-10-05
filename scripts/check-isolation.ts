import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_DIR = path.resolve(process.cwd(), 'src/server');

// Files explicitly allowed to interact with root collections
const ALLOWED_FILES = new Set([
  'tenantRepo.ts',
]);

// Collections that must NEVER be accessed at root level in tenant services
const TENANT_ONLY_COLLECTIONS = [
  'contacts',
  'leads',
  'conversations',
  'messages',
  'campaigns',
  'campaign_leads',
  'campaign_runs',
  'campaign_send_history',
  'email_templates',
  'knowledge_documents',
  'bookings',
  'lead_activities',
  'outbound_prospects',
  'outbound_campaigns',
  'processed_inbound_emails',
  'website_lead_thankyou_history',
  'suppressions',
  'usage',
  'secrets',
  'jobs',
  'audit_logs',
];

interface Violation {
  file: string;
  line: number;
  snippet: string;
  reason: string;
}

function scanFile(filePath: string): Violation[] {
  const fileName = path.basename(filePath);
  if (ALLOWED_FILES.has(fileName)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: Violation[] = [];

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();

    // Ignore comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      return;
    }

    // Check for raw collection(db, '...')
    for (const col of TENANT_ONLY_COLLECTIONS) {
      const rawCollectionRegex = new RegExp(`\\bcollection\\s*\\(\\s*db\\s*,\\s*['"\`]${col}['"\`]`, 'i');
      const rawDocRegex = new RegExp(`\\bdoc\\s*\\(\\s*db\\s*,\\s*['"\`]${col}['"\`]`, 'i');
      const rawRestRegex = new RegExp(`databases/[^/]+/documents/${col}/`, 'i');

      if (rawCollectionRegex.test(line)) {
        violations.push({
          file: path.relative(process.cwd(), filePath),
          line: lineNum,
          snippet: trimmed,
          reason: `Direct root collection access to '${col}'. Must use tenantRepo(ctx).${col}() instead.`,
        });
      } else if (rawDocRegex.test(line)) {
        violations.push({
          file: path.relative(process.cwd(), filePath),
          line: lineNum,
          snippet: trimmed,
          reason: `Direct root doc access to '${col}'. Must use tenantRepo(ctx).${col}Doc(id) instead.`,
        });
      } else if (rawRestRegex.test(line)) {
        violations.push({
          file: path.relative(process.cwd(), filePath),
          line: lineNum,
          snippet: trimmed,
          reason: `Direct REST URL path to root collection '${col}'. Must route through tenantRepo.`,
        });
      }
    }
  });

  return violations;
}

function scanDir(dir: string): Violation[] {
  const violations: Violation[] = [];
  if (!fs.existsSync(dir)) return violations;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      violations.push(...scanDir(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      violations.push(...scanFile(fullPath));
    }
  }

  return violations;
}

export function runIsolationCheck(): boolean {
  console.log('[Check Isolation] Auditing src/server for multi-tenant data boundary isolation...');
  const violations = scanDir(SERVER_DIR);

  if (violations.length === 0) {
    console.log('✅ Isolation check passed: No unauthorized root collection access detected in src/server.');
    return true;
  }

  console.error(`❌ Isolation check FAILED: Found ${violations.length} boundary violation(s):`);
  violations.forEach((v) => {
    console.error(`  - ${v.file}:${v.line}: ${v.reason}`);
    console.error(`    Code: ${v.snippet}`);
  });

  return false;
}

const passed = runIsolationCheck();
if (!passed) {
  process.exit(1);
}
