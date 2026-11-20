# Security Specification — EDU RUN ARENA 3D (Firebase Firestore + Admin RBAC)

## 1. Data Invariants & Master Source of Truth
1. **Master Source of Truth**: `/teachers/{teacherId}` is the root owner document keyed by Firebase Auth UID (`teacherId == request.auth.uid` for teacher self-access).
2. **Verified Admin RBAC**:
   - **Bootstrap Admin**: Verified Google account `sipmadeveloper@gmail.com` (`request.auth.token.email_verified == true && request.auth.token.email == 'sipmadeveloper@gmail.com'`).
   - **Delegated Admin Registry**: `/admins/{adminId}` — strictly writable/deletable ONLY by the verified Bootstrap Admin. Self-assigned admin roles are strictly forbidden.
   - Verified Admins may inspect teachers' storage usage, adjust teachers' auto-cleanup retention limits (`maxArchivedMatches`, `retentionDays`), delete any teacher's `questionPacks` and `matchArchives`, and delete teacher profile documents after clearing subcollections.
3. **Master Gate**: No document in `/teachers/{teacherId}/questionPacks/{packId}` or `/teachers/{teacherId}/matchArchives/{archiveId}` may be read, created, updated, or deleted unless `/teachers/{teacherId}` exists (`exists(/databases/$(database)/documents/teachers/$(teacherId))`) and the caller is either the verified owner (`request.auth.uid == teacherId`) or a verified Admin.
4. **PII Isolation**: `/teachers/{teacherId}` contains `email`. Blanket reads by non-admins are strictly forbidden; `get` is restricted to `isOwner(teacherId) || isAdmin()`, and `list` is strictly restricted to `isBootstrapAdmin()` with `resource.data.ownerId is string` (zero `get()`/`exists()` inside `allow list` per Pillar 8).
5. **Spark Free Tier Volumetric Guards**:
   - Every string field enforces strict `.size()` upper bounds matching `firebase-blueprint.json`.
   - `questionPacks/{packId}.questions` is strictly bounded to `<= 50` items (`packIndex` between `0` and `9`).
   - `matchArchives/{archiveId}.standings` is strictly bounded to `<= 30` items and locked in terminal state `status == 'archived'` (immutable after creation, only deletable by owner or admin).
6. **Temporal & Identity Integrity**: `ownerId`, `email`, and `createdAt` are immutable after create; `createdAt == request.time` on create; `updatedAt == request.time` on update.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Shadow Field Injection (Teacher Profile)**: Creating `/teachers/{uid}` with extra field `isAdmin: true` or `role: "superadmin"` -> Rejected by `keys().hasOnly(...)`.
2. **Identity Spoofing (Teacher Profile)**: Creating `/teachers/{uid}` with `ownerId: "victim-uid"` -> Rejected by `data.ownerId == teacherId && isOwner(teacherId)`.
3. **Admin Email Spoofing (Unverified Email)**: Calling `list(/teachers)` or `delete(/teachers/otherUid/matchArchives/m1)` with `email: "sipmadeveloper@gmail.com"` but `email_verified: false` -> Rejected by `isVerifiedUser()`.
4. **Self-Assigned Admin Privilege Escalation**: Regular teacher trying to create `/admins/{myUid}` -> Rejected by `isBootstrapAdmin()`.
5. **Cross-Teacher PII Read / List Scrape by Non-Admin**: Non-admin teacher calling `get(/teachers/otherUid)` or `list(/teachers)` -> Rejected by `isOwner(teacherId) || isAdmin()` / `isBootstrapAdmin()`.
6. **Cross-Teacher Data Deletion by Non-Admin**: Non-admin teacher attempting `delete(/teachers/otherUid/questionPacks/pack-0)` or `delete(/teachers/otherUid)` -> Rejected.
7. **ID Poisoning (Resource Exhaustion)**: Creating/deleting a document with a 500-char or symbol-injected ID (`../../evil`) -> Rejected by `isValidId(...)`.
8. **Orphaned Subcollection Write (Master Gate Bypass)**: Creating `/teachers/{uid}/questionPacks/pack-0` before `/teachers/{uid}` exists -> Rejected by `teacherProfileExists(teacherId)`.
9. **Array Overflow / Denial of Wallet**: Creating a `questionPack` with 51 questions or `matchArchive` with 31 standings -> Rejected by `.size() <= 50` / `.size() <= 30`.
10. **Array Element Type Poisoning**: Creating a `questionPack` with `questions: ["raw-string-not-map"]` -> Rejected by `data.questions[0] is map`.
11. **Terminal State Tampering**: Attempting to `update` an already archived `/teachers/{uid}/matchArchives/{archiveId}` -> Rejected (`allow update: if false;`).
12. **Value Poisoning & Timestamp Forgery**: Updating `/teachers/{uid}` retention field `retentionDays` to `9999` or string `"forever"`, or forging `createdAt` -> Rejected by `isValidTeacherProfile(incoming(), teacherId)` and `request.time` check.
