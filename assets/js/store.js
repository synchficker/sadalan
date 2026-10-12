/* Store — lapisan data publik Sadalan.
   Semua konten dibaca dari data/*.json (satu sumber untuk situs publik & CMS).
   Store.boot([...skrip]) memuat data lebih dulu, mengisi elemen bertanda data-cms, lalu menjalankan skrip halaman berurutan.
   Penulisan (tambah/ubah/hapus) tidak dilakukan di sini, tetapi lewat halaman admin (admin/) yang meng-commit ke repositori GitHub. */
const Store=(()=>{
  const NAMES=['site','trails','reviews','blog','profile'];
  const data={};
  const get=(obj,path)=>String(path).split('.').reduce((o,k)=>o==null?o:o[k],obj);

  async function load(){
    const res=await Promise.all(NAMES.map(async n=>{
      const r=await fetch(`data/${n}.json`,{cache:'no-cache'});
      if(!r.ok)throw new Error(`data/${n}.json (${r.status})`);
      return r.json();
    }));
    NAMES.forEach((n,i)=>{data[n]=res[i]});
    return data;
  }

  /* data-cms="site.name"            → isi teks elemen
     data-cms-attr="content:site.description" → isi atribut elemen
     <html data-cms-title="{site.name} — {site.tagline}"> → judul tab */
  function bind(root=document){
    root.querySelectorAll('[data-cms]').forEach(el=>{const v=get(data,el.dataset.cms);if(typeof v==='string')el.textContent=v});
    root.querySelectorAll('[data-cms-attr]').forEach(el=>{const [a,p]=el.dataset.cmsAttr.split(':');const v=get(data,p);if(a&&typeof v==='string')el.setAttribute(a,v)});
    const t=document.documentElement.dataset.cmsTitle;
    if(t)document.title=t.replace(/\{([^}]+)\}/g,(_,p)=>{const v=get(data,p);return v==null?'':v});
  }

  const loadScript=src=>new Promise((ok,fail)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>fail(new Error('Gagal memuat '+src));document.body.appendChild(s)});

  function fail(e){
    console.error(e);
    const d=document.createElement('div');d.setAttribute('role','alert');
    d.style.cssText='margin:24px auto;max-width:520px;padding:16px 18px;border-radius:14px;background:#fff4e5;color:#5c3b00;font:14px/1.5 system-ui,sans-serif';
    d.innerHTML='<b>Konten belum bisa dimuat.</b><br>Situs membaca data dari file JSON, jadi harus dibuka lewat server (bukan klik dua kali pada file HTML). Jalankan <code>npm start</code>, lalu buka <code>http://localhost:3000</code> — atau lihat situs yang sudah dipublikasikan di GitHub Pages.';
    document.body.prepend(d);
  }

  async function boot(scripts){
    try{await load();bind();for(const s of scripts)await loadScript(s)}catch(e){fail(e)}
  }

  return {data,load,bind,boot,get};
})();
