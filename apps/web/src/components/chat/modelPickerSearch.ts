import { normalizeSearchQuery, scoreQueryMatch } from "@codeitlab/shared/searchRanking";

type ModelPickerSearchableModel = {
  driverKind: string;
  providerDisplayName: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  /** The provider's model id (e.g. `openrouter:anthropic/claude-opus-5.5`). */
  slug?: string;
  isFavorite?: boolean;
};

/**
 * Favorites win partial queries, but never an exact name (that is -1000) and
 * never a clearly better run: the boost is sized just above the prefix bonus a
 * shorter non-favorite name would collect.
 */
const MODEL_PICKER_FAVORITE_SCORE_BOOST = 48;
const MODEL_PICKER_EXACT_NAME_SCORE = -1000;
/**
 * Folding a query like `claude-opus-5.5` to `claude opus 5 5` catches matches
 * that literal substring search misses (and the reverse) — but a compact-only
 * hit is a weaker signal than a literal one, so it starts behind every literal
 * field.
 */
const MODEL_PICKER_COMPACT_FIELD_PENALTY = 30;
/** The whole folded query appears as one run in the model name. */
const MODEL_PICKER_CONTIGUOUS_QUERY_BOOST = 70;
/** ...and it starts the name, which is the strongest textual signal. */
const MODEL_PICKER_CONTIGUOUS_PREFIX_BOOST = 40;
/** The first token names the vendor (`anthropic`, `openai`, ...). */
const MODEL_PICKER_VENDOR_BOOST = 18;

const COMBINING_MARKS = /[\u0300-\u036f]/gu;
const NON_ALPHANUMERIC = /[^a-z0-9]+/gu;

/**
 * Lowercases, drops diacritics and turns every separator (`.`, `/`, `-`, `_`,
 * `:`, `·`, `(` …) into a single space. Model ids are punctuation soup —
 * `claude-opus-5.5`, `gpt-6.1-sol`, `qwen/qwen3.8-max-0902` — and a user typing
 * any of those with different separators expects the same result.
 */
export function foldModelPickerText(input: string): string {
  return input
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(NON_ALPHANUMERIC, " ")
    .trim();
}

function compactModelPickerText(input: string): string {
  return foldModelPickerText(input).replace(/ /gu, "");
}

/**
 * The vendor half of a model id: `openrouter:anthropic/claude-opus-5.5` →
 * `anthropic`. Gateway prefixes and provider names are dropped, so the models a
 * single gateway re-exports from dozens of vendors can be told apart in the
 * list and in search.
 */
export function modelPickerVendor(slug: string | undefined): string | undefined {
  if (!slug) {
    return undefined;
  }
  const withoutGateway = slug.includes(":") ? slug.slice(slug.indexOf(":") + 1) : slug;
  const slash = withoutGateway.indexOf("/");
  if (slash <= 0) {
    return undefined;
  }
  const vendor = withoutGateway.slice(0, slash).trim();
  return vendor.length > 0 ? vendor : undefined;
}

function normalizeModelName(name: string): string {
  return normalizeSearchQuery(name).replace(/\s+/gu, " ");
}

type ModelPickerSearchField = {
  readonly folded: string;
  readonly compact: string;
};

function makeSearchField(value: string | undefined): ModelPickerSearchField {
  const folded = value ? foldModelPickerText(value) : "";
  return { folded, compact: folded.replace(/ /gu, "") };
}

/**
 * Fields are ordered by how much a hit means: the display name first, then the
 * short name, vendor, gateway, provider, model id, and the concatenation of all
 * of them last.
 */
function getModelPickerSearchFields(
  model: ModelPickerSearchableModel,
): ReadonlyArray<ModelPickerSearchField> {
  return [
    makeSearchField(model.name),
    makeSearchField(model.shortName),
    makeSearchField(modelPickerVendor(model.slug)),
    makeSearchField(model.subProvider),
    makeSearchField(model.driverKind),
    makeSearchField(model.providerDisplayName),
    makeSearchField(model.slug),
    makeSearchField(buildModelPickerSearchText(model)),
  ];
}

