"use client";

import { useRef, useState } from "react";
import Panel from "@/app/components/Panel";

const PKG = "./internal/workitemsv2/...";

type TestStatus = "idle" | "running" | "pass" | "fail";

type TestEntry = {
  name: string;
  group: string;
  panelName: string;
};

const TESTS: TestEntry[] = [
  // Handler tests — no DB required
  { group: "Handler · nil-pool", panelName: "dev_api_v2_handler_nilpool", name: "TestHandler_List_NilPool" },
  { group: "Handler · nil-pool", panelName: "dev_api_v2_handler_nilpool", name: "TestHandler_Get_InvalidUUID" },
  { group: "Handler · nil-pool", panelName: "dev_api_v2_handler_nilpool", name: "TestHandler_Get_NotFound" },
  { group: "Handler · nil-pool", panelName: "dev_api_v2_handler_nilpool", name: "TestHandler_Create_MissingBody" },
  { group: "Handler · nil-pool", panelName: "dev_api_v2_handler_nilpool", name: "TestHandler_Bulk_InvalidBody" },
  { group: "Handler · nil-pool", panelName: "dev_api_v2_handler_nilpool", name: "TestHandler_Bulk_UnsupportedOp" },
  { group: "Handler · nil-pool", panelName: "dev_api_v2_handler_nilpool", name: "TestHandler_Patch_InvalidDueDate" },
  { group: "Handler · nil-pool", panelName: "dev_api_v2_handler_nilpool", name: "TestHandler_Summary_ContentType" },
  { group: "Handler · nil-pool", panelName: "dev_api_v2_handler_nilpool", name: "TestHandler_FlowStates_EmptyPool" },
  // Handler tests — DB required
  { group: "Handler · DB", panelName: "dev_api_v2_handler_db", name: "TestHandler_List_WithDB" },
  { group: "Handler · DB", panelName: "dev_api_v2_handler_db", name: "TestHandler_Create_ThenGet" },
  { group: "Handler · DB", panelName: "dev_api_v2_handler_db", name: "TestHandler_Archive_Returns204" },
  { group: "Handler · DB", panelName: "dev_api_v2_handler_db", name: "TestHandler_Bulk_SetPriority" },
  // Service tests — list
  { group: "Service · list", panelName: "dev_api_v2_service_list", name: "TestListWorkItems_ReturnsTenantRows" },
  { group: "Service · list", panelName: "dev_api_v2_service_list", name: "TestListWorkItems_CrossTenantIsolation" },
  { group: "Service · list", panelName: "dev_api_v2_service_list", name: "TestListWorkItems_Pagination" },
  { group: "Service · list", panelName: "dev_api_v2_service_list", name: "TestListWorkItems_ItemTypeFilter" },
  { group: "Service · list", panelName: "dev_api_v2_service_list", name: "TestListWorkItems_SortWhitelist" },
  // Service tests — nil-pool
  { group: "Service · nil-pool", panelName: "dev_api_v2_service_nilpool", name: "TestNilPool_ReturnsEmpty" },
  // Service tests — get
  { group: "Service · get", panelName: "dev_api_v2_service_get", name: "TestGetWorkItem_NotFound" },
  { group: "Service · get", panelName: "dev_api_v2_service_get", name: "TestGetWorkItem_CrossTenantBlocked" },
  // Service tests — create
  { group: "Service · create", panelName: "dev_api_v2_service_create", name: "TestCreateWorkItem_StoresRow" },
  { group: "Service · create", panelName: "dev_api_v2_service_create", name: "TestCreateWorkItem_TaskRejectsPoints" },
  { group: "Service · create", panelName: "dev_api_v2_service_create", name: "TestCreateWorkItem_EmptyTitleRejected" },
  // Service tests — patch
  { group: "Service · patch", panelName: "dev_api_v2_service_patch", name: "TestPatchWorkItem_UpdatesTitle" },
  { group: "Service · patch", panelName: "dev_api_v2_service_patch", name: "TestPatchWorkItem_DueDate_SetAndClear" },
  { group: "Service · patch", panelName: "dev_api_v2_service_patch", name: "TestPatchWorkItem_NotFound" },
  // Service tests — archive
  { group: "Service · archive", panelName: "dev_api_v2_service_archive", name: "TestArchiveWorkItem_SoftDeletes" },
  { group: "Service · archive", panelName: "dev_api_v2_service_archive", name: "TestArchiveWorkItem_CrossTenantBlocked" },
  // Service tests — query
  { group: "Service · query", panelName: "dev_api_v2_service_query", name: "TestSummariseWorkItems_CountsWorkScoped" },
  { group: "Service · query", panelName: "dev_api_v2_service_query", name: "TestListFlowStates_ReturnsStates" },
  { group: "Service · query", panelName: "dev_api_v2_service_query", name: "TestListChildren_ReturnsOnlyDirectChildren" },
  // Service tests — bulk
  { group: "Service · bulk", panelName: "dev_api_v2_service_bulk", name: "TestBulkOps_UnsupportedOp" },
  { group: "Service · bulk", panelName: "dev_api_v2_service_bulk", name: "TestBulkOps_EmptyIDs" },
  { group: "Service · bulk", panelName: "dev_api_v2_service_bulk", name: "TestBulkOps_CrossTenantRejected" },
];

type TestState = {
  status: TestStatus;
  lines: string[];
  open: boolean;
};

const initialState = (): TestState => ({ status: "idle", lines: [], open: false });

function statusClass(status: TestStatus): string {
  if (status === "pass") return " dui-accordion__toggle--pass";
  if (status === "fail") return " dui-accordion__toggle--fail";
  return "";
}

