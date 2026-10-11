import { notFound } from "next/navigation";
import { getServices } from "@/lib/vpnApi";

// Berjalan di layout segmen (di luar Suspense boundary loading.tsx) sehingga
// notFound() menghasilkan status HTTP 404 yang benar.
const VERIFY_TIMEOUT_MS = 1200;

async function serviceExists(id: string): Promise<boolean | null> {
  try {
    const services = await Promise.race([
      getServices().then((result) => result.value),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), VERIFY_TIMEOUT_MS)),
    ]);
    if (services === null) return null;
    return services.some((service) => service.id === id);
  } catch {
    return null;
  }
}

export default async function ServiceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ service: string }>;
}) {
  const { service } = await params;
  const exists = await serviceExists(service);
  if (exists === false) notFound();
  return <>{children}</>;
}
