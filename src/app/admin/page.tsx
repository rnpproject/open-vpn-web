import type { Metadata } from "next";
import { AdminPortal } from "@/components/AdminPortal";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return <AdminPortal />;
}
