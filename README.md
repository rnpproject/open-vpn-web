# Open VPN Web

Portal publik untuk membuat akun VPN lewat API server. Aplikasi ini hanya memanggil `GET /v1/services`, `GET /v1/status`, dan `POST /v1/accounts`. API key hanya dipakai oleh server web. Kredensial hasil tidak disimpan oleh aplikasi web di database atau log. Tab browser menyimpan salinan sementara di `sessionStorage` paling lama 30 menit atau sampai hasil ditutup.

![Banner portal VPN](./public/banner.png)

## Menjalankan mock lokal

Gunakan Node.js 22.12 atau lebih baru.

```sh
npm ci
cp .env.example .env.local
npm run mock
```

Atur `VPN_API_KEY` dan `IP_HASH_SALT` di `.env.local` ke nilai acak lokal, lalu pada terminal lain:

```sh
npm run dev
```

Buka `http://localhost:3000`. Mock mendengarkan hanya di `127.0.0.1:8089`; `MOCK_FAIL=500|409|timeout` dapat dipakai untuk mensimulasikan kegagalan POST.

## Produksi

Jalankan sebagai proses Node.js biasa dengan systemd atau PM2. Isi konfigurasi API, database yang dipilih, `IP_HASH_SALT`, dan limit sesuai kebutuhan. Jangan memberi prefiks `NEXT_PUBLIC_` pada rahasia. Letakkan reverse proxy TLS di depan aplikasi dan pastikan proxy mengganti `X-Real-IP` dengan alamat peer yang tervalidasi. Hanya jika proxy tepercaya mengirim `X-Forwarded-For` yang dibersihkan, set `TRUST_PROXY_HEADERS=1`. Panduan produksi ada di `PRODUCTION_SETUP.md`.

### Variabel konfigurasi

