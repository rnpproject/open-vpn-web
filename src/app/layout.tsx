import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { getEnv } from "@/lib/env";
import { initialMeta } from "@/lib/initialMeta";
import "./globals.css";

const description =
  "Portal untuk membuat akun VPN gratis. Pilih server dan service, lalu simpan connection details.";
export const metadata: Metadata = {
  title: { default: "Free VPN | Portal Akun VPN", template: "%s | Free VPN" },
  description,
  ...(process.env.SITE_URL && /^https?:\/\//.test(process.env.SITE_URL)
    ? { metadataBase: new URL(process.env.SITE_URL) }
    : {}),
  openGraph: { title: "Free VPN | Portal Akun VPN", description },
};
export const viewport: Viewport = { themeColor: "#0866b5" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const meta = await initialMeta();
  // Defensif saat build/prerender tanpa env lengkap: footer dukungan disembunyikan.
  let supportUrl: string | undefined;
  try {
    supportUrl = getEnv().SUPPORT_URL || undefined;
  } catch {
    supportUrl = undefined;
  }
  return (
    <html lang="id">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <Navbar services={meta.services} />
        <main id="main-content" className="page-shell">
          {children}
        </main>
        <footer className="site-footer">
          <div className="site-footer__inner">
            <p>
              © {new Date().getFullYear()} QubanTra. Gunakan service dengan
              bertanggung jawab.
            </p>
            <nav aria-label="Footer links">
              <Link href="/ketentuan">Terms</Link>
              <Link href="/privasi">Privacy</Link>
              {supportUrl ? (
                <a href={supportUrl} target="_blank" rel="noopener noreferrer">
                  Support <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : null}
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
