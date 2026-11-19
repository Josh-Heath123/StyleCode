/**
 * The hygiene rules (repository brief, R3): what may never be committed to StyleCode. Pure functions over a file's
 * path and bytes, a workflow's text, a commit's details and package.json, so the tests can give them bad examples.
 * `scripts/check-hygiene.ts` runs them over the repository and over everything a pull request's commits add, and
 * `scripts/check-new-dependencies.ts` runs the dependency rule (R4).
 */

/** Just above the largest tracked file when the check was written (docs/media/sketch-to-code.gif, 3,394,699 bytes). */
export const SIZE_LIMIT = 3_500_000;

/** Files allowed over the size limit, by path. None today. */
export const SIZE_EXCEPTIONS: readonly string[] = [];

/**
 * Third-party licence texts, by path, which may hold their authors' email addresses. Nothing else is excepted from
 * the email rule. None today: no licence text in the repository holds an address.
 */
export const LICENCE_TEXT_EXCEPTIONS: readonly string[] = [];

const AUDIO = 'wav|mp3|m4a|m4b|aac|ogg|oga|opus|flac|wma|aif|aiff|aifc|amr|3gp|3g2|caf|mka|weba|wv|ape|au|snd|pcm|raw|ac3|dts';
const VIDEO = 'webm|mp4|m4v|mov|avi|mkv|wmv|flv|mpg|mpeg|ogv|mts|m2ts|asf|rm|rmvb|vob|divx';
const ARCHIVE =
  'zip|zipx|tar|gz|tgz|bz|bz2|tbz|tbz2|xz|txz|z|7z|rar|zst|lz|lz4|lzma|br|cab|iso|dmg|jar|war|apk|whl|deb|rpm|msi|cpio|nupkg|crx';
const AUDIO_VIDEO_ARCHIVE = new RegExp(`\\.(${AUDIO}|${VIDEO}|${ARCHIVE})$`, 'i');
/** Office documents are zip files inside; the samples in docs/phase-2/samples are .docx. */
const OFFICE = /\.(docx|xlsx|pptx|odt|ods|odp)$/i;

/** `.env`, `.env.local`, `prod.env`, `.envrc`, in any case; `.env.example`, a template without values, is allowed. */
const ENV_FILE = [/(^|\/)\.env([-_.][^/]*)?$/i, /[^/]\.env$/i, /(^|\/)\.envrc$/i];
const ENV_TEMPLATE = /(^|\/)\.env\.example$/i;

/**
 * A user's folder, in any letter case: `X:\Users\<name>` (or with forward slashes), `/Users/<name>`, `/home/<name>`,
 * Git Bash's `/c/Users/<name>` and WSL's `/mnt/c/Users/<name>`, with a real name in place of `<name>`. A placeholder
 * such as `<you>`, or the brief's `…`, isn't a name, so it passes.
 */
const USER_PATHS = [
  /\b[a-z]:(?:\\\\|\\|\/)users(?:\\\\|\\|\/)[a-z0-9._-]/gi,
  /(?<![a-z0-9._~-])(?<!(?:^|[^a-z0-9/])[a-z]:)\/(?:mnt\/[a-z]\/|[a-z]\/)?(?:users|home)\/[a-z0-9._-]/gi,
];

// An address, with its @ written out or as %40. Anchored at the start of a word, so a long run of letters is scanned
// once, not once from every position.
const EMAIL = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+(?:@|%40)[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
/** In a binary file's bytes, letters outside ASCII are noise, so only an ASCII address counts there. */
const ASCII_EMAIL =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9])/g;

/**
 * An address at a domain reserved for examples, which can't reach anyone: example.com, example.net and example.org
 * and their subdomains (RFC 2606), and names ending in .example, .test, .invalid or .localhost (RFC 2606, RFC 6761).
 * A lookalike such as example.com.evil.net or myexample.com isn't one.
 */
export function isReservedExample(address: string): boolean {
  const domain = soleDomain(address)?.toLowerCase() ?? '';
  return /(^|\.)example\.(com|net|org)$/.test(domain) || /\.(example|test|invalid|localhost)$/.test(domain);
}

/** The address carries on past what the pattern matched (a domain of example.com_evil.net), so its domain is longer. */
const CONTINUES = /^(?:[\p{L}\p{N}_-]|\.[\p{L}\p{N}])/u;

/** Every %40 written out as @. */
const decoded = (address: string) => address.replace(/%40/gi, '@');

/** The domain of an address with exactly one @ (written out or as %40). An address that holds two has none. */
function soleDomain(address: string): string | null {
  const parts = decoded(address).split('@');
  return parts.length === 2 ? parts[1] : null;
}

/**
 * GitHub's own noreply addresses: a user's (`123+name@users.noreply.github.com`), an app's bot, such as Dependabot
 * (`49699333+dependabot[bot]@users.noreply.github.com`), and GitHub's (`noreply@github.com`).
 */
