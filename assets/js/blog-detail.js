(function(){
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials=n=>String(n).trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'S';
const id=new URLSearchParams(location.search).get('id');
const p=BLOG_POSTS.find(x=>x.id===id);
const root=$('#article');

document.addEventListener('error',e=>{if(e.target.tagName==='IMG')e.target.classList.add('img-broken')},true);

if(!p){
  document.title='Artikel tidak ditemukan — '+Store.data.site.name;
  root.innerHTML='<div class="article-missing"><span class="eyebrow dark">404</span><h1>Artikel tidak ditemukan</h1><p>Tautan yang kamu buka mungkin salah atau artikelnya sudah dipindahkan.</p><a class="primary-btn" href="index.html#blog">Lihat semua artikel</a></div>';
  return;
}

document.title=p.title+' — '+Store.data.site.name;
const md=document.querySelector('meta[name="description"]');if(md)md.content=p.text;

const blocks=p.body.map((b,i)=>{
  if(typeof b==='string')return `<p${i===0?' class="article-lead"':''}>${esc(b)}</p>`;
  if(b.h)return `<h2>${esc(b.h)}</h2>`;
  if(b.ul)return `<ul>${b.ul.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
  if(b.q)return `<blockquote>${esc(b.q)}</blockquote>`;
  return '';
}).join('');

root.innerHTML=`<div class="article-hero"><img src="${esc(p.img)}" alt="${esc(p.title)}"></div>
<div class="article-wrap">
  <span class="article-cat">${esc(p.cat)}</span>
  <h1>${esc(p.title)}</h1>
  <div class="article-meta"><span class="avatar">${esc(initials(p.author))}</span><b>${esc(p.author)}</b><span>·</span><time datetime="${p.date}">${blogDate(p.date)}</time><span>·</span><span>${blogRead(p)} menit baca</span></div>
  <div class="article-body">${blocks}</div>
  <div class="article-actions"><button type="button" class="primary-btn" id="copyLink">Salin tautan</button><a class="ghost-btn" href="index.html#blog">Cari artikel lain</a></div>
</div>`;

$('#copyLink').addEventListener('click',async e=>{
  const b=e.currentTarget;
  try{await navigator.clipboard.writeText(location.href);b.textContent='Tautan disalin ✓'}
  catch(_){const t=document.createElement('textarea');t.value=location.href;document.body.appendChild(t);t.select();try{document.execCommand('copy');b.textContent='Tautan disalin ✓'}catch(__){b.textContent='Salin manual dari address bar'}t.remove()}
  setTimeout(()=>{b.textContent='Salin tautan'},2200);
});

/* Artikel terkait: kategori yang sama dulu, lalu sisanya */
const rel=[...BLOG_POSTS.filter(x=>x.id!==p.id&&x.cat===p.cat),...BLOG_POSTS.filter(x=>x.id!==p.id&&x.cat!==p.cat)].slice(0,3);
if(rel.length){
  const r=$('#related');r.hidden=false;
  r.innerHTML=`<h2>Baca juga</h2><div class="blog-list">${rel.map(x=>`<a class="blog-card" href="blog-detail.html?id=${encodeURIComponent(x.id)}"><img src="${esc(x.img)}" alt="" loading="lazy"><div><small>${esc(x.cat)} · ${blogDate(x.date)}</small><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p></div></a>`).join('')}</div>`;
}
})();