| Variabel                                                               |                 Default | Fungsi                                                                                                                                        |
| ---------------------------------------------------------------------- | ----------------------: | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `VPN_API_BASE_URL`                                                     | `http://127.0.0.1:8089` | Basis URL API VPN utama                                                                                                                       |
| `VPN_API_SERVERS`                                                      |                  kosong | JSON array server; tiap server dapat memiliki `label`, `location`, `dailyLimit`, serta `capacity` dan `bandwidth` opsional untuk kartu server |
| `VPN_API_KEY`                                                          |                   wajib | Kunci untuk API, hanya di server                                                                                                              |
| `DAILY_LIMIT_PER_SERVICE`                                              |                    `10` | Kuota global per layanan per hari                                                                                                             |
| `ALLOWED_DAYS`                                                         |                 `1,3,7` | Durasi yang dapat dipilih                                                                                                                     |
| `PER_IP_CREATE_LIMIT_PER_HOUR`                                         |                     `5` | Batas percobaan per IP ter-hash per jam                                                                                                       |
| `PER_IP_CREATE_LIMIT_PER_DAY`                                          |                     `3` | Batas per IP, per layanan, per hari WIB                                                                                                       |
| `QUOTA_STORE`                                                          |                otomatis | `firestore`, `oracle-nosql`, atau `memory`; otomatis memakai Firestore jika kredensialnya lengkap, selain itu `memory`                        |
| `SITE_URL`                                                             |                  kosong | URL publik untuk metadata dasar                                                                                                               |
| `VPN_API_GET_TIMEOUT_MS`                                               |                  `4000` | Batas waktu permintaan baca upstream                                                                                                          |
| `VPN_API_POST_TIMEOUT_MS`                                              |                 `20000` | Batas waktu pembuatan akun upstream                                                                                                           |
| `IP_HASH_SALT`                                                         |                   wajib | Salt acak untuk menyamarkan IP sebelum disimpan                                                                                               |
| `TRUST_PROXY_HEADERS`                                                  |                     `0` | Percayai X-Forwarded-For hanya di belakang proxy tepercaya                                                                                    |
| `SUPPORT_URL`                                                          |                  kosong | Kartu dukungan opsional                                                                                                                       |
| `FORCE_MAINTENANCE`                                                    |                     `0` | Nilai `1` menampilkan halaman maintenance statis dengan HTTP 503                                                                              |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`                           |                  kosong | Aktifkan verifikasi Turnstile bila keduanya diisi                                                                                             |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` |                  kosong | Kredensial Firebase Admin saat `QUOTA_STORE=firestore`; private key memakai `\\n` untuk baris baru                                            |
| `ORACLE_NOSQL_REGION`                                                  |                  kosong | Region OCI, wajib saat `QUOTA_STORE=oracle-nosql`                                                                                            |
| `ORACLE_NOSQL_COMPARTMENT`                                             |                  kosong | Nama atau OCID compartment OCI bila tabel tidak berada di root tenancy                                                                      |
| `ORACLE_NOSQL_TENANT_ID`, `ORACLE_NOSQL_USER_ID`, `ORACLE_NOSQL_FINGERPRINT`, `ORACLE_NOSQL_PRIVATE_KEY` | kosong | OCI IAM credentials; dapat diisi sebagai environment variables (wajib untuk Vercel) |
| `ORACLE_NOSQL_PASSPHRASE`                                              |                  kosong | Passphrase private key OCI bila key terenkripsi                                                                                              |
| `ORACLE_NOSQL_CONFIG_FILE`                                             | `~/.oci/config`         | Path OCI config file berisi IAM credentials (opsional bila memakai path default)                                                            |
| `ORACLE_NOSQL_PROFILE`                                                 |              `DEFAULT` | Nama profile dari OCI config file                                                                                                            |
| `ORACLE_NOSQL_TABLE`                                                   |           `free_ovpn`   | Nama tabel Oracle NoSQL yang sudah dibuat sesuai skema di bawah                                                                              |
| `ADMIN_EMAILS`                                                         |                  kosong | Daftar email admin yang diizinkan, dipisahkan koma                                                                                            |
| `ADMIN_PASSWORD_HASH`                                                  |                  kosong | Hash scrypt password admin, bukan password plaintext                                                                                          |
| `ADMIN_SESSION_SECRET`                                                 |                  kosong | Secret acak minimal 32 byte untuk tanda tangan cookie sesi admin                                                                              |

Tanpa database persisten yang dipilih, kuota memakai store in-memory per proses; data hilang saat restart dan tidak dibagi antarproses. Mode ini sesuai untuk lokal saja. Untuk produksi lintas proses, pilih `QUOTA_STORE=firestore` atau `QUOTA_STORE=oracle-nosql`. Kedua database menyimpan kuota global dan pengaturan situs; rate limit per IP juga dibagi antarproses. Kuota tiap layanan direset pada 00.00 WIB. Satu pengunjung dapat menghabiskan kuota global. Rate limit per IP dan Turnstile opsional mengurangi penyalahgunaan. Karena kredensial akun VPN tidak disimpan, pengguna harus menyalin atau mengunduhnya sebelum meninggalkan halaman.

### Oracle NoSQL Database Cloud Service

Pilih `QUOTA_STORE=oracle-nosql`, isi `ORACLE_NOSQL_REGION`, dan siapkan OCI config file dengan profile IAM yang memiliki izin mengakses tabel NoSQL. `ORACLE_NOSQL_CONFIG_FILE` dan `ORACLE_NOSQL_PROFILE` dapat dipakai untuk memilih file/profile selain default `~/.oci/config`. Simpan private key OCI hanya di server dan batasi permission file.

Buat tabel `free_ovpn` di Oracle NoSQL Database Cloud Service. Skemanya mengikuti tabel pada gambar: `collection_type` dan `document_id` adalah primary key/shard key bertipe `STRING`; `payload` bertipe `JSON` dan nullable.

