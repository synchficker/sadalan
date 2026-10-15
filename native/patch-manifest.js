/* Menambahkan izin lokasi + layanan latar depan ke AndroidManifest.xml hasil `npx cap add android` (idempoten). */
const fs = require('fs');
const f = 'android/app/src/main/AndroidManifest.xml';
let x = fs.readFileSync(f, 'utf8');
const perms = ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'POST_NOTIFICATIONS', 'WAKE_LOCK'];
const add = perms.filter((p) => !x.includes(`android.permission.${p}`)).map((p) => `    <uses-permission android:name="android.permission.${p}" />`).join('\n');
if (add) x = x.replace('<application', add + '\n\n    <application');
fs.writeFileSync(f, x);
console.log('Manifest diperbarui:', add ? 'izin ditambahkan' : 'sudah lengkap');
