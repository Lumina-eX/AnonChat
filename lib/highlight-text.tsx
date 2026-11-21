import React from "react";

/**
 * Splits `text` into segments and wraps each segment that matches `query`
 * in a <mark> element for visual highlighting.
 *
 * Returns the original text as a plain string when query is empty/blank,
 * so callers can short-circuit rendering if needed.
 */
export function highlightText(
  text: string,
  query: string,
): React.ReactNode {
  if (!query.trim()) return text;

  // Escape special regex characters in the query so user input is treated literally
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);

  if (parts.length === 1) return text;

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="bg-yellow-300/80 text-yellow-900 dark:bg-yellow-400/40 dark:text-yellow-100 rounded-sm px-0.5"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