function statusLabel(status: TestStatus): string {
  if (status === "running") return "…";
  if (status === "pass") return "PASS";
  if (status === "fail") return "FAIL";
  return "";
}

function TestRow({
  entry,
  state,
  onRun,
  onToggle,
}: {
  entry: TestEntry;
  state: TestState;
  onRun: () => void;
  onToggle: () => void;
}) {
  const outputRef = useRef<HTMLPreElement>(null);

  return (
    <div className="dui-accordion__item">
      <button
        className={`dui-accordion__toggle${statusClass(state.status)}`}
        onClick={() => {
          if (state.status === "idle") {
            onRun();
          } else {
            onToggle();
          }
        }}
        disabled={state.status === "running"}
      >
        <span className="dui-accordion__name">{entry.name}</span>
        {state.status !== "idle" && (
          <span style={{ marginLeft: "auto", fontSize: "0.75rem", fontVariantNumeric: "tabular-nums" }}>
            {statusLabel(state.status)}
          </span>
        )}
        {state.status !== "idle" && (
          <span className={`dui-accordion__chevron${state.open ? "" : " dui-accordion__chevron--closed"}`} />
        )}
      </button>
      {state.open && state.lines.length > 0 && (
        <div className="dui-accordion__body dui-accordion__body--flush">
          <pre
            ref={outputRef}
            style={{
              margin: 0,
              padding: "0.5rem 0.75rem",
              fontSize: "0.7rem",
              lineHeight: 1.5,
              overflowX: "auto",
              maxHeight: "20rem",
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {state.lines.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function DevApiV2TestsPanel() {
  const [states, setStates] = useState<Record<string, TestState>>(() =>
    Object.fromEntries(TESTS.map(t => [t.name, initialState()]))
  );
  const [runAllStatus, setRunAllStatus] = useState<TestStatus>("idle");
  const abortRefs = useRef<Record<string, AbortController>>({});

  function setTestState(name: string, updater: (prev: TestState) => TestState) {
    setStates(prev => ({ ...prev, [name]: updater(prev[name] ?? initialState()) }));
  }

  async function runTest(name: string) {
    abortRefs.current[name]?.abort();
    const controller = new AbortController();
    abortRefs.current[name] = controller;

    setTestState(name, () => ({ status: "running", lines: [], open: true }));

    try {
      const res = await fetch("/api/dev/go-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pkg: PKG, run: name }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setTestState(name, prev => ({ ...prev, status: "fail", lines: [`HTTP ${res.status}`] }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const event of events) {
          const lines = event.split("\n");
          let isTerminal = false;
          let exitOk = true;
          for (const line of lines) {
            if (line.startsWith("event: done")) { isTerminal = true; exitOk = true; }
            else if (line.startsWith("event: fail")) { isTerminal = true; exitOk = false; }
            else if (line.startsWith("data: ")) {
              const text = line.slice(6);
              if (!isTerminal) {
                setTestState(name, prev => ({ ...prev, lines: [...prev.lines, text] }));
              } else {
                setTestState(name, prev => ({
                  ...prev,
                  status: exitOk ? "pass" : "fail",
                  lines: [...prev.lines, text],
                }));
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setTestState(name, prev => ({
          ...prev,
          status: "fail",
          lines: [...prev.lines, `Error: ${err?.message ?? err}`],
        }));
      }
    }
  }

  async function runAll() {
    setRunAllStatus("running");
    for (const t of TESTS) {
      await runTest(t.name);
    }
    setRunAllStatus("idle");
  }

  function toggleOpen(name: string) {
    setTestState(name, prev => ({ ...prev, open: !prev.open }));
  }

  // Group tests
  const groups: Record<string, TestEntry[]> = {};
  for (const t of TESTS) {
    (groups[t.group] ??= []).push(t);
  }
  const groupPanelName = (entries: TestEntry[]) => entries[0].panelName;

  const total = TESTS.length;
  const passed = TESTS.filter(t => states[t.name]?.status === "pass").length;
  const failed = TESTS.filter(t => states[t.name]?.status === "fail").length;

  return (
    <div className="dui-page">
      {TESTS.map(t => t.name).some(n => states[n]?.status === "running") ? null : null}
      <Panel name="dev_api_v2_tests_run" title="Run">
        <div className="dui-toolbar dui-toolbar--in-panel">
          <button
            className="dui-btn dui-btn--primary dui-btn--sm"
            onClick={runAll}
            disabled={runAllStatus === "running"}
          >
            {runAllStatus === "running" ? "Running…" : "Run all"}
          </button>
          <span className="dui-toolbar__spacer" />
          <span style={{ fontSize: "0.78rem", color: "var(--color-text-muted, #888)" }}>
            {passed > 0 && <span style={{ color: "var(--color-success, #22c55e)" }}>{passed} pass</span>}
            {passed > 0 && failed > 0 && " · "}
            {failed > 0 && <span style={{ color: "var(--color-danger, #ef4444)" }}>{failed} fail</span>}
            {passed === 0 && failed === 0 && `${total} tests`}
          </span>
        </div>
      </Panel>

      {Object.entries(groups).map(([group, entries]) => (
        <Panel key={group} name={groupPanelName(entries)} title={group}>
          <div className="dui-accordion">
            {entries.map(entry => (
              <TestRow
                key={entry.name}
                entry={entry}
                state={states[entry.name] ?? initialState()}
                onRun={() => runTest(entry.name)}
                onToggle={() => toggleOpen(entry.name)}
              />
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}
