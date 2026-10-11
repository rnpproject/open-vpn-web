import { Portal } from "@/components/Portal";
import { initialMeta } from "@/lib/initialMeta";

export const dynamic = "force-dynamic";

// Shell instan. Verifikasi 404 dikerjakan layout segmen (src/app/server/layout.tsx).
export default async function ServerPage({ params }: { params: Promise<{ server: string }> }) {
  const { server } = await params;
  const meta = await initialMeta();
  return <Portal key={server} serverId={server} initialMeta={meta} />;
}
