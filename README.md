# HX3D Studio v2

Jalanin: taruh semua file di folder web (PHP hosting atau `python3 -m http.server`), buka `index.html`.
Isi Provider AI (atau Base URL = `proxy.php`). Model harus support tool calling (+ vision kalau mau screenshot).

## Shortcut
W/E/R = pindah/putar/skala objek terpilih · Ctrl+Z / Ctrl+Y = undo/redo · Del = hapus · F = frame · Esc = deselect · Enter = kirim (desktop)

## proxy.php (env)
HX_KEY (wajib) · HX_TOKEN (samain dgn "Access token" di UI) · HX_UP · HX_MODELS (allowlist) · HX_RATE (req/menit/IP)

## Tool baru buat AI
batch, boolean (CSG), duplicate_object (mirror/array), set_origin, set_visible, validate_model, play_animation,
screenshot views:[4 sisi] jadi 1 gambar, simulate_cloth collider otomatis {object:"torso"}, primitive plane/icosphere/hemisphere, extrude holes.
