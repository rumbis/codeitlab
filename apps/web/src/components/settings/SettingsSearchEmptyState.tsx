import { Button } from "../ui/button";

/**
 * The settings search empty state. UI.md asks an empty state to lead somewhere,
 * and a bare "No settings found" does not: it leaves the reader unsure whether the
 * setting exists at all or the search simply cannot reach it.
 */
export function SettingsSearchEmptyState({
  query,
  onClear,
}: {
  readonly query: string;
  readonly onClear: () => void;
}) {
  const trimmed = query.trim();
  return (
    <div role="status" className="px-2 py-4 text-center">
      <p className="text-xs text-sidebar-muted-foreground">No setting matches “{trimmed}”.</p>
      <p className="mt-1 text-2xs text-sidebar-muted-foreground/75">
        Search covers setting names, their section and common synonyms — not the text inside
        descriptions.
      </p>
      <Button className="mt-2" size="xs" type="button" variant="outline" onClick={onClear}>
        Clear search and browse the sections
      </Button>
    </div>
  );
}
