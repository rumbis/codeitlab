import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { CilProjectFile, CIL_PROJECT_FILE_SCHEMA_URL } from "@codeitlab/contracts";

import { fromLenientJson } from "./schemaJson.ts";

export const CilProjectFileFromJson = fromLenientJson(CilProjectFile);

const decodeCilProjectFile = Schema.decodeExit(CilProjectFileFromJson);

export function parseCilProjectFile(contents: string): CilProjectFile | null {
  const decoded = decodeCilProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

export function buildCilProjectFileJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(CilProjectFile, { onExcessProperty: "error" });
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: CIL_PROJECT_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
