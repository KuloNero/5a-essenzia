// Backend di persistenza.
//  - GitHubBackend: i dati vivono come file JSON in un repository GitHub (consigliato privato).
//    Ogni operazione = 1 commit atomico (Git Data API). Il ref viene aggiornato con force=false:
//    se un altro dispositivo ha scritto nel frattempo, l'aggiornamento fallisce (conflitto) e lo
//    store ricarica i dati e ri-applica l'azione. Lo storico dei commit è anche l'audit trail.
//  - LocalBackend: modalità prova/offline-only, dati solo nel browser (IndexedDB).
import { b64ToUtf8, utf8ToB64 } from './util.js';
import { COLLECTIONS } from './domain.js';
import { kv } from './idb.js';

export async function gitBlobSha(text) {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head); all.set(body, head.length);
  const h = await globalThis.crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export class ConflictError extends Error { constructor() { super('Conflitto: dati modificati da un altro dispositivo'); this.conflict = true; } }
export class NetworkError extends Error { constructor(msg) { super(msg || 'Rete non disponibile'); this.network = true; } }
export class AuthError extends Error { constructor(msg) { super(msg || 'Token GitHub non valido o senza permessi'); this.auth = true; } }

export class GitHubBackend {
  constructor({ owner, repo, branch = 'main', token, dir = 'data' }, fetchImpl) {
    this.owner = owner; this.repo = repo; this.branch = branch || 'main'; this.token = token;
    this.dir = (dir || 'data').replace(/^\/+|\/+$/g, '');
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
    this.refEtag = null;
    this.kind = 'github';
  }

  get base() { return `https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`; }

  async api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
    let res;
    try {
      res = await this.fetch(path.startsWith('http') ? path : this.base + path, {
        method,
        headers: {
          Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch (e) {
      throw new NetworkError();
    }
    return res;
  }

  async json(res, ctx) {
    if (res.status === 401) throw new AuthError();
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') throw new Error('Limite di richieste GitHub raggiunto, riprovare tra qualche minuto');
    if (res.status === 403) throw new AuthError('Permesso negato: il token deve avere "Contents: Read and write" sul repository dati');
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).message; } catch { /* */ }
      const e = new Error(`GitHub ${ctx || ''} ${res.status}: ${msg}`);
      e.status = res.status;
      throw e;
    }
    return res.status === 204 ? null : res.json();
  }

  /** SHA del commit in testa al branch (null se il repo/branch non esiste ancora). */
  async headSha({ useEtag = false } = {}) {
    const headers = useEtag && this.refEtag ? { 'If-None-Match': this.refEtag } : {};
    const res = await this.api(`/git/ref/heads/${encodeURIComponent(this.branch)}`, { headers });
    if (res.status === 304) return { unchanged: true };
    if (res.status === 404 || res.status === 409) return { sha: null };
    const j = await this.json(res, 'ref');
    this.refEtag = res.headers.get('etag');
    return { sha: j.object.sha };
  }

  async ensureBranch() {
    const h = await this.headSha();
    if (h.sha) return h.sha;
    // repo vuoto o branch inesistente
    const repoRes = await this.api('');
    const repo = await this.json(repoRes, 'repo');
    const defRes = await this.api(`/git/ref/heads/${encodeURIComponent(repo.default_branch)}`);
    if (defRes.ok && repo.default_branch !== this.branch) {
      const def = await defRes.json();
      await this.json(await this.api('/git/refs', { method: 'POST', body: { ref: `refs/heads/${this.branch}`, sha: def.object.sha } }), 'create branch');
      return (await this.headSha()).sha;
    }
    // repository completamente vuoto: il primo file si crea con la Contents API
    await this.json(await this.api(`/contents/${this.dir}/README.md`, {
      method: 'PUT',
      body: { message: 'Inizializza archivio dati 5a-essenzia', content: utf8ToB64('# Dati gestionale\n\nFile gestiti automaticamente dall\'app. Non modificare a mano.\n'), branch: this.branch },
    }), 'init');
    return (await this.headSha()).sha;
  }

