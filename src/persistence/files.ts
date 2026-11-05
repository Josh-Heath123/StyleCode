import { FILE_EXTENSION, toProjectFile, type ProjectFile } from '../model/serialize';
import type { DesignDocument } from '../model/types';

/** Saving and opening project files on the user's disk. */

type SaveFilePicker = (options: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;

function fileNameFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'untitled'}${FILE_EXTENSION}`;
}

/**
 * Saves the document as a file. The save dialog opens straight away (browsers
 * only allow it right after a click); embedded images are gathered after.
 * Returns false if the user cancelled the dialog.
 */
export function exportProjectFile(
  doc: DesignDocument,
  gatherAssets: () => Promise<ProjectFile['assets']> = async () => undefined,
): Promise<boolean> {
  return saveFile(
    fileNameFor(doc.name),
    { description: 'StyleCode design', mime: 'application/json', extension: '.json' },
    async () => new Blob([JSON.stringify(toProjectFile(doc, await gatherAssets()), null, 2)], { type: 'application/json' }),
  );
}

/**
 * Saves a file the user names, with the system save dialog where the browser
 * has one and a download otherwise. The dialog opens before `build` runs,
 * because browsers only allow it straight after a click. Returns false if the
 * user cancelled.
 */
export async function saveFile(
  suggestedName: string,
  kind: { description: string; mime: string; extension: string },
  build: () => Promise<Blob>,
): Promise<boolean> {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;

  if (picker) {
    let handle: Awaited<ReturnType<SaveFilePicker>> | null = null;
    try {
      handle = await picker({
        suggestedName,
        types: [{ description: kind.description, accept: { [kind.mime]: [kind.extension] } }],
      });
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return false;
      // Fall through to a regular download if the picker is unavailable here.
    }
    if (handle) {
      const writable = await handle.createWritable();
      await writable.write(await build());
      await writable.close();
      return true;
    }
  }

  const blob = await build();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Lets the user pick a project file and returns its parsed JSON, or null if cancelled. */
export function pickProjectFile(): Promise<{ name: string; data: unknown } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const text = await file.text();
        resolve({ name: file.name, data: JSON.parse(text) });
      } catch {
        reject(new Error(`${file.name} is not valid JSON.`));
      }
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
