"use client";

import { RecoveryError } from "@/components/RecoveryError";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RecoveryError retry={retry} digest={error.digest} />;
}
