"use client";

import { RecoveryError } from "@/components/RecoveryError";
import "./globals.css";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="id">
      <body>
        <main className="page-shell">
          <RecoveryError retry={retry} digest={error.digest} />
        </main>
      </body>
    </html>
  );
}
