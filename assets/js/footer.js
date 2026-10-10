/* Footer Sadalan (kontak, sosial media, copyright) — satu sumber untuk semua halaman & modal.
   Ubah data di SITE di bawah ini; footer di index.html, blog-detail.html, dan semua modal ikut berubah. */
const SITE={
  name:'Sadalan',tagline:'Sejalan dan Searah',
  email:'halo@sadalan.id',
  phone:'+62 812-3456-7890',
  address:'Indonesia',
  social:[
    {key:'facebook',label:'Facebook',url:'https://www.facebook.com/sadalan'},
    {key:'x',label:'X',url:'https://x.com/sadalan'},
    {key:'instagram',label:'Instagram',url:'https://www.instagram.com/sadalan'},
    {key:'tiktok',label:'TikTok',url:'https://www.tiktok.com/@sadalan'},
    {key:'threads',label:'Threads',url:'https://www.threads.net/@sadalan'}
  ]
};
const SITE_ICON={
  facebook:'<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  x:'<path d="M4 4l11.733 16H20L8.267 4z"/><path d="M4 20l6.768-6.768m2.46-2.46L20 4"/>',
  instagram:'<rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>',
  tiktok:'<path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/>',
  threads:'<path d="M17.6 8.6C16.8 5.9 14.8 4.2 12 4.2 8.1 4.2 5.6 7.2 5.6 12.1s2.5 7.7 6.4 7.7c3.1 0 5.1-1.5 5.1-3.9 0-2.2-1.8-3.5-4.3-3.5-2 0-3.3.9-3.3 2.2 0 1.2 1 2 2.5 2 2.3 0 3.7-1.6 3.7-4.4 0-1.2-.3-2.3-.8-3.2"/>',
  mail:'<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  phone:'<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  pin:'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'
};
const siteSvg=k=>`<svg class="sf-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${SITE_ICON[k]}</svg>`;
function siteFooter(variant='page',withNav=false){
  return `<footer class="site-footer sf-${variant}${withNav?' sf-nav':''}" aria-label="Kontak dan sosial media">
  <div class="sf-grid">
    <div class="sf-col"><h4>Kontak</h4><ul class="sf-contact">
      <li><a href="mailto:${SITE.email}">${siteSvg('mail')}<span>${SITE.email}</span></a></li>
      <li><a href="tel:${SITE.phone.replace(/[^+\d]/g,'')}">${siteSvg('phone')}<span>${SITE.phone}</span></a></li>
      <li><span class="sf-static">${siteSvg('pin')}<span>${SITE.address}</span></span></li>
    </ul></div>
    <div class="sf-col"><h4>Ikuti kami</h4><div class="sf-social">${SITE.social.map(s=>`<a href="${s.url}" target="_blank" rel="noopener noreferrer" aria-label="${s.label} Sadalan" title="${s.label}">${siteSvg(s.key)}</a>`).join('')}</div></div>
  </div>
  <p class="sf-copy">© ${new Date().getFullYear()} ${SITE.name} — ${SITE.tagline}. Semua hak dilindungi.</p></footer>`;
}
/* sisipkan footer ke setiap <div data-site-footer> pada halaman statis */
document.querySelectorAll('[data-site-footer]').forEach(el=>{el.outerHTML=siteFooter('page',el.hasAttribute('data-nav'))});
