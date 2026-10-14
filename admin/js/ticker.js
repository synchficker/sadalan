/* Worker pengetuk: timer di Web Worker tidak ikut diperlambat peramban saat halaman di latar belakang. */
let t = 0;
onmessage = (e) => { clearInterval(t); if (e.data && e.data.stop) return; t = setInterval(() => postMessage(1), (e.data && e.data.ms) || 1000); };
