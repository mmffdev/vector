import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jktFromAccessToken } from "@/app/lib/dpop";
import { readBoundJKT, writeBoundJKT } from "@/app/lib/authChannel";

// TD-SEC-DPOP-STALE-KEY Residual A — the bound-JKT is the data that lets the
// client pick the session-bound DPoP key on bootstrap instead of guessing
// "newest". These pin the two primitives: decode cnf.jkt from the access
// token, and persist/read the bound JKT.

function makeJWT(payload: object): string {
  const b64url = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;
}

describe("dpop.unit jktFromAccessToken", () => {
  it("extracts cnf.jkt from a token that carries the confirmation claim", () => {
    const token = makeJWT({ sub: "u-1", cnf: { jkt: "zBs7nN_U6X3zFLwBoygXkSOhF6tDeZ7XiHkwi4mtApo" } });
    expect(jktFromAccessToken(token)).toBe("zBs7nN_U6X3zFLwBoygXkSOhF6tDeZ7XiHkwi4mtApo");
  });

  it("returns null when the token has no cnf claim (legacy token)", () => {
    expect(jktFromAccessToken(makeJWT({ sub: "u-1" }))).toBeNull();
  });

  it("returns null for malformed / empty input", () => {
    expect(jktFromAccessToken(null)).toBeNull();
    expect(jktFromAccessToken("")).toBeNull();
    expect(jktFromAccessToken("not-a-jwt")).toBeNull();
    expect(jktFromAccessToken("a.b")).toBeNull(); // payload "b" isn't valid base64 JSON
  });
});

describe("authChannel.unit bound-JKT persistence", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });
  afterEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("write then read round-trips the bound JKT", () => {
    expect(readBoundJKT()).toBeNull();
    writeBoundJKT("zBs7nN_U6X");
    expect(readBoundJKT()).toBe("zBs7nN_U6X");
  });

  it("writeBoundJKT(null) clears the stored value", () => {
    writeBoundJKT("zBs7nN_U6X");
    writeBoundJKT(null);
    expect(readBoundJKT()).toBeNull();
  });
});
