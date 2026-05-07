import { describe, it, expect } from "vitest";
import {
  dispatchFrame,
  initialAdoptionState,
  type AdoptionMachineState,
} from "@/app/(user)/portfolio-model/AdoptionOverlay";
import { ADOPTION_STEPS } from "@/app/(user)/portfolio-model/adoptionConstants";

// PLA-0026 / Story 00508 (F2) — adoption stream SSE event-handling assertions.
//
// These tests pin the contract of the pure `dispatchFrame` reducer that
// underlies AdoptionOverlay's SSE handler. The reducer is the side-effect-
// free mirror of the runtime closure inside AdoptionOverlay's useEffect
// (which owns React setState, ctrl.abort, retry scheduling, reportError,
// and onDone/onFail callbacks). The two MUST stay in lockstep — if you
// change the runtime closure, update the reducer (or vice versa).
//
// The post-rewrite saga emits step frames in this order:
//   validate -> layers -> workflows -> transitions -> artifacts ->
//   terminology -> finalize -> done
//
// On `event: fail` mid-saga the orchestrator stops; the overlay must NOT
// continue advancing visual state from any further `event: step` frames.

function stepFrame(name: string, status: "in-progress" | "complete"): {
  event: string;
  data: string;
} {
  return {
    event: "step",
    data: JSON.stringify({ index: ADOPTION_STEPS.indexOf(name as never), name, status }),
  };
}

function feed(
  start: AdoptionMachineState,
  frames: ReadonlyArray<{ event: string; data: string }>,
): AdoptionMachineState {
  return frames.reduce(
    (acc, f) => dispatchFrame(acc, f.event, f.data),
    start,
  );
}

