# Security Specification — EDU RUN ARENA 3D (Serverless Vercel + Firebase Firestore)

## 1. Data Invariants & Master Source of Truth
1. **Master Source of Truth**: `/teachers/{teacherId}` is the root owner document keyed by Firebase Auth UID (`teacherId == request.auth.uid` for teacher self-access).
2. **Verified Admin RBAC**:
   - **Bootstrap Admin**: Verified Google account `sipmadeveloper@gmail.com` (`request.auth.token.email_verified == true && request.auth.token.email == 'sipmadeveloper@gmail.com'`).
   - **Delegated Admin Registry**: `/admins/{adminId}` — strictly writable/deletable ONLY by the verified Bootstrap Admin.
3. **Master Gate**:
   - Subcollections `/teachers/{teacherId}/questionPacks/{packId}` and `/teachers/{teacherId}/matchArchives/{archiveId}` require `/teachers/{teacherId}` to exist.
   - `/rooms/{roomCode}` creation requires `teacherProfileExists(request.auth.uid)`.
   - `/rooms/{roomCode}/participants/{participantId}` read/write requires `roomExists(roomCode)` and rejects new joins/edits once `status == 'finished'`.
4. **PII Isolation**: `/teachers/{teacherId}` contains `email`. `/rooms/{roomCode}` and `/participants/{participantId}` contain ZERO PII (no email, phone, or password).
5. **Serverless Live Rooms**:
   - Students look up `/rooms/{roomCode}` only via exact 6-char uppercase code (`allow get: if isValidRoomCode(roomCode)`). `allow list` on `/rooms` is strictly restricted to the owning verified teacher (`resource.data.ownerId == request.auth.uid`) or verified bootstrap admin.
   - Participants join and update their race checkpoints inside `/rooms/{roomCode}/participants/{participantId}` with immutable `id`, `roomCode`, `lane`, `reconnectToken`, and `createdAt`, bounded arrays (`answers.size() <= 50`), and terminal locking once room `status == 'finished'`.
6. **Spark Free Tier Volumetric Guards**:
   - Every string field enforces strict `.size()` upper bounds matching `firebase-blueprint.json`.
   - `questionPacks` <= 50 questions/doc; `matchArchives.standings` <= 30; `rooms.questions` <= 50; `participants.answers` <= 50.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Shadow Field Injection (Teacher Profile / Live Room / Participant)**: Creating any document with undeclared fields -> Rejected by `keys().hasOnly(...)`.
2. **Identity Spoofing (Room Ownership)**: Creating `/rooms/ABC123` with `ownerId: "victim-uid"` -> Rejected by `incoming().ownerId == request.auth.uid`.
3. **Admin Email Spoofing (Unverified Email)**: Calling admin operations with `email_verified: false` -> Rejected by `isVerifiedUser()`.
4. **Self-Assigned Admin Privilege Escalation**: Regular teacher trying to create `/admins/{myUid}` -> Rejected by `isBootstrapAdmin()`.
5. **Unauthenticated Room Scraping**: Calling `list(/rooms)` without verified teacher ownership -> Rejected by `resource.data.ownerId == request.auth.uid`.
6. **Cross-Teacher Room Tampering / Deletion**: Another teacher trying to start, close, or delete another teacher's room -> Rejected by `existing().ownerId == request.auth.uid || isAdmin()`.
7. **ID & Room Code Poisoning**: Using invalid room code (`abc` or `../../evil`) or malformed doc ID -> Rejected by `isValidRoomCode` / `isValidId`.
8. **Orphaned Subcollection Write**: Creating `questionPack` without `/teachers/{uid}` or `participant` without `/rooms/{roomCode}` -> Rejected by `teacherProfileExists` / `roomExists`.
9. **Array Overflow / Denial of Wallet**: Creating a room with 51 questions or participant with 51 answers -> Rejected by `.size() <= 50`.
10. **Array Element Type Poisoning**: Putting non-map elements into `questions`, `standings`, `slides`, or `answers` -> Rejected by `[0] is map`.
11. **Terminal State Tampering**: Editing a `finished` room, joining a `finished` room, or editing an `archived` match -> Rejected by `existing().status != 'finished'` and `allow update: if false`.
12. **Score / ReconnectToken / Timestamp Forgery**: Creating a participant with initial `score: 100` or mutating `reconnectToken`/`lane`/`createdAt` -> Rejected by create zero-state checks, immutability checks, and `request.time`.
