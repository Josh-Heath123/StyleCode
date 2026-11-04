import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The checks every local API runs on every request (ADR-0008,
 * docs/ARCHITECTURE.md §8 and §12). The routes hold keys or clients' data, so
 * only StyleCode's own page on this computer may use them:
 *
 * - the connection comes from this computer, even if the server was started with --host;
 * - the Host is localhost, 127.0.0.1 or [::1], which defeats DNS rebinding;
 * - any Origin is exactly this server;
 * - a browser's Sec-Fetch-Site, when present, says same-origin (or none);
 * - the request carries the API's own StyleCode header, so a plain form post
 *   from another page can't reach the routes at all.
 *
 * No CORS headers are ever sent.
 */
export interface RequestPolicy {
  /** The header every request must carry with the value "1", such as `x-stylecode-ai`. */
  header: string;
  /** What the routes offer, for the refusal message, such as "AI". */
  feature: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** The host name in a Host header, without the port. */
export function hostname(host: string): string {
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.split(':')[0].toLowerCase();
}

/** Whether a connection comes from this computer. */
export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const ip = address.startsWith('::ffff:') ? address.slice(7) : address;
  return ip === '::1' || ip.startsWith('127.');
}

/** Why a request isn't allowed, or null if it is. */
export function rejectReason(req: IncomingMessage, policy: RequestPolicy): string | null {
  const onlyHere = `${policy.feature} is only available to StyleCode on this computer`;
  if (!isLoopback(req.socket.remoteAddress)) return `${onlyHere}.`;
  const host = req.headers.host ?? '';
  if (!LOCAL_HOSTS.has(hostname(host))) return `${onlyHere} (open it at localhost).`;
  const origin = req.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      if (!LOCAL_HOSTS.has(url.hostname) || url.host !== host) return 'Requests from other sites are not allowed.';
    } catch {
      return 'Requests from other sites are not allowed.';
    }
  }
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return 'Requests from other sites are not allowed.';
  if (req.headers[policy.header] !== '1') return 'Missing StyleCode request header.';
  return null;
}

/** An error with the HTTP status to answer it with. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

/** Sends a JSON reply that is never cached. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Reads a request body of at most `maxBytes`, refusing a larger one with 413. */
export async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestError('Request too large.', 413);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new RequestError('Request too large.', 413);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks, size);
}

/** Reads a JSON object body of at most `maxBytes`. An empty body is an empty object. */
export async function readJson(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const body = await readBody(req, maxBytes);
  if (!body.length) return {};
  try {
    const value = JSON.parse(body.toString('utf8')) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new RequestError('Expected a JSON object.', 400);
}
