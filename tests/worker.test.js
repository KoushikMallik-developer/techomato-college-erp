import { afterEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../worker/src/index.js';

const ORIGIN = 'https://app.example';
const env = (bucket) => ({ FIREBASE_PROJECT_ID: 'demo', ALLOWED_ORIGIN: ORIGIN, BUCKET: bucket });
const jwt = (uid) => `h.${btoa(JSON.stringify({ user_id: uid })).replaceAll('+', '-').replaceAll('/', '_')}.s`;
const KEY = 'c1/students/s1/f01';

const metadata = (over = {}) => ({
  fields: {
    status: { stringValue: 'PENDING' }, contentType: { stringValue: 'application/pdf' },
    objectKey: { stringValue: KEY }, uploadedBy: { stringValue: 'u1' }, size: { integerValue: '4' }, ...over,
  },
});
const firestore = (body, ok = true) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));
const bucket = (stored = 4) => ({
  put: vi.fn(async () => {}), head: vi.fn(async () => ({ size: stored })), delete: vi.fn(async () => {}),
  get: vi.fn(async () => ({ body: 'bytes' })),
});
const req = (method, headers = {}, body) =>
  new Request(`https://w.example/files/${KEY}`, { method, headers: { origin: ORIGIN, authorization: `Bearer ${jwt('u1')}`, ...headers }, body });

afterEach(() => vi.unstubAllGlobals());

describe('file worker', () => {
  it('refuses a request with no login token', async () => {
    const res = await handle(req('GET', { authorization: '' }), env(bucket()));
    expect(res.status).toBe(401);
  });

  it('refuses when Firestore refuses the token (wrong college, student, or forged token)', async () => {
    firestore({}, false);
    const b = bucket();
    expect((await handle(req('GET'), env(b))).status).toBe(403);
    expect(b.get).not.toHaveBeenCalled();
  });

  it('refuses a path that is not one of the three file kinds', async () => {
    const res = await handle(new Request('https://w.example/files/c1/secrets/s1/f01', { headers: { authorization: 'Bearer x' } }), env(bucket()));
    expect(res.status).toBe(400);
  });

  it('only serves READY files, as attachments', async () => {
    firestore(metadata({ status: { stringValue: 'PENDING' } }));
    expect((await handle(req('GET'), env(bucket()))).status).toBe(404);
    firestore(metadata({ status: { stringValue: 'READY' } }));
    const res = await handle(req('GET'), env(bucket()));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('upload needs a declared length (411) and respects the declared size (413)', async () => {
    firestore(metadata());
    const noLength = new Request(`https://w.example/files/${KEY}`, {
      method: 'PUT', headers: { origin: ORIGIN, authorization: `Bearer ${jwt('u1')}`, 'content-type': 'application/pdf' },
    });
    expect((await handle(noLength, env(bucket()))).status).toBe(411);
    const big = req('PUT', { 'content-type': 'application/pdf', 'content-length': '99' }, 'x'.repeat(99));
    expect((await handle(big, env(bucket()))).status).toBe(413);
  });

  it('upload is limited to the person who created the metadata', async () => {
    firestore(metadata({ uploadedBy: { stringValue: 'someone-else' } }));
    const res = await handle(req('PUT', { 'content-type': 'application/pdf', 'content-length': '4' }, 'abcd'), env(bucket()));
    expect(res.status).toBe(403);
  });

  it('deletes an object whose stored size differs from the declared size', async () => {
    firestore(metadata());
    const b = bucket(3);
    const res = await handle(req('PUT', { 'content-type': 'application/pdf', 'content-length': '4' }, 'abcd'), env(b));
    expect(res.status).toBe(400);
    expect(b.delete).toHaveBeenCalledWith(KEY);
  });

  it('accepts a good upload', async () => {
    firestore(metadata());
    const res = await handle(req('PUT', { 'content-type': 'application/pdf', 'content-length': '4' }, 'abcd'), env(bucket()));
    expect(res.status).toBe(200);
  });

  it('delete requires status DELETED first', async () => {
    firestore(metadata({ status: { stringValue: 'READY' } }));
    expect((await handle(req('DELETE'), env(bucket()))).status).toBe(409);
    firestore(metadata({ status: { stringValue: 'DELETED' } }));
    const b = bucket();
    expect((await handle(req('DELETE'), env(b))).status).toBe(200);
    expect(b.delete).toHaveBeenCalledWith(KEY);
  });

  it('refuses when the stored object key does not match the URL path', async () => {
    firestore(metadata({ objectKey: { stringValue: 'other/students/s1/f01' }, status: { stringValue: 'READY' } }));
    expect((await handle(req('GET'), env(bucket()))).status).toBe(403);
  });
});
