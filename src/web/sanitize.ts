import sanitizeHtml from "sanitize-html";

/**
 * Lot description HTML originates from imported/fetched third-party pages and must be treated as
 * untrusted. We only ever allow the tiny set of tags Biddr actually uses for description
 * formatting (paragraphs/line breaks/basic emphasis) - no scripts, no event handlers, no
 * arbitrary attributes, no iframes.
 */
export function sanitizeDescriptionHtml(html: string | null): string | null {
  if (!html) return null;
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "b", "strong", "i", "em", "ul", "ol", "li", "span"],
    allowedAttributes: {},
    disallowedTagsMode: "discard",
  });
}
