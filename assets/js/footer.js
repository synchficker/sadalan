/* Footer Sadalan (sosial media, copyright) — satu sumber untuk semua halaman & modal.
   Data dari data/site.json (name, tagline, social, footer); footer di index.html, blog-detail.html, dan semua modal ikut berubah. */
const SITE=Store.data.site; /* name, tagline, social[], footer{heading,rights} dari data/site.json */
const siteEsc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SITE_ICON={
  facebook:'<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  x:'<path d="M4 4l11.733 16H20L8.267 4z"/><path d="M4 20l6.768-6.768m2.46-2.46L20 4"/>',
  instagram:'<rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>',
  tiktok:'<path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/>',
  threads:'<path d="M17.6 8.6C16.8 5.9 14.8 4.2 12 4.2 8.1 4.2 5.6 7.2 5.6 12.1s2.5 7.7 6.4 7.7c3.1 0 5.1-1.5 5.1-3.9 0-2.2-1.8-3.5-4.3-3.5-2 0-3.3.9-3.3 2.2 0 1.2 1 2 2.5 2 2.3 0 3.7-1.6 3.7-4.4 0-1.2-.3-2.3-.8-3.2"/>'
};
const siteSvg=k=>`<svg class="sf-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${SITE_ICON[k]}</svg>`;
function siteFooter(variant='page',withNav=false){
  return `<footer class="site-footer sf-${variant}${withNav?' sf-nav':''}" aria-label="Sosial media">
  <div class="sf-grid">
    <div class="sf-col"><h4>${siteEsc(SITE.footer.heading)}</h4><div class="sf-social">${SITE.social.filter(s=>SITE_ICON[s.key]).map(s=>`<a href="${siteEsc(s.url)}" target="_blank" rel="noopener noreferrer" aria-label="${siteEsc(s.label)} ${siteEsc(SITE.name)}" title="${siteEsc(s.label)}">${siteSvg(s.key)}</a>`).join('')}</div></div>
  </div>
  <p class="sf-copy">© ${new Date().getFullYear()} ${siteEsc(SITE.name)} — ${siteEsc(SITE.tagline)}. ${siteEsc(SITE.footer.rights)}</p></footer>`;
}
/* sisipkan footer ke setiap <div data-site-footer> pada halaman statis */
document.querySelectorAll('[data-site-footer]').forEach(el=>{el.outerHTML=siteFooter('page',el.hasAttribute('data-nav'))});
