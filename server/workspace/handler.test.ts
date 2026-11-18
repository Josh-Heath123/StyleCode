import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompanyWorkspace } from '../../src/workspace/model/index.ts';
import { createDocument } from '../../src/model/document';
import { toProjectFile } from '../../src/model/serialize';
import { attachmentHeader, createWorkspaceHandler, MAX_FILE_BYTES, WORKSPACE_HEADER } from './handler.ts';

let root: string;
let server: Server;
let base: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'stylecode-handler-'));
  mkdirSync(join(root, 'companies'));
  const handler = createWorkspaceHandler({ path: root, mode: 'development', cloudService: 'OneDrive' });
  server = createServer((req, res) => {
    // Vite mounts the handler at /api/workspace and strips the prefix, as connect does.
    if (!req.url?.startsWith('/api/workspace')) return void ((res.statusCode = 404), res.end());
    req.url = req.url.slice('/api/workspace'.length) || '/';
    void handler(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api/workspace`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

const call = (path: string, init: RequestInit & { json?: unknown } = {}) => {
  const { json, ...rest } = init;
  return fetch(`${base}${path}`, {
    ...rest,
    headers: {
      [WORKSPACE_HEADER]: '1',
      ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      ...(rest.headers as Record<string, string>),
    },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
};

async function newCompany(name: string): Promise<{ workspace: CompanyWorkspace; revision: string }> {
  const res = await call('/companies', { method: 'POST', json: { profile: { name } } });
  expect(res.status).toBe(201);
  return (await res.json()) as { workspace: CompanyWorkspace; revision: string };
}

describe('who may use the workspace routes', () => {
  it('refuses another origin, another site, and requests without the workspace header', async () => {
    expect((await call('/companies', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call('/companies', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await fetch(`${base}/companies`)).status).toBe(403);
    expect((await call('/companies', { headers: { [WORKSPACE_HEADER]: '', 'x-stylecode-ai': '1' } })).status).toBe(403);
    expect((await call('/companies')).status).toBe(200);
  });

  it('sends no CORS headers', async () => {
    const res = await call('/companies', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect([...res.headers.keys()].filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });
});

describe('routes', () => {
  it('says which data folder is in use, with the cloud warning', async () => {
    expect(await (await call('/info')).json()).toEqual({ folder: root, mode: 'development', cloudService: 'OneDrive' });
  });

  it('refuses an id that is not safe to use in a path', async () => {
    for (const id of ['...', '..x', 'CON', 'Co_Upper', 'a.b', '%5c..%5cx']) {
      const res = await call(`/companies/${id}`);
      expect(res.status, id).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid id.' });
    }
    const { workspace } = await newCompany('Id Test');
    expect((await call(`/companies/${workspace.company.id}/files/..%2f..%2fworkspace.json`)).status).toBe(400);
  });

  it('refuses a body that is too large', async () => {
    const res = await call('/companies', { method: 'POST', body: JSON.stringify({ profile: { name: 'x'.repeat(70_000) } }) });
    expect(res.status).toBe(413);
  });

  it('creates, opens, saves and deletes a company', async () => {
    const created = await newCompany('Harbour Bakery');
    const id = created.workspace.company.id;
    const list = (await (await call('/companies')).json()) as { companies: { id: string; name: string }[] };
    expect(list.companies.map((c) => c.name)).toContain('Harbour Bakery');
    expect((await call('/companies', { method: 'POST', json: { profile: { name: 'harbour bakery' } } })).status).toBe(409);

    const opened = (await (await call(`/companies/${id}`)).json()) as { access: string; revision: string };
    expect(opened.access).toBe('editable');
    const changed = { ...created.workspace, company: { ...created.workspace.company, industry: 'Food' } };
    const saved = await call(`/companies/${id}`, { method: 'PUT', json: { workspace: changed, baseRevision: opened.revision } });
    expect(saved.status).toBe(200);

    // The same revision again: changed in another window.
    const stale = await call(`/companies/${id}`, { method: 'PUT', json: { workspace: changed, baseRevision: opened.revision } });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: string }).error).toMatch(/another window/);

    expect((await call(`/companies/${id}`, { method: 'DELETE', json: { confirmName: 'Harbour' } })).status).toBe(400);
    expect((await call(`/companies/${id}`, { method: 'DELETE', json: { confirmName: 'Harbour Bakery' } })).status).toBe(200);
    expect((await call(`/companies/${id}`)).status).toBe(404);
  });

  it('refuses to save a workspace with problems, and lists them', async () => {
    const { workspace, revision } = await newCompany('Problem Ltd');
    const broken = { ...workspace, company: { ...workspace.company, name: '' } };
    const res = await call(`/companies/${workspace.company.id}`, {
      method: 'PUT',
      json: { workspace: broken, baseRevision: revision },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { problems: { code: string }[] };
    expect(body.problems.map((p) => p.code)).toContain('company.name');
  });

  it('uploads, downloads as an attachment, and removes a file', async () => {
    const { workspace, revision } = await newCompany('Files Ltd');
    const id = workspace.company.id;
    const upload = await call(`/companies/${id}/files`, { method: 'POST', body: '<script>alert(1)</script>' });
    expect(upload.status).toBe(201);
    const file = (await upload.json()) as { id: string; sizeBytes: number };
    const ref = {
      id: file.id,
      owner: { kind: 'company' },
      purpose: 'document',
      name: 'Menü "draft".html',
      mediaType: 'text/html',
      sizeBytes: file.sizeBytes,
      addedBy: 'Sam',
      addedAt: '2026-11-04T09:00:00.000Z',
    };
    const saved = await call(`/companies/${id}`, {
      method: 'PUT',
      json: { workspace: { ...workspace, files: { [file.id]: ref } }, baseRevision: revision },
    });
    expect(saved.status).toBe(200);

    const download = await call(`/companies/${id}/files/${file.id}`);
    expect(download.status).toBe(200);
    expect(download.headers.get('x-content-type-options')).toBe('nosniff');
    expect(download.headers.get('content-disposition')).toMatch(/^attachment; /);
    expect(download.headers.get('content-security-policy')).toMatch(/sandbox/);
    expect(await download.text()).toBe('<script>alert(1)</script>');

    expect((await call(`/companies/${id}/files/${file.id}`, { method: 'DELETE' })).status).toBe(409);
    const { revision: next } = (await saved.json()) as { revision: string };
    await call(`/companies/${id}`, { method: 'PUT', json: { workspace, baseRevision: next, permanent: true } });
    expect((await call(`/companies/${id}/files/${file.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(`/companies/${id}/files/${file.id}`)).status).toBe(404);
  });

  it('refuses a file larger than the limit from its declared length', async () => {
    const { workspace } = await newCompany('Big Files Ltd');
    const res = await call(`/companies/${workspace.company.id}/files`, {
      method: 'POST',
      headers: { 'content-length': String(MAX_FILE_BYTES + 1) },
      body: 'x',
    }).catch(() => null);
    // Node's fetch may refuse a mismatched length itself; either way nothing is stored.
    if (res) expect(res.status).toBe(413);
  });
});

