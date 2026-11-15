# File version history: design note (phase C9)

## How saving works today

Every write to a code file's text goes through one function:
`save_file(file_id, text, state)` in `backend/app/routers/collab.py`. It writes the
file's Yjs document (`code_file_yjs.state`) and its text (`code_files.content`) in one
transaction, so the two never disagree.

`save_file` is only ever called by `CollabManager.flush(room)`
(`backend/app/services/collab.py`), and `flush` runs under the room's `save_lock`.
That lock is the save-race fix from C2: one save at a time per file, and a flush
waits for a save already in progress (`test_leaving_waits_for_a_save_already_in_progress`
and `test_shutdown_waits_for_a_save_already_in_progress`).

Every way of changing a file ends in a flush:

| Path | Trigger | Ends in |
| --- | --- | --- |
| Live editing (WebSocket) | 2 s after the last change; when the last person leaves; on shutdown | `flush` |
| REST save `PUT /code-files/{id}` (no live editing) | the editor's autosave | `replace_text` edits the live document, broadcasts the change, then calls `flush` |
| Legacy single-file save | the old API | `replace_text`, then `flush` |
| Creating a file | `POST /projects/{id}/code/files` | inserts the row directly (no document yet) |
| ZIP import | `POST /projects/{id}/code/import` | inserts rows directly, in one transaction |

## Where snapshots are taken

**Inside `save_file`, from the exact text it has just committed.** Nothing comes from
the client. A snapshot is a row in `code_file_versions`. Its fields are `file_id`,
`project_id`, `content`, `content_hash` (SHA-256), `author_user_id`, `created_at`,
`label` and `source`.

`flush` passes `save_file` a small `snapshot` request:

| Source | When | Throttled? |
| --- | --- | --- |
| `save` | after a REST save (`PUT`), with the saving user as author | yes |
| `autosnapshot` | after a live-editing save, with the last person who edited as author | yes |
| `restore` | after a restore, with the restoring user as author and a label | never: always written |
| `import` | each file created by a ZIP import, inside the import's own transaction | new files, so no earlier version |

**Throttle.** For `save` and `autosnapshot`, a snapshot is skipped when either:

- the file's newest version is under 60 s old (`SNAPSHOT_EVERY_SECONDS`), or
- its content hash equals the newest version's hash (no duplicates).

One exception keeps the history complete. When the last person leaves a room, and
on shutdown, the flush is marked *final*. A final flush ignores the 60 s window, but
never the hash check. So the state people left the file in is always kept.

**Retention.** After inserting, the oldest versions beyond
`MAX_VERSIONS_PER_FILE = 50` are deleted in the same transaction.

**Size.** A snapshot holds at most `MAX_CODE_FILE_CHARS` (1,000,000) characters, the
same limit as a file. Larger text can't be saved anyway; if it ever reaches here, it
is skipped and logged.

## Why this is race-safe

1. **One writer per file.** Snapshots are taken inside `save_file`, which only runs
   under the room's `save_lock`. Two saves of the same file can't interleave in this
   process, which is the only process (the app runs as one instance; see
   ARCHITECTURE-NOTES). The throttle's "newest version" check and the insert happen
   inside that lock.
2. **The snapshot is the committed text.** The content snapshotted is the `text`
   argument that was just written to `code_files.content`. It is never re-read from
   the client or from another request.
3. **Postgres row lock.** The snapshot transaction also locks the file's
   `code_files` row (`SELECT … FOR UPDATE`, a no-op on SQLite). If the app ever ran
   several workers, their snapshots for the same file would still queue, not
   interleave.
4. **A snapshot never breaks a save.** For `save` and `autosnapshot`, the text and
   document are committed first. The snapshot is then written in its own
   transaction, and any error there is logged and swallowed. The save has already
   succeeded and is never rolled back.

## Restore

`POST /code-files/{id}/versions/{version_id}/restore` (owner or editor, rate
limited):

1. **Load the version.** It is looked up by its id **and** the file's id and project
   (from the role check on the file). A version of another file or project is a 404.
2. **Edit the live document.** `collab.replace_text(file_id, content, snapshot=…)`
   changes the file's live Yjs document. It edits only the part that differs, in one
   Yjs transaction, and broadcasts the update to everyone connected. Their editors
   apply it like any other collaborator's edit, so the restored text appears at once.
   Because it is a CRDT operation on the shared document, and not a reload, no
   browser can "write the old text back": an editor holding unsaved keystrokes merges
   them on top of the restored text.
3. **Save it atomically.** The same `flush` → `save_file` path writes the text, the
   document and the `restore` version **in one transaction**, so a restore either
   fully happens or doesn't happen at all.
4. **Log it.** An activity entry, `code_restored`, is recorded.

Restoring never deletes history: it adds a new version.

## Reading history

All endpoints check `require_project_role` on the **file**, which loads it and
checks membership in its project (non-members get 404). Every version query is then
filtered by both `file_id` **and** `project_id`, so another project's content can't
be read by guessing ids.

| Endpoint | Who |
| --- | --- |
| `GET /code-files/{id}/versions?limit=&offset=` | any member; newest first, no content |
| `GET /code-files/{id}/versions/{version_id}` | any member; includes content |
| `PATCH /code-files/{id}/versions/{version_id}` `{label}` | owner or editor |
| `POST /code-files/{id}/versions/{version_id}/restore` | owner or editor |

## Deleting

`code_file_versions.file_id` has `ON DELETE CASCADE`, so deleting a file, a folder
or a project deletes its versions. `author_user_id` is `ON DELETE SET NULL`, so a
deleted account's versions stay, without an author.

## Migration

`0016_code_file_versions` only adds a table. It has indexes on
`(file_id, created_at)` and `project_id`, and a check constraint on `source`.
Downgrade drops the table. Like every new table, it is created with RLS **off**:
turn it on in Supabase (see DEPLOY.md, step 8).
