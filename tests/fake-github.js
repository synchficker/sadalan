'use strict';
/* Emulator GitHub REST API (in-memory) — hanya endpoint yang dipakai CMS:
   user, repo, contents (baca/daftar), git refs/commits/blobs/trees. Dipakai uji Node dan uji browser. */
const crypto = require('crypto');
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');

class FakeGithub {
  /* tokens: 'rw' = admin penuh · 'push' = bisa commit tetapi bukan admin repositori · 'ro' = hanya baca
     ownerType: 'Organization' (peran bisa dipilih) atau 'User' (repositori pribadi: semua kolaborator = tulis) */
  constructor(files, { owner = 'acme', repo = 'sadalan', ownerType = 'Organization', tokens = { 'good-token': 'rw', 'ro-token': 'ro', 'push-token': 'push' } } = {}) {
    this.owner = owner; this.repo = repo; this.tokens = tokens; this.ownerType = ownerType;
    this.knownUsers = { budi: 'Budi Santoso', siti: 'Siti Rahma', andi: 'Andi Pratama', rina: 'Rina Wulandari', dewi: 'Dewi Lestari', acme: 'Acme' };
    this.collabs = ownerType === 'Organization'
      ? [{ login: 'budi', role: 'admin' }, { login: 'siti', role: 'write' }, { login: 'andi', role: 'read' }]
      : [{ login: owner, role: 'admin' }, { login: 'budi', role: 'write' }];
    this.invites = ownerType === 'Organization' ? [{ id: 501, login: 'rina', role: 'write', created_at: '2026-10-01T08:00:00Z' }] : [];
    this.nextInvite = 600; this.userLog = [];
    this.trees = new Map(); this.commits = new Map(); this.blobs = new Map();
    const snap = new Map(Object.entries(files).map(([p, c]) => [p, Buffer.from(c)]));
    const t = this._tree(snap);
    const c = this._commit(t, [], 'Initial commit');
    this.head = c; this.log = [];
    this.beforePatch = null; // hook untuk mensimulasikan push bersamaan
  }
  _tree(snap) { const id = sha('t' + [...snap].map(([p, b]) => p + sha(b)).join()); this.trees.set(id, snap); return id; }
  _commit(tree, parents, message) { const id = sha('c' + tree + parents + message + Math.random()); this.commits.set(id, { tree, parents, message }); return id; }
  get files() { return this.trees.get(this.commits.get(this.head).tree); }
  text(p) { const b = this.files.get(p); return b ? b.toString('utf8') : null; }

