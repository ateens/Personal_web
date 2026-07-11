# Resource state migration backup and restore runbook

This runbook covers the PostgreSQL `app_state` migration backup introduced for state v4. It is an operator recovery mechanism, not an end-user export feature.

## Guarantees

- `readAppState()` locks the target `app_state` row, reconstructs the authoritative state from the relational collection tables when they exist, and detects normalization or version changes without mutating that source object.
- Before an automatic version migration or read-heal changes JSONB or relational rows, the authoritative source is inserted into `app_state_migration_backups` in the same transaction. If healing fails, both the heal and its backup roll back.
- The incremental Resource write path applies the same backup-before-migration rule when it encounters legacy state before a normal read has migrated it.
- Manual backups use the same authoritative-state reconstruction and row lock.
- Restore requires both an exact workspace confirmation and the current revision. A stale or missing revision cannot mutate state.
- Restore creates a second, automatic safety backup of the current state before replacing it, records restore history, rebuilds only the target workspace's relational rows, and advances the workspace revision by one.
- Backup state and private integration data are never printed by the CLI. `list` returns metadata only.

## Schema

`app_state_migration_backups` is append-only through the application tooling:

| Column | Purpose |
| --- | --- |
| `id` | Random backup identifier |
| `app_state_id` | Workspace scope; every create/list/restore query includes it |
| `source_revision` | Workspace revision at snapshot time |
| `source_version` | Source state version, nullable for invalid legacy roots |
| `reason` | Machine-safe reason such as `automatic_version_migration_v3_to_v4`, `manual:pre_deploy`, or `pre_restore:<id>` |
| `state` | Full authoritative JSONB snapshot; intentionally excluded from CLI output |
| `state_sha256` | Canonical JSON SHA-256 checked before restore |
| `created_at` | Snapshot time |

`app_state_restore_history` records the selected backup, the pre-restore safety backup, previous revision, new revision, and restore time. Backups do not reference `app_state` with `ON DELETE CASCADE`, so an accidental workspace-row deletion does not automatically delete recovery data. Restore-history foreign keys prevent deleting a backup that is part of a recorded restore without deliberate database maintenance.

## Prerequisites

1. Set `DATABASE_URL` for the intended database.
2. Set `APP_STATE_ID` explicitly. The CLI refuses the server's implicit `default` fallback when the variable is absent.
3. Confirm that application writes can be paused for the restore window. The CLI obtains a row lock and revision precondition, but this repository does not provide a distributed maintenance-mode switch.
4. Keep terminal logging and CI artifacts private. Metadata does not contain state, but workspace and backup identifiers are operational information.

## Create and list

Create a manual checkpoint before a deployment or maintenance operation:

```sh
APP_STATE_ID='<workspace-id>' node --env-file-if-exists=.env scripts/manage-state-backups.mjs create --reason pre_deploy
```

Manual reason labels accept 1-153 letters, numbers, dots, underscores, colons, or hyphens; storage prefixes them with `manual:`. Do not put names, tokens, URLs, or other sensitive values in a reason.

List at most 100 metadata records:

```sh
APP_STATE_ID='<workspace-id>' node --env-file-if-exists=.env scripts/manage-state-backups.mjs list --limit 20
```

The output includes backup ID, source revision/version, reason, SHA-256, creation time, and restore count. It never includes the `state` column.

## Restore

1. Stop or drain application writes.
2. Read the current revision from the authenticated `/api/state/status` endpoint or with a metadata-only SQL query:

   ```sql
   SELECT id, revision, updated_at FROM app_state WHERE id = '<workspace-id>';
   ```

3. List backups and select the intended workspace-scoped ID.
4. Run restore. The confirmation value must exactly equal `APP_STATE_ID`:

   ```sh
   APP_STATE_ID='<workspace-id>' node --env-file-if-exists=.env scripts/manage-state-backups.mjs restore '<backup-id>' --expected-revision '<current-revision>' --confirm '<workspace-id>'
   ```

5. Record the returned `restoreId`, `safetyBackupId`, and `restoredRevision` in the change log.
6. If restoring a pre-v4 state, deploy or keep the matching pre-v4 application code before resuming traffic. The current v4 server will otherwise detect that restored legacy version on its next state read, create another backup, and migrate it to v4 again.
7. Verify the authenticated state status, target collection counts, and the affected Resource behavior before resuming writes.

Restore never resets the revision to the backup's old revision. It writes the restored content at `current revision + 1`; this keeps optimistic-concurrency history monotonic and makes clients holding the prior revision fail safely.

## Failure handling

| Code | Meaning | Action |
| --- | --- | --- |
| `CONFIRMATION_REQUIRED` | `--confirm` is missing or does not exactly match `APP_STATE_ID` | Recheck the target workspace; do not bypass it |
| `STATE_PRECONDITION_REQUIRED` | `--expected-revision` is missing | Read current metadata and retry |
| `STATE_REVISION_CONFLICT` | Another write changed the workspace | Stop, inspect the new revision, and repeat the backup selection decision |
| `BACKUP_NOT_FOUND` | The ID does not belong to this workspace | Recheck database and `APP_STATE_ID` |
| `BACKUP_INTEGRITY_FAILED` | Stored state does not match its digest | Do not restore; investigate database integrity and use another verified backup |
| `BACKUP_NOT_RESTORABLE` | Snapshot root is not an object | Preserve it for forensics; choose an object-state backup |

Unknown database failures are intentionally redacted to `BACKUP_COMMAND_FAILED` by the CLI so connection details are not written to terminal logs.

## Retention and limitations

- There is no automatic retention or prune command. Backups and restore history remain until a DBA deliberately applies an approved retention policy. This prevents an unreviewed cleanup job from removing the only rollback point.
- Every backup contains a complete application-state snapshot and must receive the same access control, encryption, audit, and backup treatment as `app_state` itself.
- Backups live in the same PostgreSQL database. They protect against application migration and operator mistakes, but not loss of the database or account. Continue encrypted PostgreSQL point-in-time backup or dump procedures for disaster recovery.
- The mechanism covers `app_state` plus its relational collection representation. It does not copy, list, or restore `app_private_data`, Google credentials, proxy credentials, environment secrets, deployed assets, or external Google Calendar state.
- Restore is workspace-scoped but the application still uses a single workspace bearer policy; this tooling does not add tenant or role authorization.
- Restore trusts a snapshot previously accepted into this database and does not run current v4 validation on legacy content. The digest proves snapshot integrity, not semantic compatibility with a different code version.
- Automatic snapshots occur only when a server path is about to mutate state through migration/read-heal. A state that is never read is not proactively migrated or backed up.

## Verification

The isolated check creates random target and sentinel workspace IDs, inserts a v3 legacy state, triggers v4 migration, verifies the pre-migration backup, exercises CLI create/list/confirmation/revision conflict/restore, verifies relational recovery and restore history, proves the sentinel is unchanged, and deletes only those random IDs:

```sh
npm run check:backups
```

The check prints only its random test workspace ID. It does not print snapshots, tokens, connection strings, or sentinel values.
