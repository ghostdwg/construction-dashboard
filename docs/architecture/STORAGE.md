# Storage architecture

## Layout

```
/opt/neuroglitch/storage/                ← bind-mounted docker volume
├── market/                              ← scraped meeting minutes (today)
│   └── docs/
│       └── {sourceId}/                  ← one dir per MarketSource
│           └── {YYYY}/{MM}/
│               ├── {docId}.pdf          ← original PDF as fetched
│               ├── {docId}.txt          ← extracted text (mirror of rawText)
│               └── {docId}.meta.json    ← url, fetched_at, content_type, sha256
│
├── plan-room/                           ← future: Beeline / Blue Book
│   └── jobs/
│       └── {jobId}/
│           ├── meta.json
│           ├── spec/
│           │   ├── original.pdf
│           │   ├── sections/
│           │   └── extracted.txt
│           ├── drawings/
│           │   ├── original.pdf
│           │   ├── pages/
│           │   └── thumbnails/
│           ├── addenda/
│           └── risk-report.json
│
├── meetings/                            ← WhisperX uploads + transcripts
│   └── {meetingId}/
│       ├── audio.mp3
│       ├── transcript.json
│       └── diarization.json
│
└── _trash/                              ← soft-deletes for 30 days
```

## Code

- `lib/storage/blobStore.ts` — interface + `LocalBlobStore` impl
- Future: `S3BlobStore` when single-host durability becomes a concern
- Wired via env: `STORAGE_BACKEND=local` (default), `STORAGE_LOCAL_PATH=/storage`

## Docker

- Named volume `storage` bind-mounted from host `/opt/neuroglitch/storage`
- Mounted into `app`, `sidecar`, and `worker` containers at `/storage`
- Backup: weekly cron `tar czf /backups/storage-$(date +%F).tar.gz /opt/neuroglitch/storage`

## Migration triggers

Switch to S3 / MinIO when ANY of:
- Volume hits ~50 GB
- Deploy to a second host
- Beeline ships and multi-GB plan-room downloads start arriving