export function isNoreply(address: string): boolean {
  const a = decoded(address);
  return (
    /^(\d+\+)?[A-Za-z0-9-]+@users\.noreply\.github\.com$/i.test(a) ||
    /^\d+\+[A-Za-z0-9-]+\[bot\]@users\.noreply\.github\.com$/i.test(a) ||
    /^noreply@github\.com$/i.test(a)
  );
}

/**
 * The sign-off Dependabot ends its commit messages with. GitHub's support address passes on this exact line of a
 * commit message, and nowhere else.
 */
const DEPENDABOT_SIGN_OFF = /^Signed-off-by: dependabot\[bot\] <support@github\.com>$/gm;

const SECRETS: [string, RegExp][] = [
  ['an API key (sk-…)', /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{32,}/],
  ['a GitHub token (ghp_, gho_, ghs_, ghu_, ghr_…)', /(?<![A-Za-z0-9])gh[opsur]_[A-Za-z0-9]{36}/],
  ['a GitHub token (github_pat_…)', /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{50,}/],
  ['an AWS access key (AKIA…, ASIA…)', /(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])/],
  ['a private key', /-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY( BLOCK)?-----/],
  ['a PuTTY private key', /PuTTY-User-Key-File-\d/],
];

/** What's wrong with a file, judged by its path and size alone. */
export function pathProblems(path: string, size: number): string[] {
  const problems: string[] = [];
  if (AUDIO_VIDEO_ARCHIVE.test(path)) problems.push('audio, video and archive files are never committed');
  if (ENV_FILE.some((p) => p.test(path)) && !ENV_TEMPLATE.test(path)) problems.push('.env files are never committed');
  if (size > SIZE_LIMIT && !SIZE_EXCEPTIONS.includes(path))
    problems.push(`${size.toLocaleString('en')} bytes, over the limit of ${SIZE_LIMIT.toLocaleString('en')}`);
  return problems;
}

