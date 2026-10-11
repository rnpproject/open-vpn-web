import { Portal } from "@/components/Portal";
import { initialMeta } from "@/lib/initialMeta";

export const dynamic = "force-dynamic";

// Shell instan. Verifikasi 404 dikerjakan layout segmen (src/app/s/layout.tsx)
// agar status HTTP 404 tetap benar meski ada loading.tsx.
export default async function ServicePage({
  params,
}: {
  params: Promise<{ service: string }>;
}) {
  const { service } = await params;
  const meta = await initialMeta();
  return <Portal key={service} serviceId={service} initialMeta={meta} />;
}