describe("AdoptionOverlay dispatchFrame (PLA-0026 saga)", () => {
  it("initialAdoptionState seeds every step idle and terminal=running", () => {
    const s = initialAdoptionState();
    expect(s.terminal).toBe("running");
    expect(s.lastFail).toBeNull();
    expect(s.doneEvent).toBeNull();
    for (const step of ADOPTION_STEPS) {
      expect(s.statuses[step]).toBe("idle");
    }
  });

  it("processes the full post-rewrite saga and ends in terminal=done", () => {
    // Saga order from PLA-0026 backend rewrite:
    //   validate -> layers -> workflows -> transitions -> artifacts ->
    //   terminology -> finalize -> done.
    // For each step we send in-progress then complete, the same shape the
    // backend emits, and finally the terminal `done` frame.
    const sagaFrames = [
      stepFrame("validate", "in-progress"),
      stepFrame("validate", "complete"),
      stepFrame("layers", "in-progress"),
      stepFrame("layers", "complete"),
      stepFrame("workflows", "in-progress"),
      stepFrame("workflows", "complete"),
      stepFrame("transitions", "in-progress"),
      stepFrame("transitions", "complete"),
      stepFrame("artifacts", "in-progress"),
      stepFrame("artifacts", "complete"),
      stepFrame("terminology", "in-progress"),
      stepFrame("terminology", "complete"),
      stepFrame("finalize", "in-progress"),
      stepFrame("finalize", "complete"),
      {
        event: "done",
        data: JSON.stringify({
          state_id: "abc-123",
          status: "adopted",
          adopted_at: "2026-05-07T00:00:00Z",
        }),
      },
    ];

    const final = feed(initialAdoptionState(), sagaFrames);

    expect(final.terminal).toBe("done");
    expect(final.lastFail).toBeNull();
    expect(final.doneEvent).toEqual({
      state_id: "abc-123",
      status: "adopted",
      adopted_at: "2026-05-07T00:00:00Z",
    });
    for (const step of ADOPTION_STEPS) {
      expect(final.statuses[step]).toBe("complete");
    }
  });

  it("`done` frame promotes any still-idle steps to complete (catch-up)", () => {
    // If the backend collapses intermediate frames, the terminal `done`
    // must still leave the overlay showing every step complete — the user
    // never sees a half-finished diagram next to a 'done' headline.
    const final = feed(initialAdoptionState(), [
      stepFrame("validate", "complete"),
      stepFrame("layers", "in-progress"),
      {
        event: "done",
        data: JSON.stringify({
          state_id: "x",
          status: "adopted",
          adopted_at: "2026-05-07T00:00:00Z",
        }),
      },
    ]);

    expect(final.terminal).toBe("done");
    for (const step of ADOPTION_STEPS) {
      expect(final.statuses[step]).toBe("complete");
    }
  });

  it("a `fail` mid-saga moves terminal to fail and short-circuits later step frames", () => {
    // Walk the saga partway, fail on `transitions`, then attempt to push
    // more `step` frames. The reducer MUST ignore them — once terminal
    // is `fail` no further visual progress is allowed.
    let s = initialAdoptionState();
    s = dispatchFrame(s, "step", JSON.stringify({ index: 0, name: "validate", status: "complete" }));
    s = dispatchFrame(s, "step", JSON.stringify({ index: 1, name: "layers", status: "complete" }));
    s = dispatchFrame(s, "step", JSON.stringify({ index: 2, name: "workflows", status: "complete" }));
    s = dispatchFrame(s, "step", JSON.stringify({ index: 3, name: "transitions", status: "in-progress" }));

    // FAIL hits during transitions.
    s = dispatchFrame(
      s,
      "fail",
      JSON.stringify({
        step: "transitions",
        error_code: "ADOPT_TRANSITIONS_FAILED",
        message: "Could not seed transitions",
      }),
    );

    expect(s.terminal).toBe("fail");
    expect(s.lastFail).toEqual({
      step: "transitions",
      error_code: "ADOPT_TRANSITIONS_FAILED",
      message: "Could not seed transitions",
    });
    expect(s.statuses.transitions).toBe("failed");

    // Snapshot the post-fail state so we can prove the next frames don't
    // mutate it.
    const snapshot: AdoptionMachineState = {
      statuses: { ...s.statuses },
      terminal: s.terminal,
      lastFail: s.lastFail,
      doneEvent: s.doneEvent,
    };

    // Attempt to feed more step frames — the orchestrator may have already
    // queued them before the fail propagated. None should be processed.
    const after = feed(s, [
      stepFrame("artifacts", "in-progress"),
      stepFrame("artifacts", "complete"),
      stepFrame("terminology", "complete"),
      stepFrame("finalize", "complete"),
    ]);

    expect(after.terminal).toBe("fail");
    expect(after.statuses).toEqual(snapshot.statuses);
    expect(after.statuses.artifacts).toBe("idle");
    expect(after.statuses.terminology).toBe("idle");
    expect(after.statuses.finalize).toBe("idle");
    expect(after.statuses.transitions).toBe("failed");
    expect(after.lastFail).toEqual(snapshot.lastFail);
  });

  it("malformed `step` JSON returns state unchanged", () => {
    const start = initialAdoptionState();
    const next = dispatchFrame(start, "step", "{not valid json");
    expect(next).toBe(start);
  });

  it("unknown step name in a `step` frame is ignored", () => {
    const start = initialAdoptionState();
    const next = dispatchFrame(
      start,
      "step",
      JSON.stringify({ index: 99, name: "not-a-real-step", status: "in-progress" }),
    );
    expect(next).toBe(start);
  });

  it("after `done` further `step` frames are ignored (no regression past terminal)", () => {
    const start = initialAdoptionState();
    const afterDone = dispatchFrame(
      start,
      "done",
      JSON.stringify({
        state_id: "x",
        status: "adopted",
        adopted_at: "2026-05-07T00:00:00Z",
      }),
    );
    expect(afterDone.terminal).toBe("done");

    const tryRegress = dispatchFrame(
      afterDone,
      "step",
      JSON.stringify({ index: 0, name: "validate", status: "in-progress" }),
    );
    // Reference equality — short-circuit returns the same object.
    expect(tryRegress).toBe(afterDone);
  });
});
