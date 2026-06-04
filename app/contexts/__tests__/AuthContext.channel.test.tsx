import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/app/contexts/AuthContext";
import { installFetchStub, restoreFetch, type FetchStub } from "@/app/lib/__tests__/_fetchStub";
import { __setLocksForTest, AUTH_CHANNEL_NAME, type AuthChannelMessage } from "@/app/lib/authChannel";
import { getApiToken, setApiToken } from "@/app/lib/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function Harness() {
  useAuth();
  return null;
}

describe("AuthContext.channel listener", () => {
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
    setApiToken(null);
  });

  it("adopts the access token from a 'refreshed' broadcast without a network call", async () => {
    render(<AuthProvider><Harness /></AuthProvider>);

    const sibling = new BroadcastChannel(AUTH_CHANNEL_NAME);
    await act(async () => {
      const msg: AuthChannelMessage = { type: "refreshed", accessToken: "from-sibling", userId: "u-1" };
      sibling.postMessage(msg);
      await new Promise((r) => setTimeout(r, 0));
    });
    sibling.close();

    expect(getApiToken()).toBe("from-sibling");
    expect(stub.calls.filter((c) => c.url.includes("/auth/refresh"))).toHaveLength(0);
  });
});