```sql
CREATE TABLE free_ovpn (
  collection_type STRING,
  document_id STRING,
  payload JSON,
  PRIMARY KEY (SHARD(collection_type, document_id))
)
```

Aplikasi menyimpan dokumen pengaturan situs, kuota, dan rate limit sebagai JSON di `payload`, dengan `collection_type` sebagai nama koleksi dan `document_id` sebagai ID dokumen. Penulisan kuota memakai conditional put berbasis row version agar update lintas proses tetap atomik. Baris kuota/rate limit diberi TTL oleh aplikasi; tabel tidak memerlukan kolom tambahan atau default TTL.

## Deploy di Vercel

Project ini menggunakan Next.js dan dapat di-deploy langsung ke Vercel; [vercel.json](./vercel.json) mengarahkan Functions ke region Singapore (`sin1`). Untuk Oracle NoSQL di Vercel, isi variabel OCI IAM credentials langsung pada **Project Settings → Environment Variables** (`ORACLE_NOSQL_TENANT_ID`, `ORACLE_NOSQL_USER_ID`, `ORACLE_NOSQL_FINGERPRINT`, `ORACLE_NOSQL_PRIVATE_KEY`, serta `ORACLE_NOSQL_REGION`). Private key dapat dimasukkan sebagai PEM multiline atau memakai literal `\n`; jangan gunakan `ORACLE_NOSQL_CONFIG_FILE` di Vercel. Isi juga environment aplikasi lainnya seperti `QUOTA_STORE=oracle-nosql`, `IP_HASH_SALT`, `VPN_API_SERVERS`, dan secret Turnstile/admin bila digunakan. Jangan menambahkan prefiks `NEXT_PUBLIC_` pada secret apa pun.

## Portal admin

Buka `/admin` untuk memilih mode Normal, Maintenance (full), jeda beberapa service, atau Tutup total. Normal mengaktifkan semua service kembali; jeda beberapa service hanya menghentikan layanan yang dipilih. Mode Maintenance (full) dan Tutup total menahan seluruh portal hingga admin mengubah mode. Dalam kedua mode itu, halaman dan health check tidak meminta data dari VPN API. Perkiraan akhir maintenance hanya informasi dan portal tidak dibuka otomatis. Status situs disimpan di database persisten yang dipilih; mode `memory` tidak mendukung penyimpanan pengaturan admin.

Login admin tidak memakai Firebase Authentication. Isi `ADMIN_EMAILS`, `ADMIN_PASSWORD_HASH`, dan `ADMIN_SESSION_SECRET` pada environment server. Buat hash serta secret sesi secara lokal dengan `npm run hash:admin-password`; utilitas meminta password tanpa menampilkannya. Simpan output hanya di environment server dan jangan commit atau bagikan. Cookie sesi HttpOnly berlaku lima hari dan ditandatangani menggunakan secret itu. Database yang dipilih menyimpan pengaturan situs dan kuota. `FORCE_MAINTENANCE=1` tetap menjadi override darurat environment dan harus dimatikan di server sebelum mode situs dapat diubah dari portal.

## Fitur

- Katalog layanan dan status server dari API upstream.
- Kuota global harian serta pembatasan per IP.
- Verifikasi Turnstile opsional dan penyimpanan sementara hasil di tab browser.
- Portal admin dengan kontrol mode situs yang disimpan di database terpilih.
- Halaman ketentuan, privasi, dan antarmuka responsif berbahasa Indonesia.

## Perintah pemeriksaan

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run test:security
npm run check:contrast
npm run build
```

## Firestore Rules

`firestore.rules` menolak seluruh akses langsung dari browser. Aplikasi memakai Firebase Admin SDK di server; permintaan Admin SDK tidak dibatasi oleh rules. Deploy dari root project:

```sh
firebase login
firebase use PROJECT_ID
firebase deploy --only firestore:rules
```

Jangan commit service-account JSON. Simpan kredensial hanya sebagai environment variables server.
