/**
 * The hygiene rules (repository brief, R3): what may never be committed to StyleCode. Pure functions over a file's
 * path and contents, a workflow's text and a commit's details, so the tests can give them bad examples.
 * `scripts/check-hygiene.ts` runs them over the repository and a pull request's commits.
 */

/** Just above the largest tracked file when the check was written (docs/media/sketch-to-code.gif, 3,394,699 bytes). */
export const SIZE_LIMIT = 3_500_000;

/** Files allowed over the size limit, by path. None today. */
export const SIZE_EXCEPTIONS: readonly string[] = [];

/**
 * Third-party licence texts, by path, which may hold their authors' email addresses. Nothing else is excepted from
 * the email rule. None today: the licence texts in THIRD-PARTY-NOTICES.md hold no address.
 */
export const LICENCE_TEXT_EXCEPTIONS: readonly string[] = [];

const AUDIO_VIDEO_ARCHIVE =
  /\.(wav|mp3|m4a|aac|ogg|oga|opus|flac|wma|aif|aiff|webm|mp4|m4v|mov|avi|mkv|wmv|flv|mpg|mpeg|zip|tar|gz|tgz|bz2|tbz2|xz|txz|7z|rar|zst|lz|lzma|cab|iso|dmg|jar)$/i;

/** `.env` and `.env.local`, say; `.env.example`, a template without values, is allowed, as in `.gitignore`. */
const ENV_FILE = /(^|\/)\.env(\.(?!example$)[^/]*)?$/;

/**
 * A user's folder: `X:\Users\<name>`, `/Users/<name>` or `/home/<name>`, with a real name in place of `<name>`. A
 * placeholder such as `<you>`, or the brief's `…`, isn't a name, so it passes.
 */
const USER_PATHS = [
  /\b[A-Za-z]:(\\\\|\\|\/)Users(\\\\|\\|\/)[A-Za-z0-9._-]/g,
  /(?<![A-Za-z0-9._~:-])\/(Users|home)\/[A-Za-z0-9._-]/g,
];

// Anchored at the start of a word, so a long run of letters is scanned once, not once from every position.
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** GitHub's own noreply addresses: a user's (`123+name@users.noreply.github.com`) and GitHub's (`noreply@github.com`). */
export function isNoreply(address: string): boolean {
  return /^(\d+\+)?[A-Za-z0-9-]+@users\.noreply\.github\.com$/i.test(address) || /^noreply@github\.com$/i.test(address);
}

/**
 * Domains reserved for examples and tests (RFC 2606 and RFC 6761): nobody can receive mail there, so `you@example.com`
 * in a placeholder isn't anyone's address.
 */
function isReservedExample(address: string): boolean {
  const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase();
  return /(^|\.)example\.(com|org|net)$/.test(domain) || /\.(example|test|invalid|localhost)$/.test(domain);
}

const SECRETS: [string, RegExp][] = [
  ['an API key (sk-…)', /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{32,}/],
  ['a GitHub token (ghp_…)', /(?<![A-Za-z0-9])ghp_[A-Za-z0-9]{36}/],
  ['a GitHub token (github_pat_…)', /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{50,}/],
  ['an AWS access key (AKIA…)', /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/],
  ['a private key', /-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY( BLOCK)?-----/],
];

/** What's wrong with a tracked file, judged by its path and size alone. */
export function pathProblems(path: string, size: number): string[] {
  const problems: string[] = [];
  if (AUDIO_VIDEO_ARCHIVE.test(path)) problems.push('audio, video and archive files are never committed');
  if (ENV_FILE.test(path)) problems.push('.env files are never committed');
  if (size > SIZE_LIMIT && !SIZE_EXCEPTIONS.includes(path))
    problems.push(`${size.toLocaleString('en')} bytes, over the limit of ${SIZE_LIMIT.toLocaleString('en')}`);
  return problems;
}

/** User folders and email addresses in text: a file's or a commit message's. */
export function personalProblems(text: string, { emailsAllowed = false } = {}): string[] {
  const problems: string[] = [];
  for (const pattern of USER_PATHS)
    for (const m of text.matchAll(pattern)) problems.push(`a user’s folder, line ${lineOf(text, m.index)}`);
  if (!emailsAllowed)
    for (const m of text.matchAll(EMAIL))
      if (!isNoreply(m[0]) && !isReservedExample(m[0]))
        problems.push(`an email address (${mask(m[0])}), line ${lineOf(text, m.index)}`);
  return problems;
}

/** Likely secrets in a file's text. */
export function secretProblems(text: string): string[] {
  return SECRETS.filter(([, pattern]) => pattern.test(text)).map(([what]) => `likely ${what}`);
}

/** Everything wrong with a tracked text file's contents. */
export function textProblems(path: string, text: string): string[] {
  return [
    ...personalProblems(text, { emailsAllowed: LICENCE_TEXT_EXCEPTIONS.includes(path) }),
    ...secretProblems(text),
    ...(isWorkflow(path) ? workflowProblems(text) : []),
  ];
}

export function isWorkflow(path: string): boolean {
  return /^\.github\/(workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/.test(path);
}

/** Every action pinned to a full commit SHA, and every container image to a digest (R11). */
export function workflowProblems(text: string): string[] {
  const problems: string[] = [];
  for (const [i, line] of text.split('\n').entries()) {
    const uses = /^\s*(?:-\s*)?uses:\s*['"]?([^\s'"#]+)/.exec(line);
    if (uses) {
      const ref = uses[1];
      const pinned = ref.startsWith('./') || /^docker:\/\/.+@sha256:[0-9a-f]{64}$/.test(ref) || /@[0-9a-f]{40}$/.test(ref);
      if (!pinned) problems.push(`line ${i + 1}: ${ref} isn’t pinned to a full commit SHA`);
    }
    const image = /^\s*(?:-\s*)?(?:image|container):\s*['"]?([^\s'"#]+)/.exec(line);
    if (image && !image[1].startsWith('${{') && !/@sha256:[0-9a-f]{64}$/.test(image[1]))
      problems.push(`line ${i + 1}: the image ${image[1]} isn’t pinned to a digest`);
  }
  return problems;
}

export interface CommitDetails {
  sha: string;
  authorEmail: string;
  committerEmail: string;
  message: string;
}

/** A pull request's commit: noreply addresses only, and no user folder or address in its message. */
export function commitProblems(commit: CommitDetails): string[] {
  const problems: string[] = [];
  if (!isNoreply(commit.authorEmail)) problems.push('its author’s email isn’t a GitHub noreply address');
  if (!isNoreply(commit.committerEmail)) problems.push('its committer’s email isn’t a GitHub noreply address');
  for (const p of personalProblems(commit.message)) problems.push(`its message has ${p}`);
  return problems;
}

/** Text files are checked line by line; a file with a NUL byte near its start is binary. */
export function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

function lineOf(text: string, index = 0): number {
  return text.slice(0, index).split('\n').length;
}

/** An address is reported without being repeated in full in the CI log. */
function mask(address: string): string {
  const at = address.indexOf('@');
  return `${address.slice(0, 1)}…@${address.slice(at + 1)}`;
}

/**
 * Runtime dependencies a pull request adds (R4): names in `dependencies` at its head that weren't there at its base.
 * A new one needs the owner's `dependency-approved` label (CLAUDE.md: ask before adding a runtime dependency).
 */
export function addedDependencies(basePackageJson: string, headPackageJson: string): string[] {
  const names = (json: string) => Object.keys((JSON.parse(json) as { dependencies?: object }).dependencies ?? {});
  const before = new Set(names(basePackageJson));
  return names(headPackageJson).filter((name) => !before.has(name));
}
