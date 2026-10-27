import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Kanban tasks as rows rather than one settings blob, so several devices can
  // read the same board and an update cannot overwrite a concurrent one. The
  // workflow label is "board_column" because "column" is reserved in SQL.
  yield* sql`
    CREATE TABLE IF NOT EXISTS codeitlab_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      board_column TEXT NOT NULL DEFAULT 'pending',
      thread_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      archived_at TEXT NOT NULL DEFAULT ''
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_codeitlab_tasks_column
    ON codeitlab_tasks(board_column, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_codeitlab_tasks_archived
    ON codeitlab_tasks(archived_at)
  `;
});
