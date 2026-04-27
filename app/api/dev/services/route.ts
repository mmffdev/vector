import { NextResponse } from "next/server";
import net from "net";

type ServiceResult = {
  id: string;
  label: string;
  group: string;
  status: "up" | "down" | "degraded";
  latencyMs?: number;
  detail?: string;
};

function tcpProbe(port: number, timeoutMs = 2000): Promise<{ ok: boolean; latencyMs: number }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    const finish = (ok: boolean) => {
      socket.destroy();
      resolve({ ok, latencyMs: Date.now() - start });
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.connect(port, "127.0.0.1", () => { clearTimeout(timer); finish(true); });
    socket.on("error", () => { clearTimeout(timer); finish(false); });
  });
}

async function httpProbe(url: string, timeoutMs = 3000): Promise<{ ok: boolean; latencyMs: number; body?: unknown }> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const latencyMs = Date.now() - start;
    let body: unknown;
    try { body = await res.json(); } catch { /* not JSON, that's fine */ }
    return { ok: res.status < 500, latencyMs, body };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [backend, dbTunnel, planka, apiDocs] = await Promise.all([
    httpProbe("http://localhost:5100/healthz"),
    tcpProbe(5434),
    httpProbe("http://localhost:3333"),
    httpProbe("http://localhost:8083"),
  ]);

  function backendDetail(p: typeof backend): string | undefined {
    const b = p.body as Record<string, string> | undefined;
    if (!b || typeof b !== "object") return undefined;
    const commit = b.commit === "dev" ? "go run (no commit)" : b.commit?.slice(0, 8);
    const started = b.started_at
      ? `up since ${new Date(b.started_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`
      : undefined;
    return [commit, started].filter(Boolean).join(" · ");
  }

  const services: ServiceResult[] = [
    {
      id: "backend",
      label: "Vector Backend",
      group: "Core",
      status: backend.ok ? "up" : "down",
      latencyMs: backend.latencyMs,
      detail: backend.ok ? backendDetail(backend) : "no response on :5100",
    },
    {
      id: "db-tunnel",
      label: "Database",
      group: "Core",
      status: dbTunnel.ok ? "up" : "down",
      latencyMs: dbTunnel.ok ? dbTunnel.latencyMs : undefined,
      detail: dbTunnel.ok ? "SSH tunnel :5434 → mmff_vector" : "tunnel down — run ssh_manager.sh",
    },
    {
      id: "planka",
      label: "Planka Board",
      group: "Tools",
      status: planka.ok ? "up" : "down",
      latencyMs: planka.ok ? planka.latencyMs : undefined,
      detail: planka.ok ? "localhost:3333" : "tunnel not running",
    },
    {
      id: "api-docs",
      label: "API Reference",
      group: "Tools",
      status: apiDocs.ok ? "up" : "down",
      latencyMs: apiDocs.ok ? apiDocs.latencyMs : undefined,
      detail: apiDocs.ok ? "localhost:8083" : "not running — run deploy.sh",
    },
  ];

  return NextResponse.json({ services, checkedAt: new Date().toISOString() });
}
