// Cloudflare Worker: the only way in or out of the private R2 bucket.
// It holds no permission list. It forwards the caller's own Firebase ID token to Firestore,
// reads the file's metadata document, and lets the Firestore Security Rules decide.

const KINDS = {
  students: (owner, id) => `students/${owner}/documents/${id}`,
  faculty: (owner, id) => `faculty/${owner}/documents/${id}`,
  teachingAssignments: (owner, id) => `teachingAssignments/${owner}/documents/${id}`,
};
const LIMITS = { students: 1048576, faculty: 1048576, teachingAssignments: 2097152 };
const TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const SAFE = /^[A-Za-z0-9_-]{1,128}$/;

const json = (body, status, cors) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } });

function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== env.ALLOWED_ORIGIN) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type, x-firebase-appcheck',
    'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
    vary: 'origin',
  };
}

// Only called after Firestore accepted the token, so the payload is genuine.
function uidFromToken(token) {
  const payload = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
  const claims = JSON.parse(atob(payload));
  return claims.user_id ?? claims.sub;
}

async function readMetadata(env, token, appCheck, iid, collection, owner, docId) {
  const path = KINDS[collection](owner, docId);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/institutions/${iid}/${path}`;
  const headers = { authorization: `Bearer ${token}`, ...(appCheck && { 'x-firebase-appcheck': appCheck }) };
  const res = await fetch(url, { headers });
  if (!res.ok) return null; // Firestore refused (or no such document): treat as forbidden
  const { fields } = await res.json();
  const s = (k) => fields[k]?.stringValue;
  return {
    status: s('status'),
    contentType: s('contentType'),
    objectKey: s('objectKey'),
    uploadedBy: s('uploadedBy'),
    size: Number(fields.size?.integerValue ?? 0),
  };
}

export async function handle(request, env) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url = new URL(request.url);
  const m = url.pathname.match(/^\/files\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!m) return json({ error: 'not found' }, 404, cors);
  const [, iid, collection, owner, docId] = m;
  if (!KINDS[collection] || ![iid, owner, docId].every((p) => SAFE.test(p))) {
    return json({ error: 'bad path' }, 400, cors);
  }

  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'login required' }, 401, cors);
  const token = auth.slice(7);

  const meta = await readMetadata(env, token, request.headers.get('x-firebase-appcheck'), iid, collection, owner, docId);
  if (!meta) return json({ error: 'forbidden' }, 403, cors);

  // The object key always comes from the URL path and must match the metadata.
  const key = `${iid}/${collection}/${owner}/${docId}`;
  if (meta.objectKey !== key) return json({ error: 'forbidden' }, 403, cors);

  if (request.method === 'GET') {
    if (meta.status !== 'READY') return json({ error: 'not ready' }, 404, cors);
    const obj = await env.BUCKET.get(key);
    if (!obj) return json({ error: 'missing' }, 404, cors);
    return new Response(obj.body, {
      headers: {
        'content-type': meta.contentType,
        'content-disposition': 'attachment',
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
        ...cors,
      },
    });
  }

  if (request.method === 'PUT') {
    if (meta.status !== 'PENDING' || meta.uploadedBy !== uidFromToken(token)) {
      return json({ error: 'forbidden' }, 403, cors);
    }
    const length = request.headers.get('content-length');
    if (!length) return json({ error: 'content-length required' }, 411, cors);
    const limit = Math.min(meta.size, LIMITS[collection]);
    if (Number(length) > limit) return json({ error: 'too large' }, 413, cors);
    if (!TYPES.includes(meta.contentType) || request.headers.get('content-type') !== meta.contentType) {
      return json({ error: 'wrong content type' }, 415, cors);
    }
    await env.BUCKET.put(key, request.body, { httpMetadata: { contentType: meta.contentType } });
    const stored = await env.BUCKET.head(key);
    if (!stored || stored.size !== meta.size) {
      await env.BUCKET.delete(key);
      return json({ error: 'size mismatch' }, 400, cors);
    }
    return json({ ok: true }, 200, cors);
  }

  if (request.method === 'DELETE') {
    if (meta.status !== 'DELETED') return json({ error: 'mark as deleted first' }, 409, cors);
    await env.BUCKET.delete(key);
    return json({ ok: true }, 200, cors);
  }

  return json({ error: 'method not allowed' }, 405, cors);
}

export default { fetch: handle };
