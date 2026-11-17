/**
 * An engagement's designs (MVP story 9.1; ADR-0007; Phase 4 brief, decisions 1
 * to 6). A design is a StyleCode document stored in the company's folder
 * (`designs/<document id>.stylecode.json`); the workspace keeps a link to it,
 * its name, and when it was attached. Pure: each function returns a new
 * workspace or the reason it refuses.
 */
import type { CompanyWorkspace, DesignLink, Timestamp } from './types.ts';
import { fail, get, isId, ok, type Result } from './util.ts';

/** The longest design name, as the editor allows. */
export const MAX_DESIGN_NAME = 200;

function checkName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_DESIGN_NAME);
}

/** An engagement's designs, oldest first. */
export function designsOf(ws: CompanyWorkspace, engagementId: string): DesignLink[] {
  return Object.values(ws.designs)
    .filter((d) => d.engagementId === engagementId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
}

/** The design linked to a document, if the workspace lists one. */
export function designOfDocument(ws: CompanyWorkspace, documentId: string): DesignLink | undefined {
  return Object.values(ws.designs).find((d) => d.documentId === documentId);
}

/**
 * Attaches a design whose file is already in the company's folder: a new one
 * (decision 1) or a copy of one of the editor's own (decision 3). Either way
 * the document has an id of its own, never linked twice.
 */
export function attachDesign(
  ws: CompanyWorkspace,
  design: { id: string; engagementId: string; name: string; documentId: string },
  at: Timestamp,
): Result<CompanyWorkspace> {
  if (!isId(design.id) || get(ws.designs, design.id)) return fail('A design with this id exists already.');
  if (!get(ws.engagements, design.engagementId)) return fail('The engagement does not exist.');
  if (!isId(design.documentId)) return fail('The design has an invalid document id.');
  if (designOfDocument(ws, design.documentId)) return fail('This design is attached already.');
  const name = checkName(design.name);
  if (!name) return fail('A design needs a name.');
  const link: DesignLink = {
    id: design.id,
    engagementId: design.engagementId,
    name,
    documentId: design.documentId,
    createdAt: at,
  };
  return ok({ ...ws, designs: { ...ws.designs, [design.id]: link } });
}

/** Renames a design; the editor renames its document to match (decision 5). */
export function renameDesign(ws: CompanyWorkspace, designId: string, name: string): Result<CompanyWorkspace> {
  const design = get(ws.designs, designId);
  if (!design) return fail('The design does not exist.');
  const trimmed = checkName(name);
  if (!trimmed) return fail('A design needs a name.');
  if (trimmed === design.name) return fail('Nothing was changed.');
  return ok({ ...ws, designs: { ...ws.designs, [designId]: { ...design, name: trimmed } } });
}

/**
 * Removes a design (decision 6). Saved as a permanent step: the server then
 * deletes its file, and the images no other design of the client uses.
 */
export function removeDesign(ws: CompanyWorkspace, designId: string): Result<CompanyWorkspace> {
  if (!get(ws.designs, designId)) return fail('The design does not exist.');
  const designs = { ...ws.designs };
  delete designs[designId];
  return ok({ ...ws, designs });
}
