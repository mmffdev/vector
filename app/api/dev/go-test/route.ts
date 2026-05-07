import { spawn } from "child_process";
import path from "path";

// POST /api/dev/go-test
// Body: { pkg: string; run?: string; env?: Record<string,string> }
// Returns a streaming text/event-stream response. Each line from go test
// is emitted as:  data: <line>\n\n
// A final "done" or "fail" event closes the stream.
//
// Dev-only — 404 in production.

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }

  const body = await req.json().catch(() => ({})) as {
    pkg?: string;
    run?: string;
    env?: Record<string, string>;
  };

  const pkg = body.pkg ?? "./internal/workitemsv2/...";
  // Validate pkg: only allow relative Go package paths starting with ./
  if (!/^\.\/[a-zA-Z0-9_./-]+$/.test(pkg) && pkg !== "./...") {
    return new Response(JSON.stringify({ error: "invalid pkg" }), { status: 400 });
  }
  // Validate run: only allow Go test function names (alphanumeric + _)
  const run = body.run;
  if (run !== undefined && !/^[a-zA-Z0-9_]+$/.test(run)) {
    return new Response(JSON.stringify({ error: "invalid run" }), { status: 400 });
  }

  const backendDir = path.join(process.cwd(), "backend");

  const args = ["test", "-v", "-count=1", pkg];
  if (run) args.push("-run", run);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const proc = spawn("go", args, {
        cwd: backendDir,
        env: {
          ...process.env,
          BACKEND_ENV: "dev",
          HOME: process.env.HOME ?? "/root",
          PATH: process.env.PATH ?? "/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin",
          ...(body.env ?? {}),
        },
      });

      const emit = (line: string) => {
        controller.enqueue(encoder.encode(`data: ${line}\n\n`));
      };

      let buf = "";
      const onData = (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) emit(line);
      };

      proc.stdout.on("data", onData);
      proc.stderr.on("data", onData);

      proc.on("close", (code) => {
        if (buf) emit(buf);
        controller.enqueue(encoder.encode(`event: ${code === 0 ? "done" : "fail"}\ndata: exit ${code ?? -1}\n\n`));
        controller.close();
      });

      proc.on("error", (err) => {
        emit(`ERROR: ${err.message}`);
        controller.enqueue(encoder.encode(`event: fail\ndata: spawn error\n\n`));
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
