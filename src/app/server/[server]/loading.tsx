import { PathLoader } from "@/components/PathLoader";

export default function Loading() {
  return (
    <div className="route-loading">
      <PathLoader size="lg" label="Loading server page" />
    </div>
  );
}
