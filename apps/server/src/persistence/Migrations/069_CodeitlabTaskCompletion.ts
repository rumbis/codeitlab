import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // The day a task was finished, kept apart from updated_at so editing notes on
  // a completed task does not move its streak day or restart its archive clock.
  // Existing rows keep an empty value and fall back to updated_at.
  yield* sql`
    ALTER TABLE codeitlab_tasks
    ADD COLUMN completed_at TEXT NOT NULL DEFAULT ''
  `;
});
