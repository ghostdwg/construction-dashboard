# GroundWorX R2 Recovery Certification — Summary

Generated: 2026-07-18T20:29:11.157Z
Database type: sqlite (local disposable file via @libsql/client 'file:' backend)
Overall: **PASS** (22 PASS / 0 FAIL / 0 SKIP)

| # | Scenario | Status | Detail |
|---|----------|--------|--------|
| 1 | fresh empty database migration through full chain | PASS | applied 101 migrations |
| 2 | seeded pre-99 database upgraded through 99→100→101 | PASS | baseline rows preserved, response-package chain and migration-101 review-decision backfill verified |
| 3 | migration-order verification | PASS | 101 migrations applied in lexicographic order |
| 4 | repeated migration command is safe | PASS | second run applied 0 pending migrations, no duplicate rows |
| 5 | backup creation | PASS | backup at 2830336 bytes, schema at 20260718030000_r2b2_trade_response_reviewer_repairs |
| 6 | backup checksum | PASS | recomputed checksum matches manifest |
| 7 | restore into a second disposable database | PASS | {"status":"ok","targetDbPath":"/tmp/gwx-r2-cert-run1-chHYSy/db/restored.db","manifest":{"sourceDb":"/tmp/gwx-r2-cert-run1-chHYSy/db/upgrade.db","backupPath":"/tmp/gwx-r2-cert-run1-chHYSy/backup/full.db.bak","checksum":"066a6b9e07da34f4fbe6024b34b0d9ef1040a212f0a2ece9e681b8d7fa8b4145","byteSize":2830 |
| 8 | row-count comparison | PASS | 140 tables compared |
| 9 | foreign-key integrity | PASS | 0 violation(s) |
| 10 | immutable history preserved (AuditEvent) | PASS |  |
| 11 | audit rows preserved (register revisions + review decisions) | PASS |  |
| 12 | Meeting/Register/TrackedItem provenance preserved | PASS |  |
| 13 | response-package relationships preserved where present | PASS | full chain rows: source=1 restored=1 |
| 14 | attachment/storage references preserved | PASS |  |
| 15 | BackgroundJob state preserved | PASS |  |
| 16 | restoration from a corrupted backup is refused | PASS | {"status":"refused","reason":"checksum-mismatch","detail":"manifest expects 066a6b9e07da34f4fbe6024b34b0d9ef1040a212f0a2ece9e681b8d7fa8b4145, backup file is 09f506c69af81b4b551783169e1b20436f0d773dd19 |
| 17 | restoration from the wrong schema version is refused or clearly gated | PASS | {"status":"refused","reason":"schema-version-mismatch","detail":"expected schema at 20260718030000_r2b2_trade_response_reviewer_repairs, backup is at 20260717120000_r2b1_register_rerun_supersession"} |
| 18 | interrupted migration state is detected | PASS | {"blocked":{"status":"blocked-partial","partial":["20260718010000_r2b2_trade_response_packages"],"appliedCount":99,"totalOnDisk":101},"partial":["20260718010000_r2b2_trade_response_packages"]} |
| 19 | partial restore is detected | PASS | {"preCheck":{"ok":true},"postCheck":{"ok":false,"reason":"checksum mismatch: expected 066a6b9e07da34f4fbe6024b34b0d9ef1040a212f0a2ece9e681b8d7fa8b4145, got 14dde6a5442bb66e18caa89ccfd14bb59e5f0a672aeaa541e7b2fd9713eb2d9d"}} |
| 20 | missing migration is detected | PASS | {"missing":["20260416214317_submittal_distribution_template"]} |
| 21 | unknown future migration is detected | PASS | {"unknown":["99999999999999_unknown_future_migration"]} |
| 22 | two complete runs produce deterministic normalized evidence | PASS | run1 and run2 normalized evidence are identical |

## Normalization exclusions (fields never compared for cross-run determinism)

- generatedAt — wall-clock timestamp of the report itself
- evidence.*.startedAt / finishedAt — real migration-apply wall-clock time
- evidence.*.rawBackupChecksum — backup file bytes include _prisma_migrations wall-clock columns
- evidence.*.*Path — disposable os.tmpdir() run-specific paths