const startsWith = (b: Uint8Array, bytes: number[], at = 0) => bytes.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Audio, video or an archive, known by its first bytes whatever its name says. */
export function mediaOrArchive(path: string, b: Uint8Array): string | null {
  if (startsWith(b, ascii('RIFF')) && (startsWith(b, ascii('WAVE'), 8) || startsWith(b, ascii('AVI '), 8)))
    return 'RIFF audio or video';
  if (startsWith(b, ascii('ID3')) || startsWith(b, ascii('fLaC')) || startsWith(b, ascii('OggS'))) return 'audio';
  if (startsWith(b, ascii('#!AMR')) || startsWith(b, ascii('caff'))) return 'audio';
  // MP4, MOV, M4A, 3GP; HEIF and AVIF images share the box, so their brands are allowed.
  if (startsWith(b, ascii('ftyp'), 4) && !/^(avif|avis|heic|heix|mif1|msf1)$/.test(String.fromCharCode(...b.subarray(8, 12))))
    return 'audio or video (MP4 family)';
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return 'audio or video (Matroska or WebM)';
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) && !OFFICE.test(path)) return 'a zip archive';
  if (startsWith(b, [0x1f, 0x8b])) return 'a gzip archive';
  if (startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return 'a 7-Zip archive';
  if (startsWith(b, ascii('Rar!'))) return 'a RAR archive';
  if (startsWith(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return 'an xz archive';
  if (startsWith(b, [0x28, 0xb5, 0x2f, 0xfd])) return 'a Zstandard archive';
  if (startsWith(b, ascii('BZh')) && b[3] >= 0x31 && b[3] <= 0x39 && startsWith(b, ascii('1AY&SY'), 4)) return 'a bzip2 archive';
  return null;
}

/** User folders and email addresses in text: a file's or a commit message's. Noreply and example addresses pass. */
export function personalProblems(text: string, { emailsAllowed = false, binary = false } = {}): string[] {
  const problems: string[] = [];
  for (const pattern of USER_PATHS)
    for (const m of text.matchAll(pattern)) problems.push(`a user’s folder, line ${lineOf(text, m.index)}`);
  if (!emailsAllowed)
    for (const m of text.matchAll(binary ? ASCII_EMAIL : EMAIL))
      if (!isNoreply(m[0]) && !(isReservedExample(m[0]) && !CONTINUES.test(text.slice(m.index + m[0].length))))
        problems.push(`an email address (${mask(m[0])}), line ${lineOf(text, m.index)}`);
  return problems;
}

/** Likely secrets in text. */
export function secretProblems(text: string): string[] {
  return SECRETS.filter(([, pattern]) => pattern.test(text)).map(([what]) => `likely ${what}`);
}

/** Everything wrong with a text file's contents. */
export function textProblems(path: string, text: string): string[] {
  return [
    ...personalProblems(text, { emailsAllowed: LICENCE_TEXT_EXCEPTIONS.includes(path) }),
    ...secretProblems(text),
    ...(isWorkflow(path) ? workflowProblems(text) : []),
  ];
}

/**
 * Everything wrong with a file: its path, size and first bytes, and what it says. A binary file (an image, say) is
 * read as Latin-1 and as UTF-16 too, so text hidden in it, or a file saved as UTF-16, is still read.
 */
export function fileProblems(path: string, bytes: Uint8Array): string[] {
  const problems = pathProblems(path, bytes.length);
  const media = mediaOrArchive(path, bytes);
  if (media && !problems.some((p) => p.startsWith('audio')))
    problems.push(`${media}: audio, video and archive files are never committed`);
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!isBinary(bytes)) return [...problems, ...textProblems(path, buffer.toString('utf8'))];
  const seen = new Set<string>();
  for (const encoding of ['latin1', 'utf16le'] as const) {
    const text = buffer.toString(encoding);
    for (const p of [
      ...personalProblems(text, { emailsAllowed: LICENCE_TEXT_EXCEPTIONS.includes(path), binary: true }),
      ...secretProblems(text),
    ]) {
      const what = p.replace(/, line \d+$/, '');
      if (!seen.has(what)) problems.push(`${what}, in its binary content`);
      seen.add(what);
    }
  }
  return problems;
}

export function isWorkflow(path: string): boolean {
  return /^\.github\/(workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/.test(path);
}

/** `key: value` in block or flow style, with the key quoted or not. */
const yamlValue = (key: string) => new RegExp(`(?:^|[\\s{,\\[])["']?(?:${key})["']?\\s*:\\s*["']?([^\\s'"#,}\\]]+)`, 'g');

/** Every action pinned to a full commit SHA, and every container image to a digest (R11). */
export function workflowProblems(text: string): string[] {
  const problems: string[] = [];
  for (const [i, line] of text.split('\n').entries()) {
    if (/^\s*#/.test(line)) continue;
    for (const [, ref] of line.matchAll(yamlValue('uses'))) {
      const pinned = ref.startsWith('./') || /^docker:\/\/.+@sha256:[0-9a-f]{64}$/.test(ref) || /@[0-9a-f]{40}$/.test(ref);
      if (!pinned) problems.push(`line ${i + 1}: ${ref} isn’t pinned to a full commit SHA`);
    }
    for (const [, image] of line.matchAll(yamlValue('image|container'))) {
      if (image.startsWith('${{'))
        problems.push(`line ${i + 1}: an image from an expression can’t be checked; name it, pinned by digest`);
      else if (!/@sha256:[0-9a-f]{64}$/.test(image)) problems.push(`line ${i + 1}: the image ${image} isn’t pinned to a digest`);
    }
    if (/\bdocker\s+(run|pull|create)\b/.test(line) && !/@sha256:[0-9a-f]{64}/.test(line))
      problems.push(`line ${i + 1}: docker runs an image that isn’t pinned to a digest`);
  }
  return problems;
}

export interface CommitDetails {
  sha: string;
  authorEmail: string;
  committerEmail: string;
  message: string;
}

/** A pull request's commit: noreply addresses only, and no user folder, address or secret in its message. */
export function commitProblems(commit: CommitDetails): string[] {
  const problems: string[] = [];
  if (!isNoreply(commit.authorEmail)) problems.push('its author’s email isn’t a GitHub noreply address');
  if (!isNoreply(commit.committerEmail)) problems.push('its committer’s email isn’t a GitHub noreply address');
  const message = commit.message.replace(DEPENDABOT_SIGN_OFF, '');
  for (const p of [...personalProblems(message), ...secretProblems(message)]) problems.push(`its message has ${p}`);
  return problems;
}

/** A file with a NUL byte near its start is binary. */
export function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

function lineOf(text: string, index = 0): number {
  return text.slice(0, index).split('\n').length;
}

/** An address is reported without being repeated in full in the CI log. */
function mask(address: string): string {
  const a = decoded(address);
  const at = a.lastIndexOf('@');
  return `${a.slice(0, 1)}…@${a.slice(at + 1)}`;
}

/** What npm installs at run time: package.json's dependencies, optionalDependencies and peerDependencies. */
const RUNTIME_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

/** A version range from the npm registry, not a tarball, a folder, git, a URL or another package's name (`npm:`). */
const fromRegistry = (spec: string) => !/[:/#]/.test(spec) && !/^(file|git|link|workspace)/i.test(spec);

/**
 * Runtime dependencies a pull request adds (R4): a name new to package.json's runtime fields, or an existing one whose
 * version now comes from somewhere other than the registry, which can swap the package under the same name. Either
 * needs the owner's `dependency-approved` label (CLAUDE.md: ask before adding a runtime dependency).
 */
export function addedDependencies(basePackageJson: string, headPackageJson: string): string[] {
  const specs = (json: string) => {
    const pkg = JSON.parse(json) as Partial<Record<(typeof RUNTIME_FIELDS)[number], Record<string, string>>>;
    const all = new Map<string, string>();
    for (const field of RUNTIME_FIELDS) for (const [name, spec] of Object.entries(pkg[field] ?? {})) all.set(name, String(spec));
    return all;
  };
  const before = specs(basePackageJson);
  const added: string[] = [];
  for (const [name, spec] of specs(headPackageJson)) {
    const was = before.get(name);
    if (was === undefined) added.push(name);
    else if (spec !== was && !fromRegistry(spec)) added.push(`${name} (now from ${spec})`);
  }
  return added;
}