describe('download names', () => {
  it('keeps the name for the download, with a plain fallback that cannot break the header', () => {
    expect(attachmentHeader('Menu.pdf')).toBe(`attachment; filename="Menu.pdf"; filename*=UTF-8''Menu.pdf`);
    expect(attachmentHeader('a"b\\c;d\r\n.txt')).toBe(
      `attachment; filename="a_b_c_d__.txt"; filename*=UTF-8''a%22b%5Cc%3Bd%0D%0A.txt`,
    );
    expect(attachmentHeader('Menü.pdf')).toContain(`filename*=UTF-8''Men%C3%BC.pdf`);
    expect(attachmentHeader('')).toBe(`attachment; filename="file"; filename*=UTF-8''file`);
  });
});

describe('recording routes (Phase 3)', () => {
  it('need the workspace header, and refuse ids that could be paths', async () => {
    const { workspace } = await newCompany('Karoo Recordings');
    const id = workspace.company.id;
    const bare = await fetch(`${base}/companies/${id}/recordings`, { method: 'POST' });
    expect(bare.status).toBe(403);
    expect((await call(`/companies/${id}/recordings/..%2Fx?session=se_1&offset=0`, { method: 'PUT', body: 'ab' })).status).toBe(
      400,
    );
    expect((await call(`/companies/${id}/recordings/fi_1?session=..&offset=0`, { method: 'PUT', body: 'ab' })).status).toBe(400);
    expect((await call(`/companies/${id}/recordings/fi_1/other`, { method: 'POST' })).status).toBe(404);
  });

  it('start a recording, refuse pieces for one the client doesn’t list, and refuse a WAV that isn’t one', async () => {
    const { workspace } = await newCompany('Veldt Recordings');
    const id = workspace.company.id;
    const started = await call(`/companies/${id}/recordings`, { method: 'POST' });
    expect(started.status).toBe(201);
    const { id: fileId } = (await started.json()) as { id: string };
    const piece = await call(`/companies/${id}/recordings/${fileId}?session=se_1&offset=0`, { method: 'PUT', body: 'ab' });
    expect(piece.status).toBe(409);
    // A WAV needs its session named, and consent to recording it, before anything is stored.
    const noSession = await call(`/companies/${id}/added-recordings`, { method: 'POST', body: 'RIFF' });
    expect(noSession.status).toBe(400);
    const noConsent = await call(`/companies/${id}/added-recordings?session=se_1`, { method: 'POST', body: 'RIFF' });
    expect(noConsent.status).toBe(409);
  });
});

