/**
 * Saves a file the app made (an export) through a download, the way stored
 * files are saved: it never opens inside StyleCode.
 */
export function saveAs(name: string, contents: Blob): void {
  const url = URL.createObjectURL(contents);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
