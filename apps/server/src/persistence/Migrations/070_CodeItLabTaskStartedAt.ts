import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // When the current run started. Auto-review compares the run completion with
  // this instead of updated_at, so editing notes after a finished run no longer
  // blocks the move to Review. Existing rows keep an empty value and fall back
  // to updated_at.
  yield* sql`
    ALTER TABLE codeitlab_tasks
    ADD COLUMN started_at TEXT NOT NULL DEFAULT ''
  `;
});
