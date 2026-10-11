import { Portal } from "@/components/Portal";
import { initialMeta } from "@/lib/initialMeta";

export const dynamic = "force-dynamic";

export default async function Home() {
  const meta = await initialMeta();
  return <Portal initialMeta={meta} />;
}
