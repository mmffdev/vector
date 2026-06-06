import { describe, it, expect } from "vitest";
import {
  buildCreateRequests,
  type CreateDraft,
  type CreateTypeFlags,
} from "../buildCreateRequests";

const emptyDraft: CreateDraft = {
  title: "",
  description_doc: null,
  parent_id: "",
  topology_node_id: "",
  flow_state_id: "",
  owner_id: "",
  sprint_id: "",
  release_id: "",
  milestone_id: "",
  story_points: "",
  colour: "",
};

const execFlags: CreateTypeFlags = {
  itemType: "story",
  showSprint: true,
  showRelease: true,
  showPlanEstimate: true,
};

function build(over: Partial<CreateDraft>, flags = execFlags, opts?: Partial<{ resourceUrl: string; activeScopeNodeId: string | null; descriptionPlaintext: string; customWire: unknown[] }>) {
  return buildCreateRequests({
    draft: { ...emptyDraft, title: "A title", ...over },
    flags,
    descriptionPlaintext: opts?.descriptionPlaintext ?? "",
    customWire: opts?.customWire ?? [],
    resourceUrl: opts?.resourceUrl ?? "/work-items",
    activeScopeNodeId: opts?.activeScopeNodeId ?? null,
  });
}

describe("buildCreateRequests", () => {
  it("POSTs item_type + trimmed title at minimum", () => {
    const r = build({ title: "  Hello  " });
    expect(r.postBody).toEqual({ item_type: "story", title: "Hello" });
    expect(r.patchBody).toEqual({});
  });

  it("routes create-accepted fields to the POST body", () => {
    const r = build(
      { parent_id: "p1", sprint_id: "s1", story_points: "5" },
      execFlags,
      { descriptionPlaintext: "desc", customWire: [{ field_library_id: "f1", text_value: "x" }] },
    );
    expect(r.postBody).toMatchObject({
      item_type: "story",
      title: "A title",
      description: "desc",
      parent_id: "p1",
      sprint_id: "s1",
      story_points: 5,
      custom_fields: [{ field_library_id: "f1", text_value: "x" }],
    });
  });

  it("routes patch-only fields to the follow-up PATCH, not the POST", () => {
    const doc = { type: "doc", content: [] };
    const r = build({
      release_id: "r1",
      milestone_id: "m1",
      flow_state_id: "fs1",
      owner_id: "u1",
      colour: "#abc",
      description_doc: doc,
    });
    expect(r.postBody).toEqual({ item_type: "story", title: "A title" });
    expect(r.patchBody).toEqual({
      release_id: "r1",
      milestone_id: "m1",
      flow_state_id: "fs1",
      owned_by_user_id: "u1",
      colour: "#abc",
      description_doc: doc,
    });
  });

  it("appends ?meg= from the form's topology pick, encoded", () => {
    const r = build({ topology_node_id: "node-with space" });
    expect(r.postUrl).toBe("/work-items?meg=node-with%20space");
  });

  it("falls back to activeScopeNodeId for ?meg= when the form leaves topology unset", () => {
    const r = build({}, execFlags, { activeScopeNodeId: "active-node" });
    expect(r.postUrl).toBe("/work-items?meg=active-node");
  });

  it("emits no ?meg= when neither form nor active scope provides a node", () => {
    const r = build({});
    expect(r.postUrl).toBe("/work-items");
  });

  it("strips GET-only query params from resourceUrl before adding ?meg= or /<id>", () => {
    const r = build(
      { topology_node_id: "n1" },
      execFlags,
      { resourceUrl: "/work-items?item_type_id=abc-123" },
    );
    expect(r.postPath).toBe("/work-items");
    expect(r.postUrl).toBe("/work-items?meg=n1");
  });

  it("omits sprint/release/story_points when the type hides those capabilities", () => {
    const strategicFlags: CreateTypeFlags = {
      itemType: "theme",
      showSprint: false,
      showRelease: false,
      showPlanEstimate: false,
    };
    const r = build(
      { sprint_id: "s1", release_id: "r1", story_points: "8" },
      strategicFlags,
    );
    expect(r.postBody.sprint_id).toBeUndefined();
    expect(r.postBody.story_points).toBeUndefined();
    expect(r.patchBody.release_id).toBeUndefined();
  });

  it("ignores non-numeric story_points", () => {
    const r = build({ story_points: "abc" });
    expect(r.postBody.story_points).toBeUndefined();
  });

  it("omits rank_placement when default/bottom (back-compat)", () => {
    expect(build({}).postBody.rank_placement).toBeUndefined();
    const r = buildCreateRequests({
      draft: { ...emptyDraft, title: "x" },
      flags: execFlags,
      descriptionPlaintext: "",
      customWire: [],
      resourceUrl: "/work-items",
      activeScopeNodeId: null,
      rankPlacement: "bottom",
    });
    expect(r.postBody.rank_placement).toBeUndefined();
  });

  it("sends rank_placement=top when chosen", () => {
    const r = buildCreateRequests({
      draft: { ...emptyDraft, title: "x" },
      flags: execFlags,
      descriptionPlaintext: "",
      customWire: [],
      resourceUrl: "/work-items",
      activeScopeNodeId: null,
      rankPlacement: "top",
    });
    expect(r.postBody.rank_placement).toBe("top");
    expect(r.postBody.after_artefact_id).toBeUndefined();
  });

  it("sends rank_placement=after with the source id (duplicate)", () => {
    const r = buildCreateRequests({
      draft: { ...emptyDraft, title: "x" },
      flags: execFlags,
      descriptionPlaintext: "",
      customWire: [],
      resourceUrl: "/work-items",
      activeScopeNodeId: null,
      rankPlacement: "after",
      afterArtefactId: "src-uuid-123",
    });
    expect(r.postBody.rank_placement).toBe("after");
    expect(r.postBody.after_artefact_id).toBe("src-uuid-123");
  });

  it("omits after_artefact_id when 'after' has no source (defensive)", () => {
    const r = buildCreateRequests({
      draft: { ...emptyDraft, title: "x" },
      flags: execFlags,
      descriptionPlaintext: "",
      customWire: [],
      resourceUrl: "/work-items",
      activeScopeNodeId: null,
      rankPlacement: "after",
      afterArtefactId: null,
    });
    expect(r.postBody.rank_placement).toBe("after");
    expect(r.postBody.after_artefact_id).toBeUndefined();
  });
});
