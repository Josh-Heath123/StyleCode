/**
 * Reads one file from a zip archive, such as `word/document.xml` from a
 * `.docx`, with no dependency (Phase 2 brief, decision 5): the archive's
 * central directory gives each entry's place, and `DecompressionStream`
 * ('deflate-raw'), built into browsers and Node, inflates it.
 */

/** Why an archive can't be read. */
export class ZipError extends Error {}

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/** The bytes of the named entry, or null if the archive has no such entry. Throws `ZipError` if it isn't a zip. */
export async function readZipEntry(bytes: Uint8Array, name: string, maxBytes = MAX_INFLATED_BYTES): Promise<Uint8Array | null> {
  // The end-of-central-directory record sits in the last 22 bytes plus up to 64 KB of comment.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError('not a zip archive');
  const count = u16(bytes, end + 10);
  let at = u32(bytes, end + 16);
  const wanted = new TextEncoder().encode(name);
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || u32(bytes, at) !== 0x02014b50) throw new ZipError('damaged zip directory');
    const method = u16(bytes, at + 10);
    const compressedSize = u32(bytes, at + 20);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    const localAt = u32(bytes, at + 42);
    const entryName = bytes.subarray(at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (entryName.length !== wanted.length || entryName.some((b, i) => b !== wanted[i])) continue;

    if (localAt + 30 > bytes.length || u32(bytes, localAt) !== 0x04034b50) throw new ZipError('damaged zip entry');
    const start = localAt + 30 + u16(bytes, localAt + 26) + u16(bytes, localAt + 28);
    const data = bytes.subarray(start, start + compressedSize);
    if (data.length !== compressedSize) throw new ZipError('truncated zip entry');
    if (method === 0) return data;
    if (method !== 8) throw new ZipError(`unsupported compression (${method})`);
    return inflate(data, maxBytes);
  }
  return null;
}

/** The most an entry may inflate to: far more than any transcript, far less than a zip bomb (review of Slice A). */
export const MAX_INFLATED_BYTES = 200 * 1024 * 1024;

async function inflate(data: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ZipError('the document is too large once unpacked');
      }
      chunks.push(value);
    }
  } catch (e) {
    throw e instanceof ZipError ? e : new ZipError('damaged compressed data');
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
