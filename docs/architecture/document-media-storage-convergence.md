# Document and meeting-media storage convergence

New drawing, addendum, and meeting-media writes use the repository BlobStore and these immutable key families:

- `plan-room/jobs/{bidId}/drawings/{uuid}/{safeFileName}`
- `plan-room/jobs/{bidId}/addenda/{uuid}/{safeFileName}`
- `plan-room/jobs/{bidId}/meetings/{meetingId}/{uuid}/{safeFileName}`

User filenames are display metadata only. They are reduced to a safe basename and never control bid, meeting, or immutable-id path segments. Existing `uploads/drawings/{bidId}/...`, `uploads/addendums/{bidId}/...`, `uploads/meetings/{meetingId}/...`, storage-root absolute paths, and correctly scoped pre-BlobStore cwd paths remain read-compatible. Existing records are not bulk-migrated.

## Current-path inventory

| Domain | Operation | Path | Classification after convergence |
| --- | --- | --- | --- |
| Drawing | upload / discipline replacement | `POST /api/bids/{bidId}/drawings/upload` | BlobStore canonical write; atomic record switch |
| Drawing | private read/download | `GET /api/bids/{bidId}/drawings/{uploadId}` | BlobStore canonical or scoped legacy compatibility read |
| Drawing | delete | `DELETE /api/bids/{bidId}/drawings/{uploadId}` | DB delete, then reference-checked BlobStore/legacy cleanup |
| Drawing | analysis source | `POST /api/bids/{bidId}/drawings/analyze` | canonical durable mount or scoped legacy handoff |
| Drawing | split preview | `POST /api/bids/{bidId}/drawings/split` | request-only pass-through; no stored source write |
| Addendum | upload / same-number replacement | `POST /api/bids/{bidId}/addendums/upload` | BlobStore canonical write; atomic record/brief switch |
| Addendum | private read/download | `GET /api/bids/{bidId}/addendums/{addendumId}` | BlobStore canonical or scoped legacy compatibility read |
| Addendum | delete | `DELETE /api/bids/{bidId}/addendums/{addendumId}` | DB delete, then reference-checked BlobStore/legacy cleanup |
| Addendum | delta analysis | `POST /api/bids/{bidId}/addendums/{addendumId}/delta` | extracted durable record text; source record remains bid-scoped |
| Meeting | standard audio upload/retry | `POST /api/bids/{bidId}/meetings/{meetingId}/upload` | BlobStore canonical write plus transcript-mutation ownership/CAS |
| Meeting | hybrid VTT + audio/video upload | `POST /api/bids/{bidId}/meetings/{meetingId}/upload-hybrid` | VTT in existing DB field; media in BlobStore with pointer CAS |
| Meeting | hybrid transcription source | `POST /api/bids/{bidId}/meetings/{meetingId}/source-mapping` | BlobStore canonical or scoped cwd legacy read |
| Meeting | private media download | `GET /api/bids/{bidId}/meetings/{meetingId}/download` | BlobStore canonical or scoped legacy compatibility read |
| Meeting | delete | `DELETE /api/bids/{bidId}/meetings/{meetingId}` | durable-history transaction gate, then reference-checked media cleanup |
| Meeting | transcript/analysis derivatives | status, analyze, extraction-run, minutes, register routes | existing database/audit retention; no process-local media derivative writes |

All listed routes enforce `requireBidAccess` before body parsing or storage access and scope object IDs to the bid. Download responses expose filenames and bytes, never storage keys or host paths.

## Replacement and deletion contract

Replacement bytes are written under a new UUID key before the database pointer changes. Drawing/addendum record replacement occurs in one database transaction; meeting source changes reuse the transcript mutation ownership and audit transaction. If metadata persistence fails, only the newly written blob is eligible for compensation, after a fresh durable-reference scan. Superseded blobs are retired after commit and only when no drawing, addendum, or meeting record references the same underlying object.

## Read-only acceptance verification

The verifier defaults to a dry run and does not import Prisma or BlobStore until `--execute` and all scope arguments are present:

```bash
npm run storage:verify-convergence -- --domain drawing --bid-id 1 --record-id 9
npm run storage:verify-convergence -- --execute --domain drawing --bid-id 1 --record-id 9
```

The execute form performs scoped reads only. It checks the canonical key family, BlobStore existence/stat/read, resets the process-local BlobStore singleton to simulate a fresh app process, and reads the same object again. It does not upload, delete, migrate, contact providers, or recreate a real container. To validate an actual deployment recreation, run the same execute command before and after the separately authorized recreation and compare the boolean results; this repository task does not perform that operation.
