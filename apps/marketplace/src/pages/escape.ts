const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Every piece of user text that reaches a page goes through this. It escapes
 * text nodes and quoted attribute values alike.
 */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/gu, (character) => HTML_ESCAPES[character] ?? character);
}
