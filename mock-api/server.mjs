import http from "node:http";

const port = Number(process.env.MOCK_PORT ?? 8089);
const services = [
  { id: "ssh", label: "SSH", available: true, reason: null, max_days: 30 },
  { id: "vmess", label: "VMess", available: true, reason: null, max_days: 30 },
  { id: "vless", label: "VLESS", available: true, reason: null, max_days: 30 },
  {
    id: "trojan",
    label: "Trojan",
    available: false,
    reason: "Front proxy sedang dipelihara",
    max_days: 30,
  },
  { id: "ovpn-tcp", label: "OpenVPN TCP", available: true, reason: null, max_days: 30 },
  { id: "ovpn-udp", label: "OpenVPN UDP", available: true, reason: null, max_days: 30 },
];
if (process.env.MOCK_EXTRA_SERVICE_ID) {
  services.push({
    id: process.env.MOCK_EXTRA_SERVICE_ID,
    label: "Layanan tambahan",
    available: true,
    reason: null,
    max_days: 7,
  });
}
const counts = Object.fromEntries(services.map(({ id }, index) => [id, index + 2]));

function send(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}
function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 16_384) reject(new Error("too_large"));
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  if (request.method === "GET" && url.pathname === "/v1/services")
    return send(response, 200, { data: { services, generated_at: new Date().toISOString() } });
  if (request.method === "GET" && url.pathname === "/v1/status") {
    return send(response, 200, {
      data: {
        server: {
          domain: "mock.local",
          uptime_seconds: 38_400,
          load1: 0.18,
          ram: { used_mb: 420, total_mb: 2048 },
        },
        services: Object.fromEntries(
          services.map(({ id, available }) => [id, available ? "running" : "stopped"]),
        ),
        accounts: counts,
        online: { ssh: 2, ovpn: 3, xray: null },
      },
    });
  }
  if (request.method === "POST" && url.pathname === "/v1/accounts") {
    const mode = process.env.MOCK_FAIL ?? "";
    if (mode === "timeout") {
      await new Promise((resolve) =>
        setTimeout(resolve, Number(process.env.MOCK_DELAY_MS ?? 25_000)),
      );
      if (response.destroyed) return;
    }
    if (mode === "500")
      return send(response, 500, {
        error: { code: "mock_failure", message: "Temporary mock failure" },
      });
    if (mode === "409")
      return send(response, 409, { error: { code: "conflict", message: "Mock conflict" } });
    let body;
    try {
      body = await readJson(request);
    } catch {
      return send(response, 422, {
        error: { code: "invalid_request", message: "Invalid request" },
      });
    }
    const service = services.find((item) => item.id === body?.service);
    if (
      !service ||
      !service.available ||
      !Number.isInteger(body.days) ||
      body.days > (service.max_days ?? 30)
    ) {
      return send(response, 422, {
        error: { code: "invalid_request", message: "Service or duration is invalid" },
      });
    }
    const username =
      typeof body.username === "string"
        ? body.username
        : `w${Math.random().toString(32).slice(2, 9)}`;
    const connection =
      body.service === "ssh"
        ? { host: "mock.local", password: "mock-password", ports: { 22: true, 80: true, 443: true } }
        : body.service.startsWith("ovpn-")
          ? {
              host: "mock.local",
              port: 1194,
              proto: body.service.endsWith("tcp") ? "tcp" : "udp",
              filename: `${username}.ovpn`,
              content: "client\nproto mock\n",
            }
          : {
              host: "mock.local",
              port: 443,
              links: { ws_tls: `${body.service}://mock-connection` },
            };
    const expires = new Date(Date.now() + body.days * 86_400_000).toISOString();
    return send(response, 201, { data: { username, expires_at: expires, connection } });
  }
  return send(response, 404, { error: { code: "not_found", message: "Not found" } });
});

server.listen(port, "127.0.0.1", () => console.log(`Mock VPN API listening on 127.0.0.1:${port}`));
