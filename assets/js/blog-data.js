/* Helper Blog Sadalan — data artikel dimuat dari data/blog.json (lewat Store).
   Dipakai oleh index.html (modal) dan blog-detail.html (halaman detail).
   body: string = paragraf, {h:'..'} = subjudul, {ul:[..]} = daftar, {q:'..'} = kutipan. */
const BLOG_POSTS=[...Store.data.blog].sort((a,b)=>b.date.localeCompare(a.date)); /* terbaru di atas */
const BLOG_CATS=[...new Set(BLOG_POSTS.map(p=>p.cat))];
const BLOG_MON=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const blogDate=iso=>{const [y,m,d]=iso.split('-');return `${d} ${BLOG_MON[+m-1]} ${y}`};
const blogPlain=p=>[p.text,...p.body.map(b=>typeof b==='string'?b:b.h||b.q||(b.ul||[]).join('. '))].join(' ');
const blogRead=p=>Math.max(1,Math.round(blogPlain(p).split(/\s+/).length/200));
BLOG_POSTS.forEach(p=>{p._s=(p.title+' '+p.cat+' '+blogPlain(p)).toLowerCase()});
