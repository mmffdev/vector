import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { AuthProvider, useAuth, type AuthUser } from "@/app/contexts/AuthContext";
import { installFetchStub, restoreFetch, type FetchStub } from "@/app/lib/__tests__/_fetchStub";
import { __setLocksForTest, AUTH_CHANNEL_NAME, type AuthChannelMessage } from "@/app/lib/authChannel";
import { setApiToken } from "@/app/lib/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

let currentUser: AuthUser | null = null;
function Harness() {
  const { user } = useAuth();
  currentUser = user;
  return null;
}

const FAKE_USER = {
  id: "u-1", subscription_id: "s-1", workspace_id: "w-1",
  email: "x@y.z",
  role: { id: "r", code: "user", label: "User", rank: 1, is_system: true, is_external: false },
  is_active: true, force_password_change: false, auth_method: "local" as const,
  permissions: [] as string[],
};

describe("AuthContext.channel refreshed broadcast populates user", () => {
  let stub: FetchStub;
  beforeEach(() => {
    __setLocksForTest({
      request: async (_n: string, _o: unknown, cb?: () => Promise<void>) => { if (cb) await cb(); },
    });
    stub = installFetchStub();
    currentUser = null;
  });
  afterEach(() => {
    __setLocksForTest(undefined);
    restoreFetch();
    setApiToken(null);
  });

  it("fetches /auth/me to populate user when a refreshed broadcast arrives and user is null", async () => {
    // /auth/me returns the user payload (no cookie rotation).
    stub.queue.push({ status: 200, body: FAKE_USER });

    render(<AuthProvider><Harness /></AuthProvider>);

    const sibling = new BroadcastChannel(AUTH_CHANNEL_NAME);
    await act(async () => {
      const msg: AuthChannelMessage = { type: "refreshed", accessToken: "from-sibling", userId: "u-1" };
      sibling.postMessage(msg);
      await new Promise((r) => setTimeout(r, 0));
    });
    sibling.close();

    // A GET /auth/me was made (NOT /auth/refresh — no cookie rotation).
    const meCalls = stub.calls.filter((c) => c.url.includes("/auth/me") && c.method === "GET");
    expect(meCalls).toHaveLength(1);
    expect(stub.calls.filter((c) => c.url.includes("/auth/refresh"))).toHaveLength(0);
    // The user state was populated.
    expect(currentUser?.id).toBe("u-1");
  });
});