  /** Carica tutte le collezioni. cache: {blobs: {path: sha}, data: {coll: value}} */
  async load(cache = {}) {
    const sha = await this.ensureBranch();
    const commit = await this.json(await this.api(`/git/commits/${sha}`), 'commit');
    const root = await this.json(await this.api(`/git/trees/${commit.tree.sha}`), 'tree');
    const dirEntry = root.tree.find(e => e.path === this.dir && e.type === 'tree');
    const blobs = {};
    const data = {};
    let files = [];
    if (dirEntry) {
      const t = await this.json(await this.api(`/git/trees/${dirEntry.sha}`), 'tree');
      files = t.tree;
    }
    const tasks = COLLECTIONS.map(async c => {
      const e = files.find(f => f.path === `${c}.json` && f.type === 'blob');
      if (!e) return;
      blobs[c] = e.sha;
      if (cache.blobs?.[c] === e.sha && cache.data?.[c] !== undefined) { data[c] = cache.data[c]; return; }
      const b = await this.json(await this.api(`/git/blobs/${e.sha}`), 'blob');
      data[c] = JSON.parse(b64ToUtf8(b.content));
    });
    await Promise.all(tasks);
    return { head: sha, data, blobs };
  }

  /** Crea un commit atomico. files: [{path, text} | {path, base64} | {path, delete:true}] (path relativo a dir). */
  async commit(parentSha, files, message) {
    const parent = await this.json(await this.api(`/git/commits/${parentSha}`), 'commit');
    const tree = [];
    for (const f of files) {
      const path = `${this.dir}/${f.path}`;
      if (f.delete) tree.push({ path, mode: '100644', type: 'blob', sha: null });
      else if (f.base64 !== undefined) {
        const blob = await this.json(await this.api('/git/blobs', { method: 'POST', body: { content: f.base64, encoding: 'base64' } }), 'blob');
        tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      } else tree.push({ path, mode: '100644', type: 'blob', content: f.text });
    }
    const newTree = await this.json(await this.api('/git/trees', { method: 'POST', body: { base_tree: parent.tree.sha, tree } }), 'tree');
    const c = await this.json(await this.api('/git/commits', { method: 'POST', body: { message, tree: newTree.sha, parents: [parentSha] } }), 'commit');
    const res = await this.api(`/git/refs/heads/${encodeURIComponent(this.branch)}`, { method: 'PATCH', body: { sha: c.sha, force: false } });
    if (res.status === 422 || res.status === 409) throw new ConflictError();
    await this.json(res, 'update ref');
    // blob sha dei file JSON scritti (per la cache), calcolati localmente come fa git
    const blobs = {};
    for (const f of files) {
      const m = f.path.match(/^([a-z]+)\.json$/);
      if (m && f.text !== undefined) blobs[m[1]] = await gitBlobSha(f.text);
    }
    return { head: c.sha, blobs };
  }

  async readFile(rel) {
    const path = `${this.dir}/${rel}`;
    const res = await this.api(`/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(this.branch)}`, { raw: true });
    if (!res.ok) await this.json(res, 'file');
    return res.blob();
  }

  async testAccess() {
    const r = await this.api('');
    const j = await this.json(r, 'repo');
    if (j.permissions && !j.permissions.push) throw new AuthError('Il token può leggere ma non scrivere sul repository');
    return { private: j.private, fullName: j.full_name, defaultBranch: j.default_branch };
  }
}

export class LocalBackend {
  constructor() { this.kind = 'local'; }
  async load() {
    const data = (await kv.get('local:data')) || {};
    const head = (await kv.get('local:head')) || 'local-0';
    return { head, data, blobs: {} };
  }
  async commit(parentSha, files) {
    const head = (await kv.get('local:head')) || 'local-0';
    if (head !== parentSha) throw new ConflictError();
    const data = (await kv.get('local:data')) || {};
    for (const f of files) {
      const m = f.path.match(/^([a-z]+)\.json$/);
      if (m && !f.delete) data[m[1]] = JSON.parse(f.text);
      else if (f.delete) await kv.del('local:file:' + f.path);
      else if (f.base64 !== undefined) await kv.set('local:file:' + f.path, f.base64);
    }
    const next = 'local-' + (Number(head.split('-')[1] || 0) + 1);
    await kv.set('local:data', data);
    await kv.set('local:head', next);
    return { head: next, blobs: {} };
  }
  async headSha() { return { sha: (await kv.get('local:head')) || 'local-0' }; }
  async readFile(path) {
    const b64 = await kv.get('local:file:' + path);
    if (!b64) throw new Error('File non trovato');
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u]);
  }
  async testAccess() { return { local: true }; }
}
