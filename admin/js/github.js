/* Gh — klien GitHub REST API untuk CMS Sadalan (tanpa server).
   Login = Personal Access Token. Semua perubahan berupa commit ke repositori; GitHub Pages lalu menerbitkan ulang situs.
   Penulisan beberapa berkas sekaligus memakai Git Data API sehingga satu aksi = satu commit atomik. */
const Gh = (() => {
  const API = 'https://api.github.com';
  const DATA = ['site', 'trails', 'reviews', 'blog', 'profile', 'logistics'];
  const OPTIONAL = { logistics: () => (typeof Logistics !== 'undefined' ? Logistics : require('../../assets/js/logistics.js')).defaults() }; // berkas yang boleh belum ada di repositori lama: dipakai nilai bawaan, dibuat saat pertama disimpan
  let c = null; // { owner, repo, branch, token }

  class GhError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  const repoPath = () => `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;

  async function api(path, { method = 'GET', body, raw = false, allow = [], map = null } = {}) {
    let r;
    try {
      r = await fetch(API + path, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: 'Bearer ' + c.token,
          Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new GhError('Tidak bisa terhubung ke GitHub. Periksa koneksi internet Anda.', 0);
    }
    if (!r.ok && !allow.includes(r.status)) {
      const e = await toError(r);
      /* map: pesan khusus per status (hanya 403/404/422; 401 & batas permintaan tetap memakai pesan umum) */
      if (map && map[e.status] && e.status !== 401 && !/Batas permintaan/.test(e.message)) throw new GhError(map[e.status], e.status);
      throw e;
    }
    if (allow.includes(r.status) && !r.ok) return null;
    if (r.status === 204) return null;
    return raw ? r.text() : r.json();
  }

  async function toError(r) {
    let msg = '';
    try { msg = (await r.json()).message || ''; } catch { /* abaikan */ }
    const limited = r.headers.get('x-ratelimit-remaining') === '0';
    if (r.status === 401) return new GhError('Token ditolak GitHub (salah, dicabut, atau sudah kedaluwarsa).', 401);
    if (r.status === 403 && limited) return new GhError('Batas permintaan GitHub tercapai. Tunggu beberapa menit lalu coba lagi.', 403);
    if (r.status === 403) return new GhError('Token tidak punya izin menulis. Buat token dengan akses "Contents: Read and write" pada repositori ini.', 403);
    if (r.status === 404) return new GhError('Repositori atau berkas tidak ditemukan, atau token tidak punya akses ke repositori ini.', 404);
    if (r.status === 409 || (r.status === 422 && /fast.?forward/i.test(msg))) return new GhError('Ada perubahan lain di repositori saat Anda menyimpan. Coba simpan sekali lagi.', 409);
    if (r.status === 422 && /protected|rule/i.test(msg)) return new GhError('Branch dilindungi: token tidak boleh push langsung. Izinkan push atau gunakan branch lain.', 422);
    return new GhError(msg || `GitHub mengembalikan kesalahan ${r.status}.`, r.status);
  }

  /* Menentukan owner/repo dari alamat GitHub Pages: https://OWNER.github.io/REPO/admin/ */
  function detect(loc = location) {
    const host = loc.hostname.toLowerCase();
    if (!host.endsWith('.github.io')) return null;
    const owner = host.slice(0, -'.github.io'.length);
    const seg = loc.pathname.split('/').filter(Boolean);
    const i = seg.lastIndexOf('admin');
    const before = i >= 0 ? seg.slice(0, i) : seg.filter((s) => !/\.\w+$/.test(s));
    return { owner, repo: before[0] || `${owner}.github.io` };
  }

  /* Mengembalikan { user, repo, branch }; melempar GhError bila token/akses/struktur situs salah. */
  async function connect({ owner, repo, branch, token }) {
    c = { owner: owner.trim(), repo: repo.trim(), branch: (branch || '').trim(), token: token.trim() };
    if (!c.token) throw new GhError('Token wajib diisi.', 0);
    if (!/^[\w.-]+$/.test(c.owner) || !/^[\w.-]+$/.test(c.repo)) throw new GhError('Nama pemilik/repositori tidak valid.', 0);
    try {
      const user = await api('/user');
      const info = await api(repoPath());
      if (info.permissions && info.permissions.push === false) throw new GhError('Akun ini tidak punya hak tulis (push) di repositori tersebut.', 403);
      if (!c.branch) c.branch = info.default_branch;
      const probe = await api(`${repoPath()}/contents/data/site.json?ref=${encodeURIComponent(c.branch)}`, { allow: [404] });
      if (!probe) throw new GhError(`Berkas data/site.json tidak ada di branch "${c.branch}". Pastikan ini repositori situs Sadalan.`, 404);
      c.ownerType = (info.owner && info.owner.type) || 'User';
      c.ownerLogin = (info.owner && info.owner.login) || c.owner;
      return { user: { login: user.login, name: user.name || user.login, avatar: user.avatar_url }, repo: info.full_name, branch: c.branch, isPrivate: !!info.private,
        ownerLogin: c.ownerLogin, ownerType: c.ownerType, canAdmin: !!(info.permissions && info.permissions.admin) };
    } catch (e) { c = null; throw e; }
  }

  const disconnect = () => { c = null; };
  const ctx = () => c && { owner: c.owner, repo: c.repo, branch: c.branch, ownerType: c.ownerType, ownerLogin: c.ownerLogin };

  async function readText(path) {
    return api(`${repoPath()}/contents/${enc(path)}?ref=${encodeURIComponent(c.branch)}`, { raw: true });
  }

  /* Membaca seluruh data/*.json terbaru langsung dari repositori (bukan dari cache Pages). */
  async function readData() {
    const texts = {}, data = {};
    await Promise.all(DATA.map(async (n) => {
      try { texts[n] = await readText(`data/${n}.json`); }
      catch (e) { if (OPTIONAL[n] && e && e.status === 404) { texts[n] = ''; data[n] = OPTIONAL[n](); return; } throw e; }
      try { data[n] = JSON.parse(texts[n]); } catch { throw new GhError(`data/${n}.json di repositori bukan JSON yang valid.`, 0); }
    }));
    return { data, texts };
  }

  /* Daftar berkas dalam folder (kosong bila folder belum ada). */
  async function list(dir) {
    const r = await api(`${repoPath()}/contents/${enc(dir)}?ref=${encodeURIComponent(c.branch)}`, { allow: [404] });
    return Array.isArray(r) ? r.filter((f) => f.type === 'file') : [];
  }

  /* files: [{ path, text } | { path, base64 } | { path, remove: true }] → satu commit. */
  async function commit({ message, files }) {
    if (!files.length) return null;
    const ref = await api(`${repoPath()}/git/ref/heads/${enc(c.branch)}`);
    const parent = ref.object.sha;
    const base = (await api(`${repoPath()}/git/commits/${parent}`)).tree.sha;
    const tree = [];
    for (const f of files) {
      if (f.remove) tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
      else if (f.base64 != null) {
        const b = await api(`${repoPath()}/git/blobs`, { method: 'POST', body: { content: f.base64, encoding: 'base64' } });
        tree.push({ path: f.path, mode: '100644', type: 'blob', sha: b.sha });
      } else tree.push({ path: f.path, mode: '100644', type: 'blob', content: f.text });
    }
    const t = await api(`${repoPath()}/git/trees`, { method: 'POST', body: { base_tree: base, tree } });
    const cm = await api(`${repoPath()}/git/commits`, { method: 'POST', body: { message, tree: t.sha, parents: [parent] } });
    await api(`${repoPath()}/git/refs/heads/${enc(c.branch)}`, { method: 'PATCH', body: { sha: cm.sha, force: false } });
    return cm.sha;
  }

  /* ================= pengguna = kolaborator repositori =================
     Siapa yang boleh mengedit CMS = siapa yang punya akses tulis (push) ke repositori ini.
     Tidak ada commit: perubahan langsung berlaku di GitHub. Butuh token dengan izin Administration (Read and write). */
  const ADMIN_DENIED = 'Token belum punya izin mengelola pengguna. Buat token dengan izin “Administration: Read and write” dan pastikan akun Anda admin repositori ini.';
  const roleOf = (p) => (p.admin ? 'admin' : p.maintain ? 'maintain' : p.push ? 'write' : p.triage ? 'triage' : 'read');
  const INVITE_ROLE = { read: 'read', pull: 'read', triage: 'triage', write: 'write', push: 'write', maintain: 'maintain', admin: 'admin' };

  /* Daftar kolaborator (semua halaman, maks 500). */
  async function listCollaborators() {
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const r = await api(`${repoPath()}/collaborators?affiliation=all&per_page=100&page=${page}`, { map: { 403: ADMIN_DENIED, 404: ADMIN_DENIED } });
      (r || []).forEach((u) => {
        const perms = u.permissions || {};
        out.push({ login: u.login, avatar: u.avatar_url, url: u.html_url, role: u.role_name && INVITE_ROLE[u.role_name] ? INVITE_ROLE[u.role_name] : roleOf(perms), canPush: !!(perms.push || perms.admin || perms.maintain) });
      });
      if (!r || r.length < 100) break;
    }
    return out;
  }

  /* Undangan yang belum diterima. */
  async function listInvitations() {
    const r = await api(`${repoPath()}/invitations?per_page=100`, { map: { 403: ADMIN_DENIED, 404: ADMIN_DENIED } });
    return (r || []).map((i) => ({ id: i.id, login: i.invitee && i.invitee.login, avatar: i.invitee && i.invitee.avatar_url, url: i.html_url, role: INVITE_ROLE[i.permissions] || 'read', createdAt: i.created_at, inviter: i.inviter && i.inviter.login }));
  }

  /* Memeriksa akun GitHub sebelum mengundang. */
  async function lookupUser(login) {
    if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) throw new GhError('Username GitHub tidak valid.', 0);
    const u = await api(`/users/${encodeURIComponent(login)}`, { allow: [404] });
    if (!u) throw new GhError(`Akun GitHub “${login}” tidak ditemukan.`, 404);
    return { login: u.login, name: u.name || u.login, avatar: u.avatar_url, type: u.type };
  }

  /* Mengundang pengguna baru atau mengubah peran. permission: pull | push | admin (diabaikan di repositori pribadi). */
  async function setCollaborator(login, permission) {
    const body = c.ownerType === 'Organization' ? { permission } : undefined;
    const r = await api(`${repoPath()}/collaborators/${encodeURIComponent(login)}`, {
      method: 'PUT', body: body || {},
      map: { 403: ADMIN_DENIED, 404: ADMIN_DENIED, 422: 'GitHub menolak undangan ini. Mungkin akun itu pemilik repositori, sudah diundang, atau tidak bisa diundang.' },
    });
    return { invited: !!(r && r.id), invitationId: r && r.id };
  }

  async function removeCollaborator(login) {
    await api(`${repoPath()}/collaborators/${encodeURIComponent(login)}`, { method: 'DELETE', map: { 403: ADMIN_DENIED, 404: 'Pengguna ini sudah tidak ada di daftar. Muat ulang halaman.', 422: 'Pengguna ini tidak bisa dicabut aksesnya (mis. pemilik repositori).' } });
  }

  async function cancelInvitation(id) {
    await api(`${repoPath()}/invitations/${encodeURIComponent(id)}`, { method: 'DELETE', map: { 403: ADMIN_DENIED, 404: 'Undangan ini sudah tidak ada. Muat ulang halaman.' } });
  }

  return { connect, disconnect, ctx, detect, readText, readData, list, commit, listCollaborators, listInvitations, lookupUser, setCollaborator, removeCollaborator, cancelInvitation, GhError, DATA };
})();
if (typeof module === 'object' && module.exports) module.exports = Gh;
