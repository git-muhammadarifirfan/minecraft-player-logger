PLAYERACTIONLOGGER MINECRAFT OPTIMIZED UI
Develop by Young_Jawa

Cara pasang:
1. Extract ZIP.
2. Upload / replace file ini ke folder web PlayerActionLogger:
   - index.html
   - style.css
   - app.js
   - assets/minecraft_bg.png
3. Stop server.
4. Start server.
5. Buka web:
   http://bsc-1.aerocloud.id:19262
6. Tekan Ctrl + F5 kalau cache masih menempel.

Perubahan versi ini:
- Angka statistik atas sekarang pakai font Minecraft supaya lebih keren.
- Data tabel, detail log, dan input tetap readable supaya enak dibaca.
- Background diganti dengan gambar Minecraft-like original buatan custom, bukan ambil dari web.
- CSS diringankan: blur berat dihapus, efek sederhana, rendering lebih ringan.
- App.js dioptimalkan: re-render penuh hanya saat data berubah.
- Auto refresh tetap ON tiap 3 detik.
- Modal player tetap ikut update otomatis.
- Command/chat log tetap disembunyikan.
