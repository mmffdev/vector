import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/app/contexts/AuthContext";
import { installFetchStub, restoreFetch, type FetchStub } from "@/app/lib/__tests__/_fetchStub";
import { __setLocksForTest } from "@/app/lib/authChannel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

let refreshFn: (() => Promise<void>) | null = null;
function Harness() {
  const { refresh } = useAuth();
  refreshFn = refresh;
  return null;
}

describe("AuthContext.multitab refresh coordination", () => {
  let stub: FetchStub;
  beforeEach(() => {
    __setLocksForTest({
      request: async (_n: string, _o: unknown, cb?: () => Promise<void>) => { if (cb) await cb(); },
    });
    stub = installFetchStub();
  });
  afterEach(() => {
    __setLocksForTest(undefined);
    restoreFetch();
    refreshFn = null;
  });

  it("two concurrent refresh() calls produce exactly ONE /auth/refresh POST", async () => {
    const userObj = {
      id: "u-1", subscription_id: "s-1", workspace_id: "w-1",
      email: "x@y.z",
      role: { id: "r", code: "user", label: "User", rank: 1, is_system: true, is_external: false },
      is_active: true, force_password_change: false, auth_method: "local",
      permissions: [],
    };
    stub.queue.push({ status: 200, body: { access_token: "rotated-token", user: userObj } });
    stub.queue.push({ status: 200, body: { access_token: "rotated-token-2", user: userObj } });

    render(<AuthProvider><Harness /></AuthProvider>);
    expect(refreshFn).not.toBeNull();

    await act(async () => {
      await Promise.all([refreshFn!(), refreshFn!()]);
    });

    const refreshPosts = stub.calls.filter(
      (c) => c.url.includes("/auth/refresh") && c.method === "POST",
    );
    expect(refreshPosts).toHaveLength(1);
  });
});
