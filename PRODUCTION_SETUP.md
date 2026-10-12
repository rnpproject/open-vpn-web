# Production setup

Project ini dijalankan sebagai proses Node.js biasa dan memakai Firestore sebagai penyimpanan bersama.

![Banner portal VPN](./public/banner.png)

## Build dan jalankan

```bash
npm ci
npm run build
NODE_ENV=production npm start
```

Gunakan systemd atau PM2 agar proses otomatis dimulai kembali ketika VM reboot atau proses berhenti. Aplikasi wajib hanya mendengarkan `127.0.0.1:3000`; tempatkan Nginx di depan aplikasi untuk TLS.

## Environment

Simpan environment di luar repository dengan permission `0600`. Wajib diisi:

```dotenv
VPN_API_SERVERS=[{"id":"vm1","label":"Server 1","location":"Jakarta, Indonesia","baseUrl":"https://api.example.com","apiKey":"...","dailyLimit":10,"capacity":150,"bandwidth":"Unlimited"}]
DAILY_LIMIT_PER_SERVICE=10
ALLOWED_DAYS=1,3,7
IP_HASH_SALT=...
TRUST_PROXY_HEADERS=0
HOSTNAME=127.0.0.1
PORT=3000
QUOTA_STORE=firestore
```

Untuk Firestore, tambahkan `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, dan `FIREBASE_PRIVATE_KEY`. Untuk Oracle NoSQL Database Cloud Service, gunakan pengaturan berikut sebagai alternatif:

```dotenv
QUOTA_STORE=oracle-nosql
ORACLE_NOSQL_REGION=ap-singapore-1
ORACLE_NOSQL_COMPARTMENT=ocid1.compartment.oc1..example
ORACLE_NOSQL_CONFIG_FILE=/etc/open-vpn-web/oci/config
ORACLE_NOSQL_PROFILE=DEFAULT
ORACLE_NOSQL_TABLE=free_ovpn
```

Profile OCI harus memiliki izin IAM untuk membaca dan menulis tabel NoSQL; simpan API signing key dalam file terpisah dengan permission terbatas. Buat tabel `free_ovpn` dengan skema:

```sql
CREATE TABLE free_ovpn (
  collection_type STRING,
  document_id STRING,
  payload JSON,
  PRIMARY KEY (SHARD(collection_type, document_id))
)
```

Kolom key menyimpan jenis koleksi dan ID dokumen; payload menyimpan data JSON kuota, rate limit, serta pengaturan situs. Aplikasi menggunakan penulisan bersyarat row-version untuk mencegah lost update. TTL diterapkan per baris kuota/rate limit, jadi jangan atur default TTL di tabel yang sama.

### Vercel

Vercel mendeteksi project Next.js secara otomatis; `vercel.json` menargetkan Functions ke `sin1` (Singapore). Atur environment variables yang sama melalui dashboard Vercel. Untuk Oracle NoSQL, isi `ORACLE_NOSQL_TENANT_ID`, `ORACLE_NOSQL_USER_ID`, `ORACLE_NOSQL_FINGERPRINT`, `ORACLE_NOSQL_PRIVATE_KEY`, dan `ORACLE_NOSQL_REGION`; file OCI config lokal tidak diperlukan. Tempel private key sebagai PEM multiline atau dengan newline `\n`. Pastikan IAM policy mengizinkan user tersebut membaca/menulis tabel pada compartment yang dipilih. App Router memakai Node.js runtime Next.js, yang diperlukan oleh Oracle NoSQL SDK.

`VPN_API_SERVERS` dapat memuat beberapa server. Beranda portal menampilkan kartu untuk tiap server; memilihnya membuka protokol yang tersedia di server itu. Isi `location` pada tiap objek agar lokasi tampil di kartu dan detail server. Status unit API (`xray`, `vpn-openvpn-tcp`, `vpn-openvpn-udp`) dipetakan ke protokol katalog terkait. Setiap layanan dan kuotanya diisolasi per server. Isi `capacity` (jumlah akun maksimum, bilangan bulat) dan `bandwidth` (teks bebas, maksimal 40 karakter) bila ingin kartu server menampilkan kapasitas dan bandwidth; tanpa nilai itu, kartu hanya menampilkan jumlah akun tercatat dari API dan baris bandwidth disembunyikan. Atur `dailyLimit` per server bila perlu; tanpa nilai itu, `DAILY_LIMIT_PER_SERVICE` dipakai. API server harus dapat dijangkau melalui HTTPS dan tetap memakai header API key.

### Saklar maintenance darurat

Set `FORCE_MAINTENANCE=1` lalu restart proses Node.js untuk menolak rute publik dengan HTTP 503 dan `Retry-After: 300`. `/api/health`, `/api/admin/*`, dan aset statis tetap dapat diakses. Set kembali ke `0` dan restart proses untuk membuka portal.

Untuk maintenance rutin, pengumuman, menutup portal, atau menjeda layanan tanpa restart, gunakan portal `/admin`. Buat hash dan session secret dengan `npm run hash:admin-password`, lalu simpan `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, dan `ADMIN_EMAILS` (email dipisahkan koma) di environment server, bukan di repository. Login admin menggunakan environment dan hash lokal, bukan Firebase Authentication. Pengaturan situs memerlukan `QUOTA_STORE=firestore` atau `QUOTA_STORE=oracle-nosql` dengan kredensial database terkait. Mode `closed` tidak kedaluwarsa otomatis; buka kembali dengan mengganti mode ke `normal`. Waktu selesai maintenance hanya ditampilkan sebagai perkiraan, bukan pembukaan otomatis. Saat mode full maintenance atau closed aktif, initial metadata, route pemeriksaan service, dan health check tidak memanggil VPN API; health check menandai `vpnApi` sebagai `skipped`. `FORCE_MAINTENANCE=1` mengesampingkan pengaturan database sampai nilainya dimatikan dan proses direstart.

## Firebase

Buat Firestore database pada project Firebase, lalu deploy rules:

```bash
firebase login
firebase use PROJECT_ID
firebase deploy --only firestore:rules
```

Jangan simpan service-account JSON di repository. Salin `project_id`, `client_email`, dan `private_key` ke environment server.

## Systemd contoh

```ini
[Unit]
Description=Open VPN Web
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/open-vpn-web
EnvironmentFile=/etc/open-vpn-web/web.env
Environment=HOSTNAME=127.0.0.1
Environment=PORT=3000
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/open-vpn-web/.next /opt/open-vpn-web/data

[Install]
WantedBy=multi-user.target
```

Simpan sebagai `/etc/systemd/system/open-vpn-web.service`, lalu jalankan `sudo systemctl daemon-reload && sudo systemctl enable --now open-vpn-web`.

## Nginx

```nginx
limit_req_zone $binary_remote_addr zone=account_create:10m rate=5r/m;
server {
    listen 443 ssl http2;
    server_name vpn.example.com;
    ssl_certificate /etc/letsencrypt/live/vpn.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vpn.example.com/privkey.pem;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    error_page 502 503 504 /maintenance-static.html;
    location = /maintenance-static.html {
        alias /opt/open-vpn-web/public/maintenance-static.html;
        internal;
        add_header Cache-Control "no-store" always;
    }
    client_max_body_size 4k;
    location = /api/accounts {
        limit_req zone=account_create burst=3 nodelay;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host $host;
        proxy_pass http://127.0.0.1:3000;
    }
    location / {
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host $host;
        proxy_pass http://127.0.0.1:3000;
    }
}
```

Fallback Nginx di atas berlaku ketika proses aplikasi tidak memberi respons yang dapat dibaca, misalnya saat koneksi ke Node gagal. Berkas statisnya berada di `public/maintenance-static.html`.

## Checklist keamanan produksi

- Aktifkan Turnstile dan lindungi semua rahasia di environment server.
- Gunakan `QUOTA_STORE=firestore` atau `QUOTA_STORE=oracle-nosql`; memory hanya sesuai untuk pengembangan/satu proses sementara.
- Aktifkan TTL Firestore pada `expireAt` untuk kedua koleksi berikut:

```bash
gcloud firestore fields ttls update expireAt --collection-group=vpn_web_ip_limits --enable-ttl
gcloud firestore fields ttls update expireAt --collection-group=vpn_web_quota --enable-ttl
```

- Pastikan Node hanya terikat ke loopback (`HOSTNAME=127.0.0.1`) dan port 3000 tidak terbuka ke internet.
- Atur permission berkas environment menjadi `0600`; proxy harus mengganti header IP masuk dengan peer yang tervalidasi.
