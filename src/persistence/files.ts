import { FILE_EXTENSION, toProjectFile } from '../model/serialize';
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

/** Saves the document as a file. Returns false if the user cancelled the save dialog. */
export async function exportProjectFile(doc: DesignDocument): Promise<boolean> {
  const blob = new Blob([JSON.stringify(toProjectFile(doc), null, 2)], { type: 'application/json' });
  const suggestedName = fileNameFor(doc.name);
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;

  if (picker) {
    try {
      const handle = await picker({
        suggestedName,
        types: [{ description: 'StyleCode project', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return false;
      // Fall through to a regular download if the picker is unavailable here.
    }
  }

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
