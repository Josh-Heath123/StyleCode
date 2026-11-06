import { describe, expect, it } from 'vitest';
import { addFileRef, filesOf, formatSize, removeFileRef } from './files';
import { sampleWorkspace } from './fixtures';
import type { CompanyWorkspace } from './types';
import { validateWorkspace } from './validate';

const AT = '2026-11-06T10:00:00.000Z';
const codes = (ws: CompanyWorkspace) => validateWorkspace(ws).map((p) => p.code);
function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('documents on a company or an engagement (MVP Q2)', () => {
  it('lists a file with who added it and when, valid, and lists each owner’s own files', () => {
    let ws = value(
      addFileRef(
        sampleWorkspace(),
        { id: 'fi_brief', owner: { kind: 'company' }, name: ' Brief.pdf ', mediaType: 'application/pdf', sizeBytes: 3400 },
        'Sam',
        AT,
      ),
    );
    ws = value(
      addFileRef(
        ws,
        { id: 'fi_menu', owner: { kind: 'engagement', engagementId: 'en_1' }, name: 'Menu.docx', mediaType: '', sizeBytes: 900 },
        'Sam',
        AT,
      ),
    );
    expect(ws.files.fi_brief).toMatchObject({ name: 'Brief.pdf', purpose: 'document', addedBy: 'Sam', addedAt: AT });
    expect(ws.files.fi_menu.mediaType).toBe('application/octet-stream');
    expect(codes(ws)).toEqual([]);
    expect(filesOf(ws, { kind: 'company' }).map((f) => f.id)).toEqual(['fi_brief']);
    expect(filesOf(ws, { kind: 'engagement', engagementId: 'en_1' }).map((f) => f.id)).toEqual(['fi_menu']);
  });

  it('refuses a used id, an empty name, and a missing engagement', () => {
    const ws = value(
      addFileRef(
        sampleWorkspace(),
        { id: 'fi_a', owner: { kind: 'company' }, name: 'A.txt', mediaType: 'text/plain', sizeBytes: 1 },
        'Sam',
        AT,
      ),
    );
    expect(
      addFileRef(ws, { id: 'fi_a', owner: { kind: 'company' }, name: 'B.txt', mediaType: 'text/plain', sizeBytes: 1 }, 'Sam', AT)
        .ok,
    ).toBe(false);
    expect(
      addFileRef(ws, { id: 'fi_b', owner: { kind: 'company' }, name: ' ', mediaType: 'text/plain', sizeBytes: 1 }, 'Sam', AT).ok,
    ).toBe(false);
    expect(
      addFileRef(
        ws,
        { id: 'fi_c', owner: { kind: 'engagement', engagementId: 'en_none' }, name: 'C', mediaType: '', sizeBytes: 1 },
        'Sam',
        AT,
      ).ok,
    ).toBe(false);
  });

  it('removes a file, but not one a consent record keeps as its attachment', () => {
    const ws = value(
      addFileRef(
        sampleWorkspace(),
        { id: 'fi_a', owner: { kind: 'company' }, name: 'A.txt', mediaType: 'text/plain', sizeBytes: 1 },
        'Sam',
        AT,
      ),
    );
    expect(value(removeFileRef(ws, 'fi_a')).files).toEqual({});
    ws.files.fi_form = {
      ...ws.files.fi_a,
      id: 'fi_form',
      owner: { kind: 'session', sessionId: 'se_1' },
      purpose: 'consent-attachment',
    };
    ws.consents.cr_1.attachmentFileId = 'fi_form';
    expect(removeFileRef(ws, 'fi_form').ok).toBe(false);
  });

  it('says sizes as people read them', () => {
    expect([1, 820, 14 * 1024, 3.24 * 1024 * 1024, 48 * 1024 * 1024].map(formatSize)).toEqual([
      '1 byte',
      '820 bytes',
      '14 KB',
      '3.2 MB',
      '48 MB',
    ]);
  });
});
