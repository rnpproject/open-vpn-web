import { Lock, Server, Shield, ShieldCheck, Terminal, Waypoints, Zap } from "lucide-react";

const icons: Record<string, typeof Server> = {
  ssh: Terminal,
  vmess: Zap,
  vless: Waypoints,
  trojan: Shield,
  "ovpn-tcp": Lock,
  "ovpn-udp": ShieldCheck,
};
export function ServiceIcon({ id, size = 24 }: { id: string; size?: number }) {
  const protocolId = id.split("--").at(-1) ?? id;
  const Icon = icons[protocolId] ?? Server;
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" />;
}
