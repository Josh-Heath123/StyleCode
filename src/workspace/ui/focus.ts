/**
 * After a list item is removed, moves keyboard focus to the item that took
 * its place (the next one, or the one before if it was last), or to the Undo
 * button when the list is empty, so focus never falls back to the page.
 * `elementId` maps an item's id to its element's id; the element needs
 * `tabIndex={-1}`.
 */
export function focusAfterRemoving(ids: readonly string[], removedId: string, elementId: (id: string) => string): void {
  const at = ids.indexOf(removedId);
  const next = ids[at + 1] ?? ids[at - 1];
  requestAnimationFrame(() => {
    const target =
      (next && document.getElementById(elementId(next))) || document.querySelector<HTMLElement>('button[aria-label^="Undo "]');
    target?.focus();
  });
}
