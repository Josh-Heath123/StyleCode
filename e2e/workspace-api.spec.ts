import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { requireTestWorkspace } from './workspaceFolder';

/**
 * The workspace API as the browser meets it. These tests write to the dev
 * server's data folder, so they first make sure it is the temporary one from
 * playwright.config.ts, and refuse to run otherwise (a dev server already
 * running on port 5174 with real data, for example).
 */
const HEADERS = { 'x-stylecode-workspace': '1' };

test.beforeAll(async ({ request }) => requireTestWorkspace(request));

async function newCompany(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post('/api/workspace/companies', {
    headers: HEADERS,
    data: { profile: { name: `${name} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}` } },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { workspace: { company: { id: string } } }).workspace.company.id;
}

test('a page from another origin cannot read the workspace', async ({ page, request }) => {
  await newCompany(request, 'Origin Test');
  // Another site on this computer: a page served from a different port.
  const other = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>Other site</title>');
  });
  await new Promise<void>((resolve) => other.listen(0, 'localhost', resolve));
  try {
    await page.goto(`http://localhost:${(other.address() as AddressInfo).port}/`);
    const outcome = await page.evaluate(async () => {
      try {
        const res = await fetch('http://localhost:5174/api/workspace/companies', {
          headers: { 'x-stylecode-workspace': '1' },
        });
        return `status ${res.status}`;
      } catch {
        return 'blocked';
      }
    });
    expect(outcome).toBe('blocked');
  } finally {
    await new Promise<void>((resolve) => other.close(() => resolve()));
  }

  // Even a request that sends the header gets nothing back from another origin.
  const forged = await request.get('/api/workspace/companies', {
    headers: { ...HEADERS, origin: 'https://evil.example' },
  });
  expect(forged.status()).toBe(403);
  expect(await forged.text()).not.toContain('Origin Test');
});

test('the page itself can use the workspace', async ({ page }) => {
  await page.goto('/');
  const status = await page.evaluate(async () => {
    const res = await fetch('/api/workspace/companies', { headers: { 'x-stylecode-workspace': '1' } });
    return res.status;
  });
  expect(status).toBe(200);
});

test('a path with an invalid id is refused before it reaches the disk', async ({ request }) => {
  const id = await newCompany(request, 'Path Test');
  for (const path of [
    '/api/workspace/companies/CON',
    '/api/workspace/companies/..%5c..%5csettings',
    '/api/workspace/companies/co.x',
    `/api/workspace/companies/${id}/files/..%2fworkspace.json`,
    `/api/workspace/companies/${id}/files/NUL`,
  ]) {
    const res = await request.get(path, { headers: HEADERS });
    expect(res.status(), path).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid id.' });
  }
});
