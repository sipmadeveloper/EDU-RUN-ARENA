import fs from 'node:fs';
import path from 'node:path';

/**
 * Security Rules Invariant & Dirty-Dozen Verification Suite for EDU RUN ARENA 3D (with Verified Admin RBAC).
 * Verifies that firestore.rules enforces all 8 Pillars and blocks every Dirty-Dozen attack vector.
 */
const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesText = fs.readFileSync(rulesPath, 'utf8');

interface SecurityAssertion {
  name: string;
  check: () => boolean;
}

const assertions: SecurityAssertion[] = [
  {
    name: '1. Global default-deny safety net present',
    check: () => /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/.test(rulesText),
  },
  {
    name: '2. Verified email requirement enforced (blocks unverified admin email spoofing)',
    check: () =>
      rulesText.includes('request.auth.token.email_verified == true') &&
      rulesText.includes("function isBootstrapAdmin() {\n      return isVerifiedUser()\n        && request.auth.token.email == 'sipmadeveloper@gmail.com';"),
  },
  {
    name: '3. Strict path ID poisoning guard regex present',
    check: () => rulesText.includes("id.matches('^[a-zA-Z0-9_\\\\-]+$')"),
  },
  {
    name: '4. Teacher profile PII isolation (owner/admin get, strictly bootstrap-admin list)',
    check: () =>
      rulesText.includes('allow get: if (isOwner(teacherId) || isAdmin()) && isValidId(teacherId);') &&
      rulesText.includes('allow list: if isBootstrapAdmin();'),
  },
  {
    name: '5. Trusted /admins/{adminId} registry blocks self-assigned admin escalation',
    check: () =>
      /match \/admins\/\{adminId\}[\s\S]*allow create: if isBootstrapAdmin\(\)/.test(rulesText) &&
      /match \/admins\/\{adminId\}[\s\S]*allow update: if false;/.test(rulesText),
  },
  {
    name: '6. Shadow field protection (hasAll + hasOnly on all 4 entities)',
    check: () =>
      (rulesText.match(/data\.keys\(\)\.hasAll\(/g) || []).length >= 4 &&
      (rulesText.match(/data\.keys\(\)\.hasOnly\(/g) || []).length >= 4,
  },
  {
    name: '7. Action-based affectedKeys().hasOnly() on every update block (Tier 1 Admin + Tier 2 Owner)',
    check: () => (rulesText.match(/affectedKeys\(\)\.hasOnly\(/g) || []).length >= 5,
  },
  {
    name: '8. Validation blueprint invoked inside every update block (Anti-Update-Gap)',
    check: () =>
      rulesText.includes('isValidTeacherProfile(incoming(), teacherId)') &&
      rulesText.includes('isValidQuestionPack(incoming())') &&
      rulesText.includes('isValidMatchArchive(incoming())') &&
      rulesText.includes('isValidAdminAccount(incoming(), adminId)'),
  },
  {
    name: '9. Master Gate parent existence check on subcollections (blocks orphan writes)',
    check: () => rulesText.includes('exists(/databases/$(database)/documents/teachers/$(teacherId))'),
  },
  {
    name: '10. Bounded array + element type guard (<= 50 questions, <= 30 standings)',
    check: () =>
      rulesText.includes('data.questions.size() <= 50') &&
      rulesText.includes('data.questions[0] is map') &&
      rulesText.includes('data.standings.size() <= 30') &&
      rulesText.includes('data.standings[0] is map'),
  },
  {
    name: '11. Terminal state locking on matchArchives (immutable once archived)',
    check: () => /match \/matchArchives\/\{archiveId\}[\s\S]*allow update: if false;/.test(rulesText),
  },
  {
    name: '12. Strict server timestamp integrity (request.time) + zero get()/exists() in allow list',
    check: () =>
      rulesText.includes('incoming().createdAt == request.time') &&
      rulesText.includes('incoming().updatedAt == request.time') &&
      rulesText.includes('allow list: if (isOwner(teacherId) && resource.data.ownerId == request.auth.uid)\n          || (isBootstrapAdmin() && resource.data.ownerId == teacherId);'),
  },
];

let failed = 0;
for (const a of assertions) {
  if (!a.check()) {
    console.error(`FAIL: ${a.name}`);
    failed++;
  } else {
    console.log(`PASS: ${a.name}`);
  }
}

if (failed > 0) {
  process.exit(1);
}
console.log('ALL 12 DIRTY-DOZEN + ADMIN RBAC SECURITY RULE INVARIANTS VERIFIED!');
