import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { useStepUpAction } from "@/app/hooks/useStepUpAction";
import ReauthModal from "@/app/components/ReauthModal";
import { apiSite, setApiToken, setRefreshCallback } from "@/app/lib/api";
import { installFetchStub, restoreFetch, type FetchStub } from "@/app/lib/__tests__/_fetchStub";
import { AuthContext, type AuthUser } from "@/app/contexts/AuthContext";

// B16.8.10 — contract tests for the per-action step-up reauth hook.
//
// Pinned behaviours:
//   1. First attempt fires fn({}) with no proof header. 200 → resolve.
//   2. 409 reauth_required → modal opens (open=true). Caller has not
//      yet seen a result.
//   3. User submits → hook POSTs /auth/reauth, gets action_proof,
//      retries fn with X-Action-Proof header. 200 → resolve.
//   4. 401 reauth_invalid on retry → modal stays open with error,
//      busy=false, caller still waiting.
//   5. Wrong password (401 from /auth/reauth) → modal stays open with
//      error.
//   6. Cancel → reject with "reauth_cancelled".

const stubUser: AuthUser = {
  id: "u1",
  subscription_id: "s1",
  workspace_id: "",
  email: "u1@test.local",
  role: { id: "r", code: "user", label: "User", rank: 10, is_system: false, is_external: false },
  is_active: true,
  force_password_change: false,
  auth_method: "local",
  mfa_enrolled: false,
  permissions: [],
};

const stubAuth = {
  user: stubUser,
  role: stubUser.role,
  loading: false,
  permissions: new Set<string>(),
  hasPermission: () => false,
  login: async () => stubUser,
  mfaLogin: async () => stubUser,
  logout: async () => {},
  refresh: async () => {},
  switchWorkspace: async () => stubUser,
  setUser: () => {},
};

function Harness({
  onResult,
  onError,
  trigger,
}: {
  onResult: (v: unknown) => void;
  onError: (e: unknown) => void;
  trigger?: { current: null | (() => Promise<unknown>) };
}) {
  const stepUp = useStepUpAction({ actionKey: "delete-workspace", actionLabel: "Delete workspace" });

  // Expose the run-promise to the test so it can await it directly,
  // not via the click handler's hidden async continuation. Guarded so
  // re-renders (state changes when the modal opens) don't clobber a
  // call that's already in flight.
  if (trigger && trigger.current === null) {
    trigger.current = () => stepUp.run(async (headers) => {
      await apiSite("/workspaces/ws1", { method: "DELETE", headers });
      return 204;
    });
  }
  return (
    <>
      <button
        onClick={async () => {
          try {
            const v = await stepUp.run(async (headers) => {
              await apiSite("/workspaces/ws1", { method: "DELETE", headers });
              return 204;
            });
            onResult(v);
          } catch (e) {
            onError(e);
          }
        }}
      >
        run
      </button>
      <ReauthModal {...stepUp.modalProps} />
    </>
  );
}

function mount(
  onResult: (v: unknown) => void = () => {},
  onError: (e: unknown) => void = () => {},
  trigger?: { current: null | (() => Promise<unknown>) },
) {
  return render(
    <AuthContext.Provider value={stubAuth}>
      <Harness onResult={onResult} onError={onError} trigger={trigger} />
    </AuthContext.Provider>,
  );
}

describe("useStepUpAction", () => {
  let stub: FetchStub;
  beforeEach(() => {
    stub = installFetchStub();
    setApiToken("dummy-token");
    // Disable silent refresh so 401s on /auth/reauth propagate cleanly.
    setRefreshCallback(null);
  });
  afterEach(() => {
    restoreFetch();
    setApiToken(null);
    setRefreshCallback(null);
  });

  it("first attempt resolves directly when backend returns 2xx", async () => {
    let result: unknown = "PENDING";
    // Note: stub uses Web Response which rejects bodies on 204 — use 200
    // with an empty-object body so the fetch path returns cleanly.
    stub.queue.push({ status: 200, body: {} });
    mount((v) => { result = v; });
    await act(async () => {
      fireEvent.click(screen.getByText("run"));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(result).toBe(204);
    // Modal never opened.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the modal on 409 reauth_required", async () => {
    let result: unknown = "PENDING";
    stub.queue.push({
      status: 409,
      body: { type: "about:blank", title: "Conflict", status: 409, code: "reauth_required", detail: "..." },
    });
    mount((v) => { result = v; });
    await act(async () => {
      fireEvent.click(screen.getByText("run"));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(result).toBe("PENDING"); // hook hasn't resolved
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("submits password → reauth → retries with X-Action-Proof → resolves", async () => {
    // 1: original DELETE → 409 reauth_required
    stub.queue.push({
      status: 409,
      body: { type: "about:blank", title: "Conflict", status: 409, code: "reauth_required", detail: "..." },
    });
    // 2: POST /_site/auth/reauth → 200 with proof
    stub.queue.push({
      status: 200,
      body: { action_proof: "proof-xyz", expires_at: new Date(Date.now() + 60000).toISOString() },
    });
    // 3: retry DELETE → 204
    // Note: stub uses Web Response which rejects bodies on 204 — use 200
    // with an empty-object body so the fetch path returns cleanly.
    stub.queue.push({ status: 200, body: {} });

    const trigger: { current: null | (() => Promise<unknown>) } = { current: null };
    mount(() => {}, () => {}, trigger);

    // Start the run; capture the promise directly so we await it
    // rather than relying on the click handler's hidden async continuation.
    let runPromise!: Promise<unknown>;
    await act(async () => {
      runPromise = trigger.current!();
      await new Promise((r) => setTimeout(r, 10));
    });
    // Modal open — submit password.
    const passwordInput = screen.getByLabelText(/Password/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(passwordInput, { target: { value: "hunter2" } });
      fireEvent.submit(passwordInput.closest("form")!);
    });
    const result = await runPromise;

    expect(result).toBe(204);
    // Retry call carried the proof header.
    const retryCall = stub.calls[2];
    expect(retryCall.headers["x-action-proof"]).toBe("proof-xyz");
  });

  it("wrong password → modal stays open with error", async () => {
    let result: unknown = "PENDING";
    stub.queue.push({
      status: 409,
      body: { type: "about:blank", title: "Conflict", status: 409, code: "reauth_required", detail: "..." },
    });
    stub.queue.push({
      status: 401,
      body: { type: "about:blank", title: "Unauthorized", status: 401, detail: "Your current password is incorrect." },
    });

    mount((v) => { result = v; });
    await act(async () => {
      fireEvent.click(screen.getByText("run"));
      await new Promise((r) => setTimeout(r, 10));
    });
    const passwordInput = screen.getByLabelText(/Password/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(passwordInput, { target: { value: "wrong" } });
      fireEvent.submit(passwordInput.closest("form")!);
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(result).toBe("PENDING");
    // Modal still open, error rendered.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/password.*incorrect/i);
  });

  it("cancel rejects with reauth_cancelled", async () => {
    let caught: unknown = "PENDING";
    stub.queue.push({
      status: 409,
      body: { type: "about:blank", title: "Conflict", status: 409, code: "reauth_required", detail: "..." },
    });

    mount(() => {}, (e) => { caught = e; });
    await act(async () => {
      fireEvent.click(screen.getByText("run"));
      await new Promise((r) => setTimeout(r, 10));
    });
    // Click Cancel.
    await act(async () => {
      fireEvent.click(screen.getByText("Cancel"));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("reauth_cancelled");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
