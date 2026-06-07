// app/components/Grid/__tests__/sprintBoundaryTreeData.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the apiSite workItems.query so we assert the body we send.
const queryMock = vi.fn();
vi.mock("@/app/lib/apiSite", () => ({
  workItems: { query: (...a: unknown[]) => queryMock(...a) },
}));

import { fetchSprintRoots } from "../sprintBoundaryTreeData";

const wire = {
  id: "uuid-1",
  key_num: 17,
  type_prefix: "US",
  artefact_type_id: "type-1",
  title: "Story A",
  flow_state_id: "fs-1",
  flow_state_name: "To Do",
  flow_state_code: "todo",
  story_points: 3,
  sprint: null,
  parent: null,
  owner: null,
  due_date: null,
  children_count: 0,
  colour: "#abcdef",
  prio: 1,
};

describe("fetchSprintRoots", () => {
  beforeEach(() => queryMock.mockReset());

  it("sends filters.sprintId for a real sprint id and maps rows", async () => {
    queryMock.mockResolvedValue({ items: [wire], total: 1 });
    const out = await fetchSprintRoots({ limit: 100, offset: 0 }, "sprint-9");
    expect(queryMock).toHaveBeenCalledWith({
      page: { limit: 100, offset: 0 },
      filters: { sprintId: "sprint-9" },
    });
    expect(out.total).toBe(1);
    expect(out.rows[0].id).toBe("US-17");
    expect(out.rows[0].uuid).toBe("uuid-1");
    expect(out.rows[0].colour).toBe("#abcdef");
  });

  it("sends sprintId='__none__' for the backlog clamp", async () => {
    queryMock.mockResolvedValue({ items: [], total: 0 });
    await fetchSprintRoots({ limit: 100, offset: 0 }, "__none__");
    expect(queryMock).toHaveBeenCalledWith({
      page: { limit: 100, offset: 0 },
      filters: { sprintId: "__none__" },
    });
  });

  it("includes itemTypeId filter when allowed type ids are provided", async () => {
    queryMock.mockResolvedValue({ items: [], total: 0 });
    await fetchSprintRoots({ limit: 100, offset: 0 }, "sprint-9", ["t1", "t2", "t3"]);
    expect(queryMock).toHaveBeenCalledWith({
      page: { limit: 100, offset: 0 },
      filters: { sprintId: "sprint-9", itemTypeId: ["t1", "t2", "t3"] },
    });
  });

  it("omits itemTypeId when no type ids are provided (back-compat)", async () => {
    queryMock.mockResolvedValue({ items: [], total: 0 });
    await fetchSprintRoots({ limit: 100, offset: 0 }, "__none__");
    expect(queryMock).toHaveBeenCalledWith({
      page: { limit: 100, offset: 0 },
      filters: { sprintId: "__none__" },
    });
  });
});
