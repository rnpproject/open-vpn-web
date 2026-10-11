import { notFound } from "next/navigation";
import { getServices } from "@/lib/vpnApi";

const VERIFY_TIMEOUT_MS = 1200;

async function serverExists(id: string): Promise<boolean | null> {
  try {
    const services = await Promise.race([
      getServices().then((result) => result.value),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), VERIFY_TIMEOUT_MS)),
    ]);
    if (services === null) return null;
    return services.some((service) => service.server_id === id);
  } catch {
    return null;
  }
}

export default async function ServerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ server: string }>;
}) {
  const { server } = await params;
  const exists = await serverExists(server);
  if (exists === false) notFound();
  return <>{children}</>;
}
