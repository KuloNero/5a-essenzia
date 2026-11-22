// Finto server GitHub (Git Data API + Contents API minimi) per i test di concorrenza.
import { createHash } from 'node:crypto';

const sha1 = s => createHash('sha1').update(s).digest('hex');

export function createFakeGitHub({ empty = true } = {}) {
  const objects = new Map(); // sha -> {type, ...}
  const refs = new Map();    // 'heads/main' -> sha
  const calls = [];

  function putBlob(buf) {
    const b = Buffer.from(buf);
    const sha = sha1(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b]));
    objects.set(sha, { type: 'blob', content: b });
    return sha;
  }
  function putTree(entries) {
    const sorted = [...entries].sort((a, b) => a.path < b.path ? -1 : 1);
    const sha = sha1('tree' + JSON.stringify(sorted));
    objects.set(sha, { type: 'tree', entries: sorted });
    return sha;
  }
  function readTreeFlat(sha, prefix = '') {
    const out = new Map();
    for (const e of objects.get(sha).entries) {
      const p = prefix + e.path;
      if (e.type === 'tree') for (const [k, v] of readTreeFlat(e.sha, p + '/')) out.set(k, v);
      else out.set(p, e.sha);
    }
    return out;
  }
  function buildTree(flat) {
    // flat: Map path -> blobSha
    const root = {};
    for (const [p, s] of flat) {
      const parts = p.split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] = node[parts[i]] || {};
      node[parts.at(-1)] = s;
    }
    const mk = node => putTree(Object.entries(node).map(([k, v]) => typeof v === 'string'
      ? { path: k, mode: '100644', type: 'blob', sha: v }
      : { path: k, mode: '040000', type: 'tree', sha: mk(v) }));
    return mk(root);
  }
  function putCommit(tree, parents, message) {
    const sha = sha1('commit' + tree + parents.join() + message + Math.random());
    objects.set(sha, { type: 'commit', tree, parents, message });
    return sha;
  }

  if (!empty) {
    const t = buildTree(new Map([['README.md', putBlob('hi')]]));
    refs.set('heads/main', putCommit(t, [], 'init'));
  }

  const resp = (status, body, headers = {}) => ({
    status, ok: status >= 200 && status < 300,
    headers: { get: k => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    blob: async () => body,
  });

  async function fetch(url, opts = {}) {
    const u = new URL(url);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    const path = u.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
    calls.push(`${method} ${path}`);
    let m;
    if (method === 'GET' && path === '') return resp(200, { default_branch: 'main', private: true, full_name: 'o/r', permissions: { push: true } });
    if ((m = path.match(/^\/git\/ref\/(heads\/.+)$/)) && method === 'GET') {
      if (!refs.size) return resp(409, { message: 'Git Repository is empty.' });
      const s = refs.get(decodeURIComponent(m[1]));
      if (!s) return resp(404, { message: 'Not Found' });
      const etag = `"${s}"`;
      if (opts.headers?.['If-None-Match'] === etag) return resp(304, null);
      return resp(200, { object: { sha: s } }, { etag });
    }
    if (path === '/git/refs' && method === 'POST') { refs.set(body.ref.replace('refs/', ''), body.sha); return resp(201, {}); }
    if ((m = path.match(/^\/git\/refs\/(heads\/.+)$/)) && method === 'PATCH') {
      const name = decodeURIComponent(m[1]);
      const cur = refs.get(name);
      // fast-forward: il nuovo commit deve avere cur come antenato diretto
      const c = objects.get(body.sha);
      if (!body.force && cur && !c.parents.includes(cur)) return resp(422, { message: 'Update is not a fast forward' });
      refs.set(name, body.sha);
      return resp(200, { object: { sha: body.sha } });
    }
    if ((m = path.match(/^\/contents\/(.+)$/)) && method === 'PUT') {
      const p = decodeURIComponent(m[1]);
      const flat = new Map([[p, putBlob(Buffer.from(body.content, 'base64'))]]);
      refs.set(`heads/${body.branch}`, putCommit(buildTree(flat), [], body.message));
      return resp(201, {});
    }
    if ((m = path.match(/^\/contents\/(.+)$/)) && method === 'GET') {
      const head = refs.get('heads/main');
      const flat = readTreeFlat(objects.get(head).tree);
      const s = flat.get(decodeURIComponent(m[1]));
      return s ? resp(200, objects.get(s).content) : resp(404, { message: 'nf' });
    }
    if ((m = path.match(/^\/git\/commits\/(\w+)$/)) && method === 'GET') {
      const c = objects.get(m[1]);
      return resp(200, { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map(sha => ({ sha })) });
    }
    if ((m = path.match(/^\/git\/trees\/(\w+)$/)) && method === 'GET') {
      const t = objects.get(m[1]);
      return resp(200, { sha: m[1], tree: t.entries });
    }
    if ((m = path.match(/^\/git\/blobs\/(\w+)$/)) && method === 'GET') {
      return resp(200, { content: objects.get(m[1]).content.toString('base64'), encoding: 'base64' });
    }
    if (path === '/git/blobs' && method === 'POST') return resp(201, { sha: putBlob(Buffer.from(body.content, 'base64')) });
    if (path === '/git/trees' && method === 'POST') {
      const flat = readTreeFlat(body.base_tree);
      for (const e of body.tree) {
        if (e.sha === null) flat.delete(e.path);
        else if (e.content !== undefined) flat.set(e.path, putBlob(e.content));
        else flat.set(e.path, e.sha);
      }
      return resp(201, { sha: buildTree(flat) });
    }
    if (path === '/git/commits' && method === 'POST') return resp(201, { sha: putCommit(body.tree, body.parents, body.message) });
    return resp(404, { message: `fake: unhandled ${method} ${path}` });
  }

  function headFiles() {
    const head = refs.get('heads/main');
    const flat = readTreeFlat(objects.get(head).tree);
    const out = {};
    for (const [p, s] of flat) out[p] = objects.get(s).content.toString('utf8');
    return out;
  }
  function log() {
    const out = [];
    let s = refs.get('heads/main');
    while (s) { const c = objects.get(s); out.push(c.message); s = c.parents[0]; }
    return out;
  }

  return { fetch, calls, headFiles, log, refs, objects };
}
