import { api } from "./api";

export async function reportError(
  code: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    await api("/api/errors/report", {
      method: "POST",
      body: JSON.stringify({ code, context }),
    });
  } catch {
    // intentionally swallowed
  }
}
