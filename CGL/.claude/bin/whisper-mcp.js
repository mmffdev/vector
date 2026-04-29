#!/usr/bin/env node
// MCP stdio server — wraps mlx_whisper CLI for local transcription
const { execFile } = require("child_process");
const readline = require("readline");

const MLX_WHISPER = "/Users/rick/Library/Python/3.9/bin/mlx_whisper";
const DEFAULT_MODEL = "mlx-community/whisper-large-v3-turbo";

const TOOLS = [
  {
    name: "transcribe",
    description: "Transcribe an audio file using local Whisper (mlx-whisper turbo model). Returns the full transcript text.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path to the audio file (m4a, mp3, wav, ogg, flac, mp4, etc.)"
        },
        model: {
          type: "string",
          description: "Hugging Face model ID (default: mlx-community/whisper-large-v3-turbo)",
          default: DEFAULT_MODEL
        }
      },
      required: ["file_path"]
    }
  }
];

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function handleCall(id, name, args) {
  if (name !== "transcribe") {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } });
    return;
  }

  const { file_path, model = DEFAULT_MODEL } = args;
  execFile(MLX_WHISPER, [file_path, "--model", model, "--output-format", "txt"], { timeout: 300000 },
    (err, stdout, stderr) => {
      if (err) {
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${err.message}\n${stderr}` }], isError: true } });
        return;
      }
      // mlx_whisper writes <filename>.txt — read stdout or the file
      const transcript = stdout.trim() || stderr.trim();
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: transcript || "No transcript output." }] } });
    }
  );
}

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  const { id, method, params } = msg;

  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "whisper-local", version: "1.0.0" } } });
  } else if (method === "notifications/initialized") {
    // no-op
  } else if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  } else if (method === "tools/call") {
    handleCall(id, params.name, params.arguments || {});
  } else if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
