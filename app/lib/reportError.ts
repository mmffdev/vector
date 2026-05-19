import { apiSite } from "./api";

export async function reportError(
  code: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    await apiSite("/errors/report", {
      method: "POST",
      body: JSON.stringify({ code, context }),
    });
  } catch {
    // intentionally swallowed
  }
}
