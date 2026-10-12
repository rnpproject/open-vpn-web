# Simulasi Alur Aplikasi

Dokumen ini menjelaskan alur request antara browser pengguna, aplikasi Next.js di Vercel, database, dan API server VPN.

## Komponen

- **Browser**: menampilkan portal dan mengirim request dari pengguna.
- **Vercel / aplikasi web**: menjalankan Next.js, memvalidasi request, dan menghubungkan browser ke database serta API VPN.
- **Database**: Firestore atau Oracle NoSQL Database Cloud Service. Menyimpan status situs, kuota, dan rate limit.
- **API server VPN**: menyediakan daftar service/status dan membuat akun VPN. API key hanya digunakan oleh aplikasi web di server.

Browser tidak terhubung langsung ke database atau API VPN. Request database dan API VPN dilakukan oleh kode server aplikasi di Vercel.

## 1. Pengguna membuka Home

```text
Browser
  ── GET / ──>
Vercel: Next.js Home
  → initialMeta()
  → Database: baca status situs
      ├─ maintenance / closed / status tidak dapat dibaca
      │    → tidak meminta data ke API VPN
      │    → render halaman maintenance atau status tidak tersedia
      │
      └─ normal / notice
           → API VPN: GET /v1/services
           → API VPN: GET /v1/status
           → Database: baca snapshot kuota untuk service
           → gabungkan status, service, dan kuota
  <── HTML + data awal ──
Browser menampilkan Home
```

Daftar service dan status VPN diminta secara paralel. Setelah daftar service tersedia, aplikasi membaca kuota yang terkait. Jika data awal gagal dimuat, browser dapat mencoba `GET /api/meta` saat pengguna melakukan retry.

## 2. Pengguna membuka halaman server

```text
Browser
  ── GET /server/{serverId} ──>
Vercel: ServerLayout
  → Database: cek status situs
  → API VPN: GET /v1/services
  → cocokkan serverId dengan daftar service
      ├─ server dipastikan tidak ada → balas 404
      └─ server ada atau pemeriksaan tidak pasti
           → ServerPage memanggil initialMeta()
           → Portal menampilkan service untuk serverId tersebut
  <── halaman server ──
Browser menampilkan halaman server
```

Jika pemeriksaan ke database atau API VPN gagal/timeout, layout tidak langsung menganggap server tidak ada. Halaman dapat dirender dalam kondisi terbatas dan menampilkan status data yang tidak tersedia.

## 3. Pengguna membuka halaman service

```text
Browser
  ── GET /s/{serviceId} ──>
Vercel: ServiceLayout
  → Database: cek status situs
  → API VPN: GET /v1/services
  → cocokkan serviceId
      ├─ service dipastikan tidak ada → balas 404
      └─ service tersedia / pemeriksaan tidak pasti
           → ServicePage memanggil initialMeta()
           → Portal menampilkan detail service, kuota, dan formulir akun
  <── halaman service ──
Browser menampilkan halaman service
```

## 4. Pengguna membuat akun VPN

```text
Browser
  ── POST /api/accounts { service, days } ──>
Vercel: validasi request dan status situs
  ├─ situs maintenance / closed / status tidak tersedia
  │    → tolak request; API VPN tidak dipanggil
  │
  └─ situs aktif
       → pastikan service tersedia dan durasi diizinkan
       → verifikasi Turnstile jika diaktifkan
       → Database: reservasi rate limit IP
       → Database: reservasi rate limit sesi
            ├─ limit tercapai → balas 429; API VPN tidak dipanggil
            └─ lolos
                 → Database: reservasi kuota global
                      ├─ kuota habis → balas 429
                      └─ kuota tersedia
                           → API VPN server yang memiliki service:
                             POST /v1/accounts
                                ├─ sukses
                                │    → Database: commit kuota
                                │    → kirim hasil akun ke browser
                                ├─ gagal pasti
                                │    → Database: lepaskan reservasi kuota
                                │    → kirim error ke browser
                                └─ hasil tidak pasti
                                     → Database: tahan/commit kuota
                                     → balas bahwa hasil belum dapat dipastikan
  <── response ──
Browser menampilkan hasil atau pesan error
```

API key VPN ditambahkan oleh aplikasi web pada request ke API server. Browser tidak menerima API key tersebut. Hasil akun disimpan sementara di `sessionStorage` browser setelah berhasil diterima.

## 5. Jalur database

```text
Vercel: aplikasi server-side
  ├─ QUOTA_STORE=firestore
  │    → Firestore
  │         ├─ status situs
  │         ├─ kuota
  │         └─ rate limit
  │
  └─ QUOTA_STORE=oracle-nosql
       → Oracle NoSQL Database Cloud Service
            → tabel free_ovpn
                 ├─ collection_type
                 ├─ document_id
                 └─ payload (JSON)
```

Pada Oracle NoSQL, `collection_type` berisi jenis koleksi, `document_id` berisi ID dokumen, dan `payload` menyimpan data JSON. Contohnya:

```text
collection_type = site_settings
document_id     = state
payload         = data status situs
```

Penulisan kuota dan rate limit Oracle NoSQL menggunakan conditional put berbasis row version untuk menangani request bersamaan dari beberapa Vercel Function. Baris kuota dan rate limit diberi TTL.

Jangan gunakan `QUOTA_STORE=memory` untuk produksi/serverless. Data memory tidak dibagi antar-instance dan dapat hilang saat instance berhenti.

## 6. Health check

```text
Monitor
  ── GET /api/health ──>
Vercel
  → Database: periksa koneksi store
  → API VPN: periksa service dan status
  → balas status database dan API VPN
  <── response health ──
Monitor
```

## 7. Portal admin

```text
Admin browser
  ── GET /admin, GET /api/admin/state ──>
Vercel
  → verifikasi sesi admin
  → Database: baca pengaturan situs
  <── status situs ──

Admin browser
  ── PUT /api/admin/state ──>
Vercel
  → verifikasi sesi dan origin
  → validasi pengaturan
  → Database: simpan pengaturan situs
  <── hasil simpan ──
```

Portal admin memerlukan database persisten. Mode `memory` tidak dapat menyimpan pengaturan situs secara permanen.
