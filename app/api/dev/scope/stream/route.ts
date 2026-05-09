import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const filePath = path.resolve(process.cwd(), "Vector_Scope.md");
  const dirPath = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const encoder = new TextEncoder();

  let pending: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let mtimePoll: ReturnType<typeof setInterval> | null = null;
  let dirWatcher: fs.FSWatcher | null = null;
  let lastMtimeMs = (() => {
    try {
      return fs.statSync(filePath).mtimeMs;
    } catch {
      return 0;
    }
  })();

  const cleanup = () => {
    if (pending) clearTimeout(pending);
    if (heartbeat) clearInterval(heartbeat);
    if (mtimePoll) clearInterval(mtimePoll);
    dirWatcher?.close();
  };

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, data: string) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${data}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      send("ready", JSON.stringify({ at: Date.now() }));

      // De-duped fire: only emit if mtime actually advanced. Editors emit
      // bursts of fs events per save; debounce + mtime check collapses them.
      const fire = () => {
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(filePath).mtimeMs;
        } catch {
          return;
        }
        if (mtimeMs <= lastMtimeMs) return;
        lastMtimeMs = mtimeMs;
        send("change", JSON.stringify({ at: Date.now(), mtimeMs }));
      };

      const schedule = () => {
        if (pending) clearTimeout(pending);
        pending = setTimeout(fire, 80);
      };

      // Watch the parent directory, not the file. fs.watch on the file
      // itself loses the watch on atomic-rename saves (write-temp →
      // rename-over) because the inode changes. Watching the directory
      // survives this and catches both rename and modify events.
      try {
        dirWatcher = fs.watch(
          dirPath,
          { persistent: false },
          (_event, filename) => {
            if (filename === baseName) schedule();
          }
        );
      } catch {
        send("error", JSON.stringify({ message: "watch failed" }));
      }

      // Polling backstop. Some workflows (network mounts, certain editors,
      // and Node-on-macOS edge cases) miss fs.watch events entirely.
      // 1s mtime poll guarantees we never lose a save for more than a
      // second — cheap, single stat call per second.
      mtimePoll = setInterval(() => {
        try {
          const m = fs.statSync(filePath).mtimeMs;
          if (m > lastMtimeMs) schedule();
        } catch {
          // file may be temporarily missing during atomic rename
        }
      }, 1000);

      // Heartbeat keeps the connection alive through dev-server proxies
      // that close idle SSE streams.
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          closed = true;
        }
      }, 15000);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
