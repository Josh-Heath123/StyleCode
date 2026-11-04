import { topLevelIds } from '../model/document';
import type { DesignDocument } from '../model/types';
import type { AiTarget } from './context';

/**
 * A few requests that fit what is selected, shown as one-click prompts under
 * the assistant's input. They are ordinary requests: the reply is still a
 * proposal to review.
 */
export function suggestionsFor(doc: DesignDocument, selection: readonly string[], target: AiTarget): string[] {
  if (target.scope.kind === 'screen') {
    const screen = doc.nodes[target.screenId];
    if (screen.children.length === 0) {
      return ['Add a hero section with a heading, a line of text and a button', 'Add a navigation bar', 'Add a sign-up form'];
    }
    const free = screen.layout === 'none' && screen.children.length > 1;
    return [
      ...(free ? ['Tidy this screen into a clean layout'] : []),
      'Make the spacing more consistent',
      'Switch to a dark theme',
      'Add a footer',
    ].slice(0, 3);
  }

  const roots = topLevelIds(doc, selection).filter((id) => target.scope.roots.includes(id));
  if (roots.length > 1) {
    return ['Make these look consistent', 'Line these up in a row with even spacing', 'Group these into a card'];
  }
  const node = doc.nodes[roots[0]];
  switch (node.type) {
    case 'text':
      return ['Make this shorter and punchier', 'Make it a bold heading', 'Rewrite it in a friendlier tone'];
    case 'image':
      return ['Round the corners and add a soft shadow', 'Add a caption below'];
    case 'rect':
    case 'ellipse':
      return ['Turn this into a button', 'Use a softer colour'];
    default:
      if (node.children.length === 0) return ['Fill this with a heading, text and a button', 'Make it a pricing card'];
      if (node.layout === 'none' && node.children.length > 1) {
        return ['Tidy this into a clean layout', 'Make it look more premium', 'Add a button'];
      }
      return ['Make it look more premium', 'Give it more breathing room', 'Add a button'];
  }
}
