/* Semua konten dimuat dari data/*.json lewat Store (lihat assets/js/store.js) */
const trails=Store.data.trails;
const REV_CATS=Store.data.site.reviewCategories.map(c=>c.name);
const REV_ICON=Object.fromEntries(Store.data.site.reviewCategories.map(c=>[c.name,c.icon]));
const MON=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const fmtDate=iso=>{const [y,m,d]=String(iso).split('-');return `${d} ${MON[+m-1]} ${y}`};
/* ulasan lama di localStorage hanya punya teks tanggal ("05 Okt 2026") → ubah ke ISO agar bisa diurutkan */
function normReview(r){if(!r.iso){const m=String(r.date||'').match(/(\d+)\s+(\S+)\s+(\d{4})/),mi=m?MON.findIndex(x=>x.toLowerCase()===m[2].toLowerCase()):-1;r.iso=m&&mi>=0?`${m[3]}-${String(mi+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`:'2026-01-01'}return r}
let userReviews=[];try{userReviews=JSON.parse(localStorage.getItem('sadalan_reviews')||'[]').map(normReview)}catch(e){}
const saveReviews=()=>{try{localStorage.setItem('sadalan_reviews',JSON.stringify(userReviews,(k,v)=>k==='_s'?undefined:v))}catch(x){}};
const allReviews=()=>[...userReviews,...REVIEW_SEED];
const stars=n=>'★'.repeat(n)+'☆'.repeat(5-n);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials=n=>String(n).trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'S';
const rfState={cat:'Spot',rating:0,img:''};
function reviewForm(){rfState.cat='Spot';rfState.rating=0;rfState.img='';showModal(`<div class="modal-content"><button type="button" class="back-btn" data-rv-back><i data-lucide="arrow-left"></i> Semua ulasan</button><span class="eyebrow dark">Ulasanmu</span><h3>Tulis ulasan</h3><p>Bagikan pengalamanmu tentang spot, tempat, gear, makanan, atau lainnya.</p><form id="reviewForm" class="review-form" novalidate><div class="field"><label>Kategori</label><div class="chip-row">${REV_CATS.map((c,i)=>`<button type="button" class="filter-btn ${i?'':'active'}" data-rcat="${c}">${c}</button>`).join('')}</div></div><div class="field"><label for="rfTitle">Nama yang diulas</label><input id="rfTitle" class="search-input" maxlength="80" placeholder="Contoh: Tenda dome 4 orang"></div><div class="field"><label for="rfLoc">Lokasi atau merek (opsional)</label><input id="rfLoc" class="search-input" maxlength="80" placeholder="Contoh: Gunung Prau, Dieng"></div><div class="field"><label>Penilaian</label><div class="star-input">${[1,2,3,4,5].map(n=>`<button type="button" data-star="${n}" aria-label="${n} bintang">★</button>`).join('')}</div></div><div class="field"><label for="rfText">Isi ulasan</label><textarea id="rfText" class="search-input" rows="4" maxlength="600" placeholder="Ceritakan pengalamanmu, kelebihan, dan kekurangannya"></textarea></div><div class="field"><label for="rfImg">Foto (opsional)</label><input id="rfImg" type="file" accept="image/*"><img id="rfPreview" class="form-preview" alt="Pratinjau foto" hidden></div><div class="field"><label for="rfName">Nama kamu</label><input id="rfName" class="search-input" maxlength="40" placeholder="Nama atau panggilan"></div><p class="form-error" id="rfError" hidden></p><button type="submit" class="primary-btn btn-block">Kirim ulasan</button></form></div>`)}
function readImage(file,cb){const fr=new FileReader();fr.onload=()=>{const im=new Image();im.onload=()=>{const k=Math.min(1,900/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);cb(c.toDataURL('image/jpeg',.8))};im.onerror=()=>cb('');im.src=fr.result};fr.onerror=()=>cb('');fr.readAsDataURL(file)}
/* ===== Reviews: modal daftar + modal detail, dengan pencarian & filter ===== */
const rvDefault=()=>({q:'',cat:'Semua',rating:'all',sort:'new'});
let rvState=rvDefault(),rvScroll=0;
const RV_RATING=[['all','Semua rating'],['5','5 bintang'],['4up','4 bintang ke atas'],['3down','3 bintang ke bawah']];
const RV_SORT=[['new','Terbaru'],['old','Terlama'],['high','Rating tertinggi'],['low','Rating terendah'],['az','Judul A–Z']];
const rvToks=()=>rvState.q.toLowerCase().trim().split(/\s+/).filter(Boolean);
/* teks pencarian = SEMUA isi ulasan: judul, kategori, lokasi, penulis, tanggal, ringkasan, isi lengkap, kelebihan, kekurangan, tag */
const rvHay=r=>r._s||(r._s=[r.title,r.cat,r.loc,r.author,fmtDate(r.iso),r.text,...(r.body||[]),...(r.pros||[]),...(r.cons||[]),...(r.tags||[])].join(' ').toLowerCase());
const rvRatingOk=r=>({all:true,'5':r.rating===5,'4up':r.rating>=4,'3down':r.rating<=3})[rvState.rating];
function rvFiltered(){
 const toks=rvToks();
 const list=allReviews().filter(r=>(rvState.cat==='Semua'||r.cat===rvState.cat)&&rvRatingOk(r)&&toks.every(t=>rvHay(r).includes(t)));
 const by={new:(a,b)=>b.iso.localeCompare(a.iso),old:(a,b)=>a.iso.localeCompare(b.iso),high:(a,b)=>b.rating-a.rating||b.iso.localeCompare(a.iso),low:(a,b)=>a.rating-b.rating||b.iso.localeCompare(a.iso),az:(a,b)=>a.title.localeCompare(b.title,'id')};
 return list.sort(by[rvState.sort]||by.new);
}
const rvIsFiltered=()=>rvState.q.trim()||rvState.cat!=='Semua'||rvState.rating!=='all'||rvState.sort!=='new';
function rvSnippet(r,toks){
 const low=r.text.toLowerCase();if(!toks.length||toks.some(t=>low.includes(t)))return r.text;
 const full=[r.text,...(r.body||[]),...(r.pros||[]),...(r.cons||[])].join(' '),lf=full.toLowerCase();
 const hits=toks.map(t=>lf.indexOf(t)).filter(i=>i>=0);if(!hits.length)return r.text;
 const st=Math.max(0,Math.min(...hits)-50);return(st?'…':'')+full.slice(st,st+150).trim()+'…';
}
function rvCard(r,toks){
 return `<article class="rv-card" data-review="${esc(r.id)}" tabindex="0" role="button" aria-label="Buka ulasan: ${esc(r.title)}"><div class="rv-thumb">${r.img?`<img src="${esc(r.img)}" alt="" loading="lazy">`:''}<span class="review-ph">${REV_ICON[r.cat]||'✨'}</span></div><div class="rv-main"><div class="rv-top"><span class="rv-cat">${hl(r.cat,toks)}</span><span class="stars" role="img" aria-label="Rating ${r.rating} dari 5">${stars(r.rating)}</span></div><h4>${hl(r.title,toks)}</h4><small class="review-loc">${hl(r.loc||'',toks)}</small><p>${hl(rvSnippet(r,toks),toks)}</p><div class="review-name"><span class="avatar">${esc(initials(r.author))}</span><b>${hl(r.author,toks)}</b><span class="review-date">${hl(fmtDate(r.iso),toks)}</span></div></div></article>`;
}
function drawRv(){
 const toks=rvToks(),list=rvFiltered();
 $('#rvCount').textContent=`${list.length} ulasan${rvState.cat!=='Semua'?' · '+rvState.cat:''}${toks.length?` · “${rvState.q.trim()}”`:''}`;
 $('#rvReset').hidden=!rvIsFiltered();
 $('#rvClear').hidden=!rvState.q;
 $('#rvResults').innerHTML=list.map(r=>rvCard(r,toks)).join('')||`<div class="empty rv-empty"><p>Tidak ada ulasan yang cocok${toks.length?` dengan “${esc(rvState.q.trim())}”`:''}.</p><button type="button" class="ghost-btn" data-rv-reset>Reset pencarian &amp; filter</button></div>`;
}
function openReviews(keep){
 if(!keep){rvState=rvDefault();rvScroll=0}
 const opt=(arr,cur)=>arr.map(([v,l])=>`<option value="${v}"${v===cur?' selected':''}>${l}</option>`).join('');
 showModal(`<div class="modal-content blog-modal"><span class="eyebrow dark">Ulasan komunitas</span><h3>Reviews</h3><p>Spot, tempat, gear, makanan, dan lainnya, dinilai langsung oleh pendaki.</p><div class="blog-tools"><div class="search-wrap"><i data-lucide="search"></i><input id="rvSearch" class="search-input" type="text" inputmode="search" enterkeyhint="search" autocomplete="off" value="${esc(rvState.q)}" placeholder="Cari judul, lokasi, penulis, isi ulasan…" aria-label="Cari ulasan"><button type="button" class="search-clear" id="rvClear" aria-label="Hapus pencarian" hidden><i data-lucide="x"></i></button></div><div class="filter-row" role="group" aria-label="Filter kategori ulasan">${['Semua',...REV_CATS].map(c=>`<button type="button" class="filter-btn ${c===rvState.cat?'active':''}" data-rvcat="${c}">${c}</button>`).join('')}</div><div class="rv-filters"><label><span>Rating</span><select id="rvRating">${opt(RV_RATING,rvState.rating)}</select></label><label><span>Urutkan</span><select id="rvSort">${opt(RV_SORT,rvState.sort)}</select></label></div></div><div class="blog-scroll rv-scroll"><div class="rv-countrow"><p class="blog-count" id="rvCount" aria-live="polite"></p><button type="button" class="text-btn" id="rvReset" hidden>Reset</button></div><div class="blog-list" id="rvResults"></div></div><div class="rv-foot"><button type="button" class="primary-btn btn-block" data-modal="add-review"><i data-lucide="pen-line"></i> Tulis ulasan</button></div></div>`,'sheet-reviews');
 drawRv();updateNav('reviews');
 if(keep)$('.rv-scroll').scrollTop=rvScroll;
}
function openReview(id,from){
 const r=allReviews().find(x=>x.id===id);if(!r)return;
 const ft=from?trails.find(x=>x.id==from):null,sc=$('.rv-scroll');if(sc)rvScroll=sc.scrollTop;
 const list=(a)=>a&&a.length?`<ul>${a.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'';
 const paras=[r.text,...(r.body||[])].map(x=>`<p>${esc(x)}</p>`).join('');
 const pc=(r.pros&&r.pros.length)||(r.cons&&r.cons.length)?`<div class="rv-pc">${r.pros&&r.pros.length?`<div class="rv-pros"><b>👍 Kelebihan</b>${list(r.pros)}</div>`:''}${r.cons&&r.cons.length?`<div class="rv-cons"><b>👎 Kekurangan</b>${list(r.cons)}</div>`:''}</div>`:'';
 const tags=r.tags&&r.tags.length?`<div class="rv-tags">${r.tags.map(t=>`<span>#${esc(t)}</span>`).join('')}</div>`:'';
 showModal(`<div class="modal-content rv-detail">${ft?`<button type="button" class="back-btn" data-back-trail="${ft.id}"><i data-lucide="arrow-left"></i> ${esc(ft.name)}</button>`:`<button type="button" class="back-btn" data-rv-back><i data-lucide="arrow-left"></i> Semua ulasan</button>`}${r.img?`<img class="detail-img" src="${esc(r.img)}" alt="${esc(r.title)}">`:''}<span class="eyebrow dark">${REV_ICON[r.cat]||''} ${esc(r.cat)} · ${fmtDate(r.iso)}</span><h3>${esc(r.title)}</h3><div class="rate-row"><span class="stars" role="img" aria-label="Rating ${r.rating} dari 5">${stars(r.rating)}</span><b>${r.rating}/5</b></div>${r.loc?`<div class="rv-loc"><i data-lucide="map-pin"></i><span>${esc(r.loc)}</span></div>`:''}<div class="rv-full">${paras}</div>${pc}${tags}<div class="review-name rv-author"><span class="avatar">${esc(initials(r.author))}</span><span><b>${esc(r.author)}</b><small>Ditulis ${fmtDate(r.iso)}</small></span></div><button type="button" class="primary-btn btn-block" data-modal="add-review">Tulis ulasanmu</button></div>`,'sheet-detail');
 updateNav('reviews');
}
const heroes=Store.data.site.hero.slideTrailIds.map(id=>trails.find(t=>t.id===id)).filter(Boolean);
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
function icons(){if(window.lucide)lucide.createIcons()}
function trailCard(t){return `<article class="trail-card" data-trail="${t.id}" tabindex="0" role="button"><div class="trail-card-img"><img src="${esc(t.img)}" alt="${esc(t.name)}" loading="lazy"><span class="difficulty">${esc(t.difficulty)}</span></div><div class="trail-body"><h3>${esc(t.name)}</h3><div class="trail-meta"><span><i data-lucide="map-pin"></i>${esc(t.loc.split(',')[0])}</span><span class="rating">★ ${esc(t.rating)}</span></div><div class="trail-time" title="Estimasi waktu tempuh"><i data-lucide="clock"></i><span>Estimasi ${esc(t.time)}</span></div></div></article>`}
function render(){
 $('#heroSlides').innerHTML=heroes.map(t=>`<div class="swiper-slide hero-slide" data-trail="${t.id}" role="button" tabindex="0" aria-label="Buka detail ${esc(t.name)}"><img src="${esc(t.img)}" alt="${esc(t.name)}"><div class="hero-slide-content"><span class="eyebrow">${esc(t.difficulty)} • ${esc(t.elev)}</span><h3>${esc(t.name)}</h3><p>${esc(t.loc)} · ${esc(t.time)} · ${esc(t.rating)} ★</p><span class="hero-cta">Lihat detail <i data-lucide="arrow-right"></i></span></div></div>`).join('');
 $('#trailFilters').innerHTML=['Semua',...Store.data.site.trailCategories].map((x,i)=>`<button class="filter-btn ${i===0?'active':''}" data-filter="${x}">${x}</button>`).join('');
 drawTrails('Semua');
 icons();
 if(window.Swiper)new Swiper('.hero-swiper',{loop:true,autoplay:{delay:4200,disableOnInteraction:false},pagination:{el:'.swiper-pagination',clickable:true},spaceBetween:10});
}
function drawTrails(cat){const list=cat==='Semua'?trails:trails.filter(t=>t.cat===cat);$('#trailList').innerHTML=list.map(trailCard).join('');icons()}
function initMap(){
 const map=L.map('map',{scrollWheelZoom:false}).setView([-7.45,112.0],6);
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
 trails.forEach(t=>{const color=t.difficulty==='Mudah'?'#3f9b68':t.difficulty==='Menengah'?'#d49a39':'#bd5145';const marker=L.circleMarker([t.lat,t.lng],{radius:8,fillColor:color,color:'#fff',weight:2,fillOpacity:1}).addTo(map);marker.bindPopup(`<strong>${esc(t.name)}</strong><br>${esc(t.difficulty)} · ${esc(t.elev)}<br><button type="button" class="popup-btn" data-trail="${t.id}">Lihat detail →</button>`);marker.on('popupopen',()=>{$('.leaflet-popup-content .popup-btn')?.addEventListener('click',e=>{e.preventDefault();openTrail(t.id)})})});
}
const trailKey=t=>t.name.replace(/^Gunung\s+/i,'').toLowerCase();
function openTrail(id){const t=trails.find(x=>x.id==id);if(!t)return;
 const k=trailKey(t),revs=allReviews().filter(r=>rvHay(r).includes(k)),arts=(typeof BLOG_POSTS!=='undefined'?BLOG_POSTS:[]).filter(p=>p._s.includes(k)).slice(0,2);
 const relRev=revs.length?`<h4 class="rel-title">Ulasan terkait</h4><div class="modal-list">${revs.slice(0,3).map(r=>`<button type="button" data-review="${esc(r.id)}" data-from="${t.id}"><span class="rl-thumb">${r.img?`<img src="${esc(r.img)}" alt="">`:''}<i>${REV_ICON[r.cat]||'✨'}</i></span><span><b>${esc(r.title)}</b><span>${stars(r.rating)} · ${esc(r.author)} · ${fmtDate(r.iso)}</span></span></button>`).join('')}</div>${revs.length>3?`<button type="button" class="text-btn rel-more" data-rv-search="${esc(k)}">Lihat ${revs.length} ulasan “${esc(k)}” <i data-lucide="arrow-right"></i></button>`:''}`:'';
 const relArt=arts.length?`<h4 class="rel-title">Artikel terkait</h4><div class="blog-list">${arts.map(p=>blogCard(p,[])).join('')}</div>`:'';
 showModal(`<div class="modal-content"><img class="detail-img" src="${esc(t.img)}" alt="${esc(t.name)}"><span class="eyebrow dark">${esc(t.difficulty)} · ${esc(t.cat)}</span><h3>${esc(t.name)}</h3><p>${esc(t.loc)}. ${esc(t.desc)}</p><div class="detail-meta"><div><b>${esc(t.elev)}</b><span>Elevasi</span></div><div><b>${esc(t.dist)}</b><span>Jarak</span></div><div><b>${esc(t.time)}</b><span>Estimasi waktu</span></div></div><p><strong>Rating ${esc(t.rating)} ★</strong> · Jalur populer di komunitas Sadalan.</p>${relRev}${relArt}<button class="primary-btn btn-block" data-close-modal>Siap, lanjut jelajah</button></div>`)}
let lastFocus=null;
function showModal(html,cls=''){
 const w=$('#modalWrap'),sheet=$('.modal-sheet');if(w.hidden)lastFocus=document.activeElement;
 sheet.className='modal-sheet '+cls;$('#modalBody').innerHTML=html;
 /* footer kontak/sosial/copyright di bagian bawah setiap modal (modal berlayar-tetap: di ujung area scroll) */
 ($('#modalBody .blog-scroll')||$('#modalBody')).insertAdjacentHTML('beforeend',siteFooter('modal'));
 w.hidden=false;sheet.scrollTop=0;sheet.setAttribute('tabindex','-1');const hd=$('#modalBody h3');sheet.setAttribute('aria-label',hd?hd.textContent:'Dialog');
 [...document.body.children].forEach(el=>{if(el!==w&&el.tagName!=='SCRIPT')el.inert=true});document.body.style.overflow='hidden';icons();sheet.focus({preventScroll:true})}
function closeModal(){const w=$('#modalWrap');w.hidden=true;[...document.body.children].forEach(el=>{el.inert=false});document.body.style.overflow='';$('.modal-sheet').className='modal-sheet';if(['#blog','#reviews','#profile'].includes(location.hash))history.replaceState(null,'',location.pathname+location.search);if(lastFocus&&lastFocus.focus&&document.contains(lastFocus))lastFocus.focus({preventScroll:true});lastFocus=null;updateNav(curSection)}
function allTrails(){showModal(`<div class="modal-content"><span class="eyebrow dark">Koleksi Sadalan</span><h3>Semua Jejak</h3><p>Pilih rute dan buka detail perjalanan.</p><div class="modal-list">${trails.map(t=>`<button data-trail="${t.id}"><img src="${esc(t.img)}" alt=""><span><b>${esc(t.name)}</b><span>${esc(t.loc)} · ${esc(t.difficulty)} · ${esc(t.rating)} ★</span><span>Estimasi ${esc(t.time)}</span></span></button>`).join('')}</div></div>`)}
const blogState={cat:'Semua',q:''};
const blogToks=()=>blogState.q.toLowerCase().trim().split(/\s+/).filter(Boolean);
function hl(txt,toks){txt=String(txt);if(!toks.length)return esc(txt);const re=new RegExp('('+toks.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')','gi');return txt.split(re).map((x,i)=>i%2?`<mark class="hl">${esc(x)}</mark>`:esc(x)).join('')}
function blogSnippet(p,toks){const low=p.text.toLowerCase();if(!toks.length||toks.some(t=>low.includes(t)))return p.text;const body=blogPlain(p),lb=body.toLowerCase();const hits=toks.map(t=>lb.indexOf(t)).filter(i=>i>=0);if(!hits.length)return p.text;const st=Math.max(0,Math.min(...hits)-50);return(st?'…':'')+body.slice(st,st+150).trim()+'…'}
function blogCard(p,toks){return `<a class="blog-card" href="blog-detail.html?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener" aria-label="${esc(p.title)} (buka di tab baru)"><img src="${esc(p.img)}" alt="" loading="lazy"><div><small>${hl(p.cat,toks)} · ${blogDate(p.date)}</small><h3>${hl(p.title,toks)}</h3><p>${hl(blogSnippet(p,toks),toks)}</p></div></a>`}
function drawBlog(){
 const toks=blogToks(),list=BLOG_POSTS.filter(p=>(blogState.cat==='Semua'||p.cat===blogState.cat)&&toks.every(t=>p._s.includes(t)));
 $('#blogCount').textContent=list.length?`${list.length} artikel${blogState.cat!=='Semua'?' · '+blogState.cat:''}${toks.length?` · “${blogState.q.trim()}”`:''} — klik untuk membuka di tab baru`:'';
 $('#blogResults').innerHTML=list.map(p=>blogCard(p,toks)).join('')||`<p class="empty">Tidak ada artikel yang cocok${toks.length?` dengan “${esc(blogState.q.trim())}”`:''}. Coba kata kunci atau kategori lain.</p>`;
}
function openBlog(){
 blogState.cat='Semua';blogState.q='';
 showModal(`<div class="modal-content blog-modal"><span class="eyebrow dark">Jurnal Sadalan</span><h3>Blog</h3><p>Tips, cerita, dan inspirasi sebelum berangkat.</p><div class="blog-tools"><div class="search-wrap"><i data-lucide="search"></i><input id="blogSearch" class="search-input" type="text" inputmode="search" enterkeyhint="search" autocomplete="off" placeholder="Cari kategori, judul, atau isi artikel…" aria-label="Cari artikel blog"><button type="button" class="search-clear" id="blogClear" aria-label="Hapus pencarian" hidden><i data-lucide="x"></i></button></div><div class="filter-row" id="blogFilters" role="group" aria-label="Filter kategori blog">${['Semua',...BLOG_CATS].map((c,i)=>`<button type="button" class="filter-btn ${i?'':'active'}" data-bcat="${c}">${c}</button>`).join('')}</div></div><div class="blog-scroll"><p class="blog-count" id="blogCount" aria-live="polite"></p><div class="blog-list" id="blogResults"></div></div></div>`,'sheet-blog');
 drawBlog();updateNav('blog');
}
function search(){showModal(`<div class="modal-content"><span class="eyebrow dark">Cari Sadalan</span><h3>Temukan perjalanan</h3><input id="searchInput" class="search-input" placeholder="Cari gunung, kota, atau kategori..."><div id="searchResults" class="modal-list" style="margin-top:12px"></div></div>`);const inp=$('#searchInput');const draw=()=>{const q=inp.value.toLowerCase().trim();const arr=trails.filter(t=>(t.name+' '+t.loc+' '+t.cat).toLowerCase().includes(q));$('#searchResults').innerHTML=(q?arr:trails.slice(0,4)).map(t=>`<button data-trail="${t.id}"><img src="${esc(t.img)}" alt=""><span><b>${esc(t.name)}</b><span>${esc(t.loc)} · ${esc(t.difficulty)}</span><span>Estimasi ${esc(t.time)}</span></span></button>`).join('')||'<p>Tidak ditemukan.</p>'};inp.addEventListener('input',draw);draw()}
let curSection='home';
function updateNav(id){$$('.nav-item').forEach(b=>b.classList.toggle('active',(b.dataset.go||(['profile','blog','reviews'].includes(b.dataset.modal)?b.dataset.modal:''))===id))}
const PROFILE=Store.data.profile;
function openProfile(){showModal(`<div class="modal-content profile-modal"><span class="eyebrow dark">Profile</span><h3>${esc(PROFILE.title)}</h3><div class="profile-card"><div class="profile-head"><div class="profile-icon profile-logo"><img src="assets/images/logo.png" alt="Logo Sadalan"></div><div><span class="eyebrow">${esc(Store.data.site.name)}</span><h2>${esc(PROFILE.heading)}</h2></div></div><p>${esc(PROFILE.head)}</p></div><figure class="profile-photo"><img src="${esc(PROFILE.image)}" alt="${esc(PROFILE.imageAlt)}" loading="lazy"><figcaption>${esc(PROFILE.caption)}</figcaption></figure><div class="profile-detail">${PROFILE.body.map(x=>`<p>${esc(x)}</p>`).join('')}</div><div class="stats"><div><b>${trails.length}</b><span>Jejak</span></div><div><b>${allReviews().length}</b><span>Ulasan</span></div><div><b>${typeof BLOG_POSTS!=='undefined'?BLOG_POSTS.length:0}</b><span>Artikel</span></div></div></div>`);updateNav('profile')}
render();if(window.L)initMap();
$('#trailFilters').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;$$('#trailFilters .filter-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');drawTrails(b.dataset.filter)});
document.addEventListener('click',e=>{const go=e.target.closest('[data-go]');if(go){const id=go.dataset.go;document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'});curSection=id;updateNav(id);return}const trail=e.target.closest('[data-trail]');if(trail){openTrail(trail.dataset.trail);return}if(e.target.closest('[data-modal="all-trails"]')){allTrails();return}if(e.target.closest('[data-modal="blog"]')){openBlog();return}if(e.target.closest('[data-modal="reviews"]')){openReviews();return}if(e.target.closest('[data-modal="search"]')){search();return}if(e.target.closest('[data-modal="profile"]')){openProfile();return}if(e.target.closest('[data-close-modal]')){closeModal();return}});
const sections=['home','jejak','peta'].map(id=>document.getElementById(id));const observer=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){curSection=e.target.id;if($('#modalWrap').hidden)updateNav(curSection)}})},{rootMargin:'-35% 0px -55% 0px',threshold:0});sections.forEach(s=>observer.observe(s));

document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#modalWrap').hidden)closeModal();if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-trail][tabindex],[data-review][tabindex]')){e.preventDefault();e.target.click()}});
document.addEventListener('error',e=>{if(e.target.tagName==='IMG')e.target.classList.add('img-broken')},true);

document.addEventListener('click',e=>{
 if(e.target.closest('[data-rv-back]')){openReviews(true);return}
 const vc=e.target.closest('[data-rvcat]');if(vc){rvState.cat=vc.dataset.rvcat;$$('[data-rvcat]').forEach(x=>x.classList.toggle('active',x===vc));drawRv();$('.rv-scroll').scrollTop=0;return}
 if(e.target.closest('#rvClear')){const i=$('#rvSearch');i.value='';rvState.q='';drawRv();i.focus();return}
 if(e.target.closest('#rvReset')||e.target.closest('[data-rv-reset]')){rvState=rvDefault();openReviews(true);return}
 const bt=e.target.closest('[data-back-trail]');if(bt){openTrail(bt.dataset.backTrail);return}
 const rs=e.target.closest('[data-rv-search]');if(rs){rvState=rvDefault();rvState.q=rs.dataset.rvSearch;rvScroll=0;openReviews(true);return}
 const rv=e.target.closest('[data-review]');if(rv){openReview(rv.dataset.review,rv.dataset.from);return}
 if(e.target.closest('[data-modal="add-review"]')){reviewForm();return}
 const rc=e.target.closest('[data-rcat]');if(rc){rfState.cat=rc.dataset.rcat;$$('[data-rcat]').forEach(x=>x.classList.toggle('active',x===rc));return}
 const st=e.target.closest('[data-star]');if(st){rfState.rating=+st.dataset.star;$$('[data-star]').forEach(x=>x.classList.toggle('on',+x.dataset.star<=rfState.rating));return}
});
document.addEventListener('change',e=>{if(e.target.id!=='rfImg')return;const f=e.target.files[0],pv=$('#rfPreview');if(!f){rfState.img='';pv.hidden=true;return}readImage(f,d=>{rfState.img=d;pv.src=d;pv.hidden=!d})});
document.addEventListener('submit',e=>{if(e.target.id!=='reviewForm')return;e.preventDefault();
 const title=$('#rfTitle').value.trim(),text=$('#rfText').value.trim(),err=$('#rfError');
 const msg=!title?'Isi nama yang diulas.':!rfState.rating?'Pilih jumlah bintang.':text.length<10?'Tulis ulasan minimal 10 karakter.':'';
 if(msg){err.textContent=msg;err.hidden=false;return}
 const d=new Date(),iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 userReviews.unshift({id:'u'+Date.now(),cat:rfState.cat,title,loc:$('#rfLoc').value.trim(),rating:rfState.rating,author:$('#rfName').value.trim()||'Pendaki Sadalan',iso,img:rfState.img,text});
 saveReviews();
 rvState=rvDefault();rvScroll=0;openReviews(true); /* kembali ke daftar Reviews; ulasan baru tampil di paling atas */
});

/* ===== Blog: pencarian & filter kategori ===== */
document.addEventListener('input',e=>{if(e.target.id!=='blogSearch')return;blogState.q=e.target.value;$('#blogClear').hidden=!e.target.value;drawBlog();$('.blog-scroll').scrollTop=0});
document.addEventListener('click',e=>{
 const c=e.target.closest('[data-bcat]');if(c){blogState.cat=c.dataset.bcat;$$('[data-bcat]').forEach(x=>x.classList.toggle('active',x===c));drawBlog();$('.blog-scroll').scrollTop=0;return}
 if(e.target.closest('#blogClear')){const i=$('#blogSearch');i.value='';blogState.q='';$('#blogClear').hidden=true;drawBlog();i.focus()}
});
if(location.hash==='#blog')openBlog();else if(location.hash==='#reviews')openReviews();else if(location.hash==='#profile')openProfile();

/* ===== Reviews: pencarian, rating, urutan ===== */
document.addEventListener('input',e=>{if(e.target.id!=='rvSearch')return;rvState.q=e.target.value;drawRv();$('.rv-scroll').scrollTop=0});
document.addEventListener('change',e=>{
 if(e.target.id==='rvRating'){rvState.rating=e.target.value;drawRv();$('.rv-scroll').scrollTop=0}
 if(e.target.id==='rvSort'){rvState.sort=e.target.value;drawRv();$('.rv-scroll').scrollTop=0}
});

/* ===== Filter chip: bisa digeser dengan kursor (drag) di desktop; sentuhan tetap memakai scroll bawaan ===== */
(function(){
 let row=null,sx=0,sl=0,drag=false,moved=false;
 document.addEventListener('pointerdown',e=>{moved=false;if(e.pointerType!=='mouse'||e.button!==0)return;const r=e.target.closest('.filter-row');if(!r||r.scrollWidth<=r.clientWidth)return;row=r;sx=e.clientX;sl=r.scrollLeft;drag=false});
 document.addEventListener('pointermove',e=>{if(!row)return;const dx=e.clientX-sx;if(!drag&&Math.abs(dx)>5){drag=true;row.classList.add('dragging')}if(drag){row.scrollLeft=sl-dx;moved=true;e.preventDefault()}});
 const end=()=>{if(row)row.classList.remove('dragging');row=null;drag=false};
 document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);
 /* setelah drag, klik yang menyusul tidak boleh memilih chip */
 document.addEventListener('click',e=>{if(moved){e.stopPropagation();e.preventDefault();moved=false}},true);
 /* geser chip juga lewat roda mouse + Shift atau trackpad horizontal sudah bawaan; panah kiri/kanan saat chip fokus */
 document.addEventListener('keydown',e=>{if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;const r=e.target.closest&&e.target.closest('.filter-row');if(!r)return;const bs=[...r.querySelectorAll('.filter-btn')],i=bs.indexOf(e.target);if(i<0)return;const n=bs[i+(e.key==='ArrowRight'?1:-1)];if(n){n.focus();n.scrollIntoView({inline:'nearest',block:'nearest'});e.preventDefault()}});
})();