function scoreModelPickerSearchToken(
  field: ModelPickerSearchField,
  token: string,
  tokenCompact: string,
  fieldBase: number,
): number | null {
  if (field.folded.length === 0) {
    return null;
  }

  const literal = scoreQueryMatch({
    value: field.folded,
    query: token,
    exactBase: fieldBase,
    prefixBase: fieldBase + 2,
    boundaryBase: fieldBase + 4,
    includesBase: fieldBase + 6,
    boundaryMarkers: [" "],
    ignorePosition: true,
    ...(token.length >= 3 ? { fuzzyBase: fieldBase + 100 } : {}),
  });
  if (literal !== null) {
    return literal;
  }

  if (tokenCompact.length < 2) {
    return null;
  }

  // `claudeopus55`, `gpt61sol`, `qwen38max` — a query typed without separators.
  return scoreQueryMatch({
    value: field.compact,
    query: tokenCompact,
    exactBase: fieldBase + MODEL_PICKER_COMPACT_FIELD_PENALTY,
    prefixBase: fieldBase + MODEL_PICKER_COMPACT_FIELD_PENALTY + 2,
    boundaryBase: fieldBase + MODEL_PICKER_COMPACT_FIELD_PENALTY + 4,
    includesBase: fieldBase + MODEL_PICKER_COMPACT_FIELD_PENALTY + 6,
    ignorePosition: true,
    ...(tokenCompact.length >= 3
      ? { fuzzyBase: fieldBase + 100 + MODEL_PICKER_COMPACT_FIELD_PENALTY }
      : {}),
  });
}

export function buildModelPickerSearchText(model: ModelPickerSearchableModel): string {
  return normalizeSearchQuery(
    [model.name, model.shortName, model.subProvider, model.driverKind, model.providerDisplayName]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" "),
  );
}

export function scoreModelPickerSearch(
  model: ModelPickerSearchableModel,
  query: string,
): number | null {
  const foldedQuery = foldModelPickerText(query);
  if (foldedQuery.length === 0) {
    return 0;
  }

  const foldedName = foldModelPickerText(model.name);
  const foldedShortName = model.shortName ? foldModelPickerText(model.shortName) : "";
  if (
    foldedQuery === foldedName ||
    (foldedShortName.length > 0 && foldedQuery === foldedShortName) ||
    normalizeModelName(query) === normalizeModelName(model.name) ||
    normalizeModelName(query) === normalizeModelName(model.shortName ?? "")
  ) {
    return MODEL_PICKER_EXACT_NAME_SCORE;
  }

  const tokens = foldedQuery.split(" ").filter((token) => token.length > 0);
  const fields = getModelPickerSearchFields(model);
  let score = 0;

  for (const token of tokens) {
    const tokenCompact = compactModelPickerText(token);
    let best: number | null = null;
    for (let index = 0; index < fields.length; index += 1) {
      const fieldScore = scoreModelPickerSearchToken(
        fields[index]!,
        token,
        tokenCompact,
        index * 10,
      );
      if (fieldScore !== null && (best === null || fieldScore < best)) {
        best = fieldScore;
      }
    }

    if (best === null) {
      return null;
    }

    score += best;
  }

  const foldedSlug = model.slug ? foldModelPickerText(model.slug) : "";
  if (foldedName.startsWith(foldedQuery)) {
    score -= MODEL_PICKER_CONTIGUOUS_QUERY_BOOST + MODEL_PICKER_CONTIGUOUS_PREFIX_BOOST;
  } else if (foldedName.includes(foldedQuery)) {
    score -= MODEL_PICKER_CONTIGUOUS_QUERY_BOOST;
  } else if (foldedSlug.startsWith(foldedQuery)) {
    score -= MODEL_PICKER_CONTIGUOUS_QUERY_BOOST;
  } else if (foldedSlug.includes(foldedQuery)) {
    score -= MODEL_PICKER_CONTIGUOUS_QUERY_BOOST - 20;
  }

  const foldedVendor = foldModelPickerText(modelPickerVendor(model.slug) ?? "");
  if (foldedVendor.length > 0 && tokens[0] === foldedVendor) {
    score -= MODEL_PICKER_VENDOR_BOOST;
  }

  return model.isFavorite ? score - MODEL_PICKER_FAVORITE_SCORE_BOOST : score;
}

export function rankModelPickerSearch<T>(
  items: ReadonlyArray<T>,
  query: string,
  toSearchable: (item: T) => ModelPickerSearchableModel,
): T[] {
  const ranked: Array<{
    item: T;
    score: number;
    isFavorite: boolean;
    order: number;
  }> = [];
  items.forEach((item, order) => {
    const searchable = toSearchable(item);
    const score = scoreModelPickerSearch(searchable, query);
    if (score !== null) {
      ranked.push({
        item,
        score,
        isFavorite: searchable.isFavorite === true,
        order,
      });
    }
  });
  return ranked
    .toSorted(
      (a, b) =>
        a.score - b.score || Number(b.isFavorite) - Number(a.isFavorite) || a.order - b.order,
    )
    .map((entry) => entry.item);
}