  /* req: { method, url, headers, body } → { status, headers, body } */
  handle({ method, url, headers = {}, body }) {
    const u = new URL(url); const p = u.pathname;
    const json = (status, obj, h = {}) => ({ status, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4000', ...h }, body: JSON.stringify(obj) });
    const m = /^Bearer (.+)$/.exec(headers.authorization || headers.Authorization || '');
    const level = m && this.tokens[m[1]];
    if (!level) return json(401, { message: 'Bad credentials' });
    let um;
    if ((um = /^\/users\/([\w-]+)$/.exec(p))) { const l = Object.keys(this.knownUsers).find((k) => k.toLowerCase() === um[1].toLowerCase()); return l ? json(200, { login: l, name: this.knownUsers[l], type: 'User', avatar_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }) : json(404, { message: 'Not Found' }); }
    if (p === '/user') return json(200, { login: 'budi', name: 'Budi Santoso', avatar_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' });
    const base = `/repos/${this.owner}/${this.repo}`;
    if (!p.startsWith(base)) return json(404, { message: 'Not Found' });
    if (level === 'none') return json(404, { message: 'Not Found' });
    const rest = p.slice(base.length);
    const write = method !== 'GET';
    if (write && level === 'ro') return json(403, { message: 'Resource not accessible by personal access token' });
    const body_ = body ? JSON.parse(body) : null;

    if (rest === '') return json(200, { full_name: `${this.owner}/${this.repo}`, default_branch: 'main', private: false, owner: { login: this.owner, type: this.ownerType }, permissions: { push: true, admin: level === 'rw' } });
    /* ---- pengguna: kolaborator & undangan (tanpa commit) ---- */
    if (/^\/(collaborators|invitations)/.test(rest)) {
      if (level === 'push' && (write || rest.startsWith('/invitations'))) return json(403, { message: 'Must have admin rights to Repository.' });
      const av = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
      const perm = (role) => ({ admin: role === 'admin', maintain: role === 'maintain', push: ['write', 'maintain', 'admin'].includes(role), triage: role === 'triage', pull: true });
      let m2;
      if (rest.startsWith('/collaborators') && method === 'GET' && rest === '/collaborators') return json(200, this.collabs.map((c) => ({ login: c.login, avatar_url: av, html_url: 'https://github.com/' + c.login, role_name: c.role, permissions: perm(c.role) })));
      if ((m2 = /^\/collaborators\/([\w-]+)$/.exec(rest))) {
        const login = Object.keys(this.knownUsers).find((k) => k.toLowerCase() === m2[1].toLowerCase());
        if (method === 'PUT') {
          if (!login) return json(404, { message: 'Not Found' });
          if (login.toLowerCase() === this.owner.toLowerCase()) return json(422, { message: 'Validation Failed' });
          const want = this.ownerType === 'Organization' ? ({ pull: 'read', push: 'write', admin: 'admin' }[body_ && body_.permission] || 'write') : 'write';
          const ex = this.collabs.find((c) => c.login === login);
          this.userLog.push(`PUT ${login} ${want}`);
          if (ex) { ex.role = want; return { status: 204, headers: {}, body: '' }; }
          if (this.invites.some((i) => i.login === login)) return json(422, { message: 'Validation Failed' });
          const inv = { id: this.nextInvite++, login, role: want, created_at: new Date().toISOString() }; this.invites.push(inv);
          return json(201, { id: inv.id, invitee: { login }, permissions: want });
        }
        if (method === 'DELETE') {
          const i = this.collabs.findIndex((c) => c.login.toLowerCase() === m2[1].toLowerCase());
          if (i < 0) return json(404, { message: 'Not Found' });
          if (this.collabs[i].login.toLowerCase() === this.owner.toLowerCase()) return json(422, { message: 'Validation Failed' });
          this.userLog.push(`DELETE ${this.collabs[i].login}`); this.collabs.splice(i, 1); return { status: 204, headers: {}, body: '' };
        }
      }
      if (rest === '/invitations' && method === 'GET') return json(200, this.invites.map((i) => ({ id: i.id, invitee: { login: i.login, avatar_url: av }, permissions: i.role, created_at: i.created_at, inviter: { login: 'budi' }, html_url: 'https://github.com/' + this.owner + '/' + this.repo + '/invitations' })));
      if ((m2 = /^\/invitations\/(\d+)$/.exec(rest)) && method === 'DELETE') {
        const i = this.invites.findIndex((x) => x.id === Number(m2[1])); if (i < 0) return json(404, { message: 'Not Found' });
        this.userLog.push(`CANCEL ${this.invites[i].login}`); this.invites.splice(i, 1); return { status: 204, headers: {}, body: '' };
      }
      return json(404, { message: 'Not Found' });
    }
    let r;
    if ((r = /^\/contents\/(.+)$/.exec(rest))) {
      const path = decodeURIComponent(r[1]);
      const f = this.files.get(path);
      if (f) return /raw/.test(headers.accept || headers.Accept || '') ? { status: 200, headers: { 'content-type': 'text/plain' }, body: f.toString('utf8') } : json(200, { type: 'file', path, sha: sha(f) });
      const kids = [...this.files].filter(([k]) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'));
      if (!kids.length) return json(404, { message: 'Not Found' });
      return json(200, kids.map(([k, b]) => ({ type: 'file', name: k.split('/').pop(), path: k, size: b.length, download_url: `data:image/webp;base64,${b.toString('base64')}` })));
    }
    if (rest === `/git/ref/heads/main`) return json(200, { object: { sha: this.head } });
    if ((r = /^\/git\/commits\/(\w+)$/.exec(rest)) && method === 'GET') { const c = this.commits.get(r[1]); return c ? json(200, { sha: r[1], tree: { sha: c.tree } }) : json(404, { message: 'Not Found' }); }
    if (rest === '/git/blobs' && method === 'POST') {
      const buf = body_.encoding === 'base64' ? Buffer.from(body_.content, 'base64') : Buffer.from(body_.content);
      const id = sha(buf); this.blobs.set(id, buf); return json(201, { sha: id });
    }
    if (rest === '/git/trees' && method === 'POST') {
      const snap = new Map(this.trees.get(body_.base_tree));
      for (const e of body_.tree) {
        if (e.sha === null) snap.set(e.path, null), snap.delete(e.path);
        else if (e.content != null) snap.set(e.path, Buffer.from(e.content));
        else if (this.blobs.has(e.sha)) snap.set(e.path, this.blobs.get(e.sha));
        else return json(422, { message: 'Invalid tree sha' });
      }
      return json(201, { sha: this._tree(snap) });
    }
    if (rest === '/git/commits' && method === 'POST') return json(201, { sha: this._commit(body_.tree, body_.parents, body_.message) });
    if (rest === '/git/refs/heads/main' && method === 'PATCH') {
      if (this.beforePatch) { const f = this.beforePatch; this.beforePatch = null; f(this); }
      const c = this.commits.get(body_.sha);
      if (!c || c.parents[0] !== this.head) return json(422, { message: 'Update is not a fast forward' });
      this.head = body_.sha; this.log.push(c.message); return json(200, { object: { sha: this.head } });
    }
    return json(404, { message: 'Not Found' });
  }
}

/* Memasang emulator sebagai global fetch (untuk uji Node). */
function installFetch(fake) {
  const orig = global.fetch;
  global.fetch = async (url, init = {}) => {
    const hdr = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const out = fake.handle({ method: init.method || 'GET', url: String(url), headers: hdr, body: init.body });
    return new Response(out.status === 204 ? null : out.body, { status: out.status, headers: out.headers });
  };
  return () => { global.fetch = orig; };
}
module.exports = { FakeGithub, installFetch };