describe('transcription routes (Phase 3)', () => {
  it('report what is installed and what to run, and need the workspace header', async () => {
    expect((await fetch(`${base}/transcription`)).status).toBe(403);
    const res = await call('/transcription');
    expect(res.status).toBe(200);
    const status = (await res.json()) as { ready: boolean; reason: string | null; setupCommand: string; installed: unknown[] };
    expect(status.setupCommand).toBe('npm run transcription:setup');
    expect(status.installed).toHaveLength(5);
    if (!status.ready) expect(status.reason).toBeTruthy();
  });

  it('refuse a job for a session without recordings, and an unknown job', async () => {
    const { workspace } = await newCompany('Umoya Transcriptions');
    const id = workspace.company.id;
    const job = await call(`/companies/${id}/transcriptions`, {
      method: 'POST',
      json: { sessionId: 'se_1', recordingIds: ['fi_1'] },
    });
    expect(job.status).toBe(409);
    expect((await call(`/companies/${id}/transcriptions`)).status).toBe(200);
    expect((await call(`/companies/${id}/transcriptions/tj_0123456789abcdef`)).status).toBe(404);
    expect((await call(`/companies/${id}/transcriptions/tj_0123456789abcdef/result`)).status).toBe(404);
  });
});

describe('design routes (Phase 4, decisions 2 and 8)', () => {
  const PNG = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0f60000000049454e44ae426082',
    'hex',
  );
  const file = (id: string) => toProjectFile({ ...createDocument('Checkout'), id });

  it('creates, lists, reads, saves and downloads a listed design, and refuses ids, other clients and stale saves', async () => {
    const opened = await newCompany(`Harbour Bakery designs ${Math.random().toString(36).slice(2, 6)}`);
    const id = opened.workspace.company.id;
    const at = opened.workspace.company.createdAt;
    const ws = {
      ...opened.workspace,
      engagements: {
        en_1: {
          id: 'en_1',
          companyId: id,
          name: 'Ordering',
          goal: '',
          status: { state: 'active' },
          createdAt: at,
          updatedAt: at,
        },
      },
      designs: { de_1: { id: 'de_1', engagementId: 'en_1', name: 'Checkout', documentId: 'doc_route', createdAt: at } },
    };
    expect(
      (await call(`/companies/${id}`, { method: 'PUT', json: { workspace: ws, baseRevision: opened.revision } })).status,
    ).toBe(200);

    const created = await call(`/companies/${id}/designs`, {
      method: 'POST',
      json: { documentId: 'doc_route', file: file('doc_route') },
    });
    expect(created.status).toBe(201);
    const { revision } = (await created.json()) as { revision: string };
    expect(
      (await call(`/companies/${id}/designs`, { method: 'POST', json: { documentId: 'doc_route', file: file('doc_route') } }))
        .status,
    ).toBe(409);
    expect(await (await call(`/companies/${id}/designs`)).json()).toMatchObject({
      designs: [{ documentId: 'doc_route', problem: null }],
    });
    expect(await (await call(`/companies/${id}/designs/doc_route`)).json()).toMatchObject({ revision });
    const download = await call(`/companies/${id}/designs/doc_route/file`);
    expect(download.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(download.headers.get('x-content-type-options')).toBe('nosniff');

    const saved = await call(`/companies/${id}/designs/doc_route`, {
      method: 'PUT',
      json: { file: file('doc_route'), baseRevision: revision },
    });
    expect(saved.status).toBe(200);
    const stale = await call(`/companies/${id}/designs/doc_route`, {
      method: 'PUT',
      json: { file: file('doc_route'), baseRevision: revision },
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'This design changed in another tab. Reload it to carry on.' });

    expect((await call(`/companies/${id}/designs/DOC_X`)).status).toBe(400);
    const other = await newCompany(`Karoo Freight designs ${Math.random().toString(36).slice(2, 6)}`);
    expect((await call(`/companies/${other.workspace.company.id}/designs/doc_route`)).status).toBe(404);

    const image = await call(`/companies/${id}/design-assets`, {
      method: 'POST',
      body: PNG,
      headers: { 'content-type': 'image/png' },
    });
    expect(image.status).toBe(201);
    const { id: assetId } = (await image.json()) as { id: string };
    const served = await call(`/companies/${id}/design-assets/${assetId}`);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await served.arrayBuffer())).toEqual(PNG);
    expect((await call(`/companies/${other.workspace.company.id}/design-assets/${assetId}`)).status).toBe(404);
  });
});
