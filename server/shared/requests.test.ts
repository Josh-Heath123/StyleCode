import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readBody, readJson, rejectReason, RequestError, sendJson, type RequestPolicy } from './requests.ts';

const POLICY: RequestPolicy = { header: 'x-stylecode-test', feature: 'The test API' };

/** A request as Node would hand it over, from this computer unless said otherwise. */
const fake = (headers: Record<string, string>, remoteAddress = '127.0.0.1') =>
  ({ socket: { remoteAddress }, headers: { host: 'localhost:5173', 'x-stylecode-test': '1', ...headers } }) as never;

describe('who may use a local API', () => {
  it('allows StyleCode on this computer, by any local name', () => {
    expect(rejectReason(fake({}), POLICY)).toBeNull();
    expect(rejectReason(fake({ host: '127.0.0.1:5173' }), POLICY)).toBeNull();
    expect(rejectReason(fake({ host: '[::1]:5173' }, '::1'), POLICY)).toBeNull();
    expect(rejectReason(fake({ origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' }), POLICY)).toBeNull();
    expect(rejectReason(fake({ 'sec-fetch-site': 'none' }), POLICY)).toBeNull();
  });

  it('refuses connections from other computers, whatever their headers say', () => {
    expect(rejectReason(fake({}, '192.0.2.2'), POLICY)).toBe('The test API is only available to StyleCode on this computer.');
    expect(rejectReason(fake({}, '::ffff:10.0.0.7'), POLICY)).not.toBeNull();
    expect(rejectReason(fake({}, ''), POLICY)).not.toBeNull();
    expect(rejectReason(fake({}, '::ffff:127.0.0.1'), POLICY)).toBeNull();
  });

  it('refuses a Host that is not this computer, as a DNS-rebinding page would send', () => {
    expect(rejectReason(fake({ host: 'evil.example:5173' }), POLICY)).toMatch(/open it at localhost/);
    expect(rejectReason(fake({ host: 'localhost.evil.example' }), POLICY)).not.toBeNull();
    expect(rejectReason(fake({ host: '' }), POLICY)).not.toBeNull();
  });

  it('refuses any Origin other than exactly this server', () => {
    for (const origin of ['https://evil.example', 'http://localhost:4173', 'http://127.0.0.1:5173', 'null', 'not a url']) {
      expect(rejectReason(fake({ origin }), POLICY)).toBe('Requests from other sites are not allowed.');
    }
  });

  it('refuses a browser request from another site', () => {
    for (const site of ['cross-site', 'same-site']) {
      expect(rejectReason(fake({ 'sec-fetch-site': site }), POLICY)).toBe('Requests from other sites are not allowed.');
    }
  });

  it("needs the API's own header, so a form post or another API's header can't get in", () => {
    expect(rejectReason(fake({ 'x-stylecode-test': '' }), POLICY)).toBe('Missing StyleCode request header.');
    expect(rejectReason(fake({ 'x-stylecode-test': 'yes' }), POLICY)).not.toBeNull();
    const other = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:5173', 'x-stylecode-ai': '1' } } as never;
    expect(rejectReason(other, POLICY)).toBe('Missing StyleCode request header.');
  });
});

describe('request bodies', () => {
  const body = (text: string, headers: Record<string, string> = {}) =>
    Object.assign(Readable.from([Buffer.from(text)]), { headers }) as unknown as IncomingMessage;

  it('reads a JSON object, and treats an empty body as an empty object', async () => {
    expect(await readJson(body('{"a":1}'), 100)).toEqual({ a: 1 });
    expect(await readJson(body(''), 100)).toEqual({});
  });

  it('refuses anything but a JSON object', async () => {
    for (const text of ['[1]', '"a"', 'null', '{oops']) {
      await expect(readJson(body(text), 100)).rejects.toEqual(new RequestError('Expected a JSON object.', 400));
    }
  });

  it('refuses a body over the limit, before reading it if its length says so', async () => {
    await expect(readBody(body('x'.repeat(11)), 10)).rejects.toMatchObject({ status: 413 });
    await expect(readBody(body('x', { 'content-length': '11' }), 10)).rejects.toMatchObject({ status: 413 });
    expect((await readBody(body('x'.repeat(10)), 10)).length).toBe(10);
  });
});

describe('over a real connection', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const reason = rejectReason(req, POLICY);
      sendJson(res, reason ? 403 : 200, reason ? { error: reason } : { ok: true });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const get = (headers: Record<string, string>) =>
    new Promise<{ status: number; headers: IncomingMessage['headers'] }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/', headers }, (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, headers: res.headers });
      });
      req.on('error', reject);
      req.end();
    });

  it('answers StyleCode, refuses a rebinding Host, and never sends CORS headers', async () => {
    const ok = await get({ host: `localhost:${port}`, 'x-stylecode-test': '1' });
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    const rebound = await get({ host: `evil.example:${port}`, 'x-stylecode-test': '1' });
    expect(rebound.status).toBe(403);
    for (const reply of [ok, rebound]) {
      expect(Object.keys(reply.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
    }
  });
});
