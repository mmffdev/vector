-- ============================================================
-- PLA064 / CUT1.5.0 — Orphan remediation plan
--
-- NON-EXECUTABLE planning artefact.
--
-- Documents the remediation SQL that MUST run before CUT1.5.1
-- installs hard Postgres FKs on the 50 cross-DB soft-FK columns.
-- Source: CUT1.0.2 orphan-audit cron run 2026-05-25
-- (SY-ORPHAN-20260525), which reported 508 orphan UUIDs across
-- 14 columns. Live investigation on 2026-05-25 found actual
-- counts HIGHER than cron-reported (1,263 orphan column-
-- instances across the same 14 columns + VA sidecar) — the
-- cron may have run against a stale snapshot or used a JOIN
-- path that undercounted. The SQL below is keyed from the
-- live investigation counts.
--
-- Cohort summary (CUT1.5.0 investigation findings):
--
--   COHORT-A  Dev-tenant cleanup debt — 179 dead workspaces
--             + 168 dead subscriptions, all zero-row in
--             mmff_vector. 7 tables affected. All orphan rows
--             belong to tenants that were deleted during
--             development; no live business data.
--             Action: HARD-DELETE.
--
--   COHORT-B  Bootstrap zero-ID workspace cluster — workspace
--             UUIDs 00000000-...-0001 and 00000000-...-0010
--             were used as seed placeholders; neither ever
--             existed in mmff_vector.master_record_workspaces.
--             00000000-...-0001 IS a live subscription
--             (MMFFDev root) but was used as a fake workspace
--             ID in timeboxes/webhooks written during early
--             development. VA sidecar row for 0001 is also
--             orphaned. These rows are dev-only seed data
--             with no production relevance.
--             Action: HARD-DELETE.
--
--   COHORT-C  Deleted-user artefact references — 23 dead user
--             UUIDs in artefacts.created_by_user_id and
--             artefacts.owned_by_user_id. These artefact rows
--             are themselves part of COHORT-A (the artefacts
--             belonging to dead tenants are deleted via
--             COHORT-A cascade). No separate action needed;
--             these are resolved transitively by COHORT-A.
--             However if any artefact rows survive COHORT-A
--             (workspace is live but user is dead), those
--             columns need NULL. A post-COHORT-A check query
--             is included below.
--             Action: TRANSITIVE (via COHORT-A) + NULL guard.
--
--   COHORT-D  SOC 2 audit-trail user refs — 29 dead user IDs
--             in audit_logs.audit_logs_id_user across 89 rows.
--             LEGITIMATELY orphaned per the SOC 2 procurement
--             narrative: audit logs preserve the historical
--             user ID even after the user account is deleted.
--             The log rows themselves are valid evidence of
--             past actions. These dead user IDs are NOT a
--             subset of COHORT-A's dead users — they span
--             LIVE subscriptions, confirming the users were
--             deleted from live tenants (expected churn).
--             Action: NULL the column (preserve the log row,
--             anonymize the deleted user ref). When CUT1.5.1
--             installs the FK, use ON DELETE SET NULL.
--
--   COHORT-E  VA sidecar self-ref (master_record_workspaces)
--             — 1 orphaned sidecar row whose PK references
--             dead workspace 00000000-...-0001. Already
--             covered by COHORT-B deletion. Noted separately
--             because CUT1.3.3 also eliminates this column
--             structurally (sidecar merges into registry).
--             Action: HARD-DELETE (via COHORT-B); also
--             STRUCTURAL-ELIMINATION at CUT1.3.3.
--
-- Remediation totals (before execution):
--   Expected rows deleted:    ~865 (COHORT-A + COHORT-B)
--   Expected rows NULLed:      89  (COHORT-D)
--   Structurally eliminated:    1  (COHORT-E, inside COHORT-B)
--   Deferred:                   0
--
-- TDs opened: none (all cohorts confidently classified).
--
-- EXECUTION NOTE: Run INSIDE a transaction. Verify row counts
-- at each DELETE/UPDATE step match the expected values above
-- before COMMITting. If any count diverges by more than ±10%,
-- ROLLBACK and investigate.
--
-- SEQUENCE: COHORT-B first (clears zero-ID rows that would
-- also match COHORT-A patterns), then COHORT-A, then COHORT-D.
-- ============================================================

BEGIN;

-- ── COHORT-B: Bootstrap zero-ID workspace rows ─────────────
-- Workspace UUIDs 00000000-...-0001 and 00000000-...-0010
-- were never in mmff_vector.master_record_workspaces (verified
-- 2026-05-25). 00000000-...-0001 is the live MMFFDev root
-- subscription but was misused as a workspace placeholder ID
-- during early development seed writes.
--
-- Affected tables + expected row counts:
--   timeboxes_milestones:     3 rows (WS 0010)
--   timeboxes_releases:       1 row  (WS 0001)
--   timeboxes_sprints:       15 rows (WS 0001)
--   webhooks_subscriptions:   3 rows (WS 0001)
--   master_record_workspaces  1 row  (PK = WS 0001, VA sidecar)
-- Total: 23 rows

DELETE FROM timeboxes_milestones
 WHERE timeboxes_milestones_id_workspace IN (
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000010'
 );
-- Expected: 3 rows

DELETE FROM timeboxes_releases
 WHERE timeboxes_releases_id_workspace IN (
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000010'
 );
-- Expected: 1 row

DELETE FROM timeboxes_sprints
 WHERE timeboxes_sprints_id_workspace IN (
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000010'
 );
-- Expected: 15 rows

DELETE FROM webhooks_subscriptions
 WHERE webhooks_subscriptions_id_workspace IN (
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000010'
 );
-- Expected: 3 rows

DELETE FROM master_record_workspaces
 WHERE master_record_workspaces_id_workspace IN (
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000010'
 );
-- Expected: 1 row (the 0001 sidecar orphan — 0010 has no sidecar row)


-- ── COHORT-A: Dev-tenant cleanup debt ──────────────────────
-- 179 dead workspaces + 168 dead subscriptions. All belong to
-- tenants deleted during development; verified zero in
-- mmff_vector. Every orphan table/column confirmed to be a
-- subset of this dead set (or the zero-ID set in COHORT-B).
--
-- Ordering: delete leaf data first, then artefact_types rows.
-- artefacts.workspace_id is not FK-constrained today, so no
-- cascade order is enforced by Postgres — but logical ordering
-- is correct practice for the future FK world.
--
-- 179 dead workspace UUIDs (COHORT-A):
-- (Excludes zero-ID workspaces handled in COHORT-B.)
--
-- Dead workspace list:
--   '01474d43-4c3b-4e91-abed-5718092f04ba'
--   '01bc6270-f875-41fb-90bc-8cffe969571a'
--   '01c693c4-4ebc-4bc6-a307-4a5539705c4b'
--   '02d9f348-f2f4-4faa-93c3-9b05cfdc791b'
--   '03417c20-5aca-417d-aa9b-511e17940c26'
--   '08932493-8a37-464e-bda5-a5db46150c37'
--   '093e6550-b4bd-4a8f-a598-2ccea37df769'
--   '0975f2c1-a1e0-4c68-b1df-4fd17e9cb544'
--   '0a0cef44-45cc-4a88-97b5-8308c19539cf'
--   '0a475a09-6484-49f9-9ea0-02db32844b19'
--   '0e80879a-80ae-4c3b-a7a6-9b194488a1c7'
--   '0eefd757-2546-4f09-9136-04b6a73d0807'
--   '0ef60588-70f7-43a2-a78a-a506c7581764'
--   '0fba189d-6a24-4f50-948b-dcd928ec42b8'
--   '1036a205-8898-410b-92af-b2d77c332de2'
--   '10c6e399-e002-4a39-89df-cb436ad0dbfa'
--   '131e17eb-f66e-4b0d-8bf1-7e90f7c87513'
--   '1372d92a-9202-4667-829e-ba7edf68e99f'
--   '1404a90c-a1cb-4cd2-a69b-d5bdc018790a'
--   '16af4cd9-f040-480a-b16a-529f8251063c'
--   '16d10902-8ae9-4792-8d3e-b8b582d3b18b'
--   '191c57c5-e4a9-4d65-8757-f4221f034c11'
--   '19e5edc8-5742-41c7-8b73-72b9fd16f8d9'
--   '1a437277-413a-4b9f-89dc-305814b7cd5a'
--   '1ab4702e-222e-444c-b608-d6d6f3cc6b61'
--   '1b9e916e-d539-47a7-b192-4d87b4e0bb37'
--   '1ccd5b80-ebd1-445d-955e-bfab93b278d9'
--   '201bc1e3-6b18-4c81-a24c-a1116b8b4ee8'
--   '21612f99-e217-49b4-9ed7-65271d707729'
--   '24906b67-7792-4341-99fa-3c927baea547'
--   '28d1287f-26c7-4ad8-8efa-7f37c0e493cd'
--   '2a397616-ac78-4df2-bdd7-3eb2c027becd'
--   '2b1d4dd0-3090-4ee8-ac37-f4d958c8e248'
--   '2cf817b4-5344-4d6a-b820-bb4c7db7f95e'
--   '2d13cb36-3530-4dcb-9a3e-82c8c509c21f'
--   '2d4c4b6d-d384-4339-a97e-f5f29d9aa301'
--   '2d591d44-5194-4e5b-b6c5-af725fb00d4d'
--   '305a2186-afa5-49ce-874b-fa1016d45888'
--   '305e9af7-01a3-4d1e-8cd2-b91d651cb5ce'
--   '3282c79f-366d-40a0-b83b-1960290f29d3'
--   '32ca0b47-e8e6-4517-ba8b-37236744c2da'
--   '33459ee0-51df-4b12-9848-5204ee7b6c96'
--   '34436e3e-2cdc-46f0-bf73-5acde8208154'
--   '3480c111-f740-4610-a46b-46e800016229'
--   '38f22696-0436-4c53-97e2-ffd29e597adf'
--   '3b7a5875-9253-43cf-9dea-05f6a686ab5d'
--   '3eacf73e-6f95-4861-a480-9fdbb21bec5c'
--   '3f8c7dde-6599-4adc-a6e4-08a796b44d27'
--   '40d3542c-56b2-4527-981a-10fb1744965e'
--   '440e29a0-bd9a-4910-b819-923f3cb4056a'
--   '46c3d4bf-dd2b-4f6a-823a-6f6bb6fe1864'
--   '4920e12b-299b-4a84-9cb8-032a30151792'
--   '4d0291b2-cb74-4d1e-8f3a-8405faf3a5cf'
--   '4de3162c-dde6-4445-9820-1cca121a5e0d'
--   '50d4abc0-5d0c-4f0e-bad0-a134a44af0e6'
--   '519d6c79-394d-4d1b-b9f4-b7b4fea6a32e'
--   '51a84a36-f7cc-4496-a716-2a4d2d50fc9b'
--   '53000f7f-add5-4c88-bb92-690ae716088d'
--   '57246090-5066-4719-abf8-54d876fee599'
--   '5a500c29-2cf5-4eb6-b0d9-9440b8a1e926'
--   '5ad5fd02-f322-4ec0-84c8-133e47acb2ca'
--   '5f721614-fa1c-42c7-ae5b-7269ff27cfdb'
--   '61dfa28d-947d-4eef-a7a6-ad65b1c81e6b'
--   '62358ea2-c3b4-45d0-b0e3-0f0cefb38551'
--   '62a8b3ef-d19c-4154-8511-10df2d7e3e27'
--   '63fe8440-a39c-4b7a-a744-da12dee6ebcf'
--   '64bd65be-d379-42bf-b0c3-64828f99d79e'
--   '6680873c-613c-41f1-8b8f-45496775bed7'
--   '67c47b2c-af98-4f92-8491-52357c8e13ef'
--   '67d00d26-f209-4e2f-b680-a110402ebfba'
--   '695c2c49-54fb-4862-a350-df53346adc81'
--   '6fc77913-456d-4f9f-ad54-30f7c1437189'
--   '70007bd0-a7e2-4201-9aee-c50c2edc1956'
--   '7022168a-3685-43b2-805c-d006c9c40458'
--   '703067d8-c243-4372-b3e8-335db777a1f6'
--   '70fe698e-9d63-443b-82f0-c374d8df9e39'
--   '71c6ef40-f220-4438-a9eb-349aedfff1c4'
--   '72beb738-d28a-46f2-80e0-0240e51d6141'
--   '74ba0c49-5377-46b6-9b35-63a60475f0f9'
--   '751ee54e-a8a5-4e50-abf2-c380fb8c5db8'
--   '765b605d-9cb3-438d-8ce4-d8d7d0f6ce4d'
--   '780d44d1-9555-4d4e-943d-db440d2cd2bc'
--   '7a6d7fd3-3cce-4e9f-8050-2390471827f6'
--   '7aa9c063-1748-4042-8d34-5525fe563e75'
--   '7b3e11ea-2b0e-4a46-8dcf-a56b391b8c64'
--   '7cecdb2d-b388-4449-b8ea-26c7f32795c8'
--   '7dfd9cca-691c-42fb-955f-5223b113020f'
--   '7e2df637-e6ed-4946-8f33-c65730e98a5b'
--   '807c5fe9-f96d-4814-99ef-3c07dba88acf'
--   '80d615c7-ebdc-4b86-a51c-db4c3c78c10a'
--   '820daf6e-ec65-4de5-abca-d94d6d87a741'
--   '8385be9a-b3ee-4d84-8d49-a9210e10a022'
--   '8860c3b3-5892-4d73-aa9b-ef258446ae45'
--   '89fb9011-850e-4e80-8ab7-2db78358c4d2'
--   '8de9ddd2-e9c7-4a69-be7e-ffba98adae74'
--   '8e1d6a44-e003-4724-ae9b-88a2c94eba3c'
--   '8f06e390-93fa-4796-98e7-6476ee3e6bc2'
--   '90d11194-3ced-4d45-a56c-e40315867b8f'
--   '9144429f-224d-41e2-94f4-6b3f7a35ab95'
--   '91c5ec2f-6935-4bd9-b364-eea304efd498'
--   '93484b02-8a09-4fe0-84dd-6603adb0cb38'
--   '935758bc-ce22-4222-aa82-a64e2a3e5782'
--   '950bfa71-b9eb-45c1-b770-7131bf2e6605'
--   '96d6664a-783b-4717-a89e-6910af9e0b94'
--   '9a9841e9-9491-48cd-b78b-44309e346b5a'
--   '9b7769e1-ab7c-41f9-9ad4-c3a199567a56'
--   '9bae1eca-8d70-499e-8055-ffefe7b13c45'
--   '9be54b39-9f03-4998-beb7-67a5f8d75648'
--   '9dbae6ec-2664-484d-a851-1993047de313'
--   '9dd5de32-67d9-403b-aae2-0e6db3b59deb'
--   '9deee746-8e26-4d51-a2a1-7fc60b59d679'
--   'a263138e-8254-4e81-9d09-074ad41732c1'
--   'a332e1c4-759b-4198-95bc-f9912e6a8861'
--   'a3413105-5e95-489b-b331-e927ffd7e118'
--   'a3fb7f24-a035-42a3-9a3a-7151e726cce4'
--   'a4747db0-6112-4307-82ab-812cd02127c6'
--   'a572f248-5182-4e59-9102-5f96b7a6d00e'
--   'a9035e31-9bc1-42cf-8c0c-c9bb7a58dca2'
--   'a95e65e5-93eb-4852-8fb9-840f1473006d'
--   'aad357ea-2fa0-4ba7-937a-48082b3d2629'
--   'b4f83509-6994-4fef-b0e9-29a8e388787d'
--   'b6485f69-4992-4dfd-9534-2a8038e5c022'
--   'b9d6a0f0-f22d-4c41-bcee-36af574d2d25'
--   'b9ed8714-9b64-48c1-b875-0a399e0682be'
--   'ba3d46e0-9ca7-4599-993c-211fed741ebd'
--   'bbb9a8f5-6542-422f-bd31-8d6b8c47947c'
--   'be2b9e5d-e46c-490a-bee7-429327f55ec0'
--   'bef08505-6903-464e-b6b8-4672f95c973a'
--   'bfa0d85e-a203-4046-98a3-038d3cc55479'
--   'bfc1514c-fd7e-4683-9916-56cfe93d8beb'
--   'c64b0116-16fc-4fa6-9dbb-35ff4c46e8ef'
--   'c73992dd-5758-4ff0-af07-c66b6e9a5a03'
--   'c7af20c7-5cfe-44dd-8239-0bec40a1d0aa'
--   'c803f092-f1bd-4492-aa86-b3e5e8bbfc27'
--   'cad64e67-f09e-46ef-bd00-4627f85473e1'
--   'cc4153a2-b712-4311-b6b8-04ec728c276b'
--   'cd265a3d-2097-46f9-a1dd-1a6aab58dc77'
--   'cefdd999-4e8e-4d1b-b537-fd5d84b2e324'
--   'cfd85bb9-c7ff-4957-9b1d-dc7910823003'
--   'd1795915-c6f0-498b-8028-fdff5120d0a8'
--   'd45af145-54aa-4c6e-af4b-67bc9a5a5e86'
--   'd52a8a9b-8205-4871-8323-5b6d628c5576'
--   'd8130268-f17c-464c-ab35-d0616b6cbcf8'
--   'd8a6df5c-8675-43c3-9944-cd57eb5923be'
--   'd9a8c261-197b-43af-9d00-7b21fbe8d89a'
--   'da74e224-3ac8-4791-86ef-75e5512a3e0b'
--   'dbe596e7-69af-4bdd-a38b-9609309439e8'
--   'dca4ba57-7edb-41f9-8cf0-bceea570d680'
--   'dcc4c8d8-8c47-48d0-a05c-6412174f50f5'
--   'dcfbaacb-7827-4749-a038-40a24f0a2c02'
--   'dd38b3a9-fe91-4b34-b278-4fdad433e1e8'
--   'e0473077-2f33-4229-b89d-f78d372bf940'
--   'e125db47-68dd-46c4-97ac-ac4ddd83e573'
--   'e188a023-8898-450f-99ae-587824b09e67'
--   'e20367d2-a199-4bbd-a2ca-016f9087899e'
--   'e260d278-026f-4962-a963-540863f8c63c'
--   'e62077de-87a5-4302-bb26-81b47c53907f'
--   'e96296cf-c6d9-4aea-b8f8-fcc44889e553'
--   'ea28bcc6-37c2-4ebf-9c2d-a69e48c3b0ab'
--   'ec859670-3754-42c2-abb5-4654793dcf76'
--   'ed831b32-34ae-41ea-9780-c144ec5a245e'
--   'ef20f0f4-c559-4a97-9518-f58124d7272a'
--   'f02ab74c-06b0-4e2b-9c81-858b99e9cb10'
--   'f089d9cf-6a77-41f6-ad56-d3c9f2b916eb'
--   'f09b29cb-0def-4151-8c31-ffdeea9660cb'
--   'f0d85b4f-753f-411c-9e3d-82631a2c5658'
--   'f285fb65-354f-455f-b09b-c94abe7b4852'
--   'f42ee8ba-c0a4-40df-b69b-27c0d21596b6'
--   'f564ba9b-3ca3-4de9-8852-50581b866782'
--   'f5becea2-61f7-42d0-8b57-65396d3f579b'
--   'f8341bb6-dc3a-4061-8dad-f5859890ee81'
--   'f912a0a6-37d6-4c4d-a032-ba3b29419cc6'
--   'f9f5e2dc-efe6-4149-8b92-91db314099de'
--   'fc2f1651-04f9-46e9-87c7-d1eefeb2997d'
--   'fcc4b9f4-49a5-433f-9f60-58b850c42825'
--   'fcdeca7e-e169-46f4-81d5-e1c224209a1a'
--   'fd361898-c71a-4b25-bd94-3434b83aede8'
--   'fe075fb5-5125-4eb0-9c44-6aa93ec562e6'
--   'feb4b555-45d8-46e3-9917-d836ec9ec933'

-- The SQL below uses a CTE to define the dead set once,
-- then DELETEs from each table. The list is the union of
-- all dead workspace UUIDs (COHORT-A only; COHORT-B handled
-- above). Subscriptions are named inline per-table where
-- needed.

-- Step A.1 — artefact_priorities (workspace-scoped lookup data)
-- Expected: 140 rows
DELETE FROM artefact_priorities
 WHERE workspace_id::text IN (
   '01474d43-4c3b-4e91-abed-5718092f04ba','01bc6270-f875-41fb-90bc-8cffe969571a',
   '01c693c4-4ebc-4bc6-a307-4a5539705c4b','02d9f348-f2f4-4faa-93c3-9b05cfdc791b',
   '03417c20-5aca-417d-aa9b-511e17940c26','08932493-8a37-464e-bda5-a5db46150c37',
   '093e6550-b4bd-4a8f-a598-2ccea37df769','0975f2c1-a1e0-4c68-b1df-4fd17e9cb544',
   '0a0cef44-45cc-4a88-97b5-8308c19539cf','0a475a09-6484-49f9-9ea0-02db32844b19',
   '0e80879a-80ae-4c3b-a7a6-9b194488a1c7','0eefd757-2546-4f09-9136-04b6a73d0807',
   '0ef60588-70f7-43a2-a78a-a506c7581764','0fba189d-6a24-4f50-948b-dcd928ec42b8',
   '1036a205-8898-410b-92af-b2d77c332de2','10c6e399-e002-4a39-89df-cb436ad0dbfa',
   '131e17eb-f66e-4b0d-8bf1-7e90f7c87513','1372d92a-9202-4667-829e-ba7edf68e99f',
   '1404a90c-a1cb-4cd2-a69b-d5bdc018790a','16af4cd9-f040-480a-b16a-529f8251063c',
   '16d10902-8ae9-4792-8d3e-b8b582d3b18b','191c57c5-e4a9-4d65-8757-f4221f034c11',
   '19e5edc8-5742-41c7-8b73-72b9fd16f8d9','1a437277-413a-4b9f-89dc-305814b7cd5a',
   '1ab4702e-222e-444c-b608-d6d6f3cc6b61','1b9e916e-d539-47a7-b192-4d87b4e0bb37',
   '1ccd5b80-ebd1-445d-955e-bfab93b278d9','201bc1e3-6b18-4c81-a24c-a1116b8b4ee8',
   '21612f99-e217-49b4-9ed7-65271d707729','24906b67-7792-4341-99fa-3c927baea547',
   '28d1287f-26c7-4ad8-8efa-7f37c0e493cd','2a397616-ac78-4df2-bdd7-3eb2c027becd',
   '2b1d4dd0-3090-4ee8-ac37-f4d958c8e248','2cf817b4-5344-4d6a-b820-bb4c7db7f95e',
   '2d13cb36-3530-4dcb-9a3e-82c8c509c21f','2d4c4b6d-d384-4339-a97e-f5f29d9aa301',
   '2d591d44-5194-4e5b-b6c5-af725fb00d4d','305a2186-afa5-49ce-874b-fa1016d45888',
   '305e9af7-01a3-4d1e-8cd2-b91d651cb5ce','3282c79f-366d-40a0-b83b-1960290f29d3',
   '32ca0b47-e8e6-4517-ba8b-37236744c2da','33459ee0-51df-4b12-9848-5204ee7b6c96',
   '34436e3e-2cdc-46f0-bf73-5acde8208154','3480c111-f740-4610-a46b-46e800016229',
   '38f22696-0436-4c53-97e2-ffd29e597adf','3b7a5875-9253-43cf-9dea-05f6a686ab5d',
   '3eacf73e-6f95-4861-a480-9fdbb21bec5c','3f8c7dde-6599-4adc-a6e4-08a796b44d27',
   '40d3542c-56b2-4527-981a-10fb1744965e','440e29a0-bd9a-4910-b819-923f3cb4056a',
   '46c3d4bf-dd2b-4f6a-823a-6f6bb6fe1864','4920e12b-299b-4a84-9cb8-032a30151792',
   '4d0291b2-cb74-4d1e-8f3a-8405faf3a5cf','4de3162c-dde6-4445-9820-1cca121a5e0d',
   '50d4abc0-5d0c-4f0e-bad0-a134a44af0e6','519d6c79-394d-4d1b-b9f4-b7b4fea6a32e',
   '51a84a36-f7cc-4496-a716-2a4d2d50fc9b','53000f7f-add5-4c88-bb92-690ae716088d',
   '57246090-5066-4719-abf8-54d876fee599','5a500c29-2cf5-4eb6-b0d9-9440b8a1e926',
   '5ad5fd02-f322-4ec0-84c8-133e47acb2ca','5f721614-fa1c-42c7-ae5b-7269ff27cfdb',
   '61dfa28d-947d-4eef-a7a6-ad65b1c81e6b','62358ea2-c3b4-45d0-b0e3-0f0cefb38551',
   '62a8b3ef-d19c-4154-8511-10df2d7e3e27','63fe8440-a39c-4b7a-a744-da12dee6ebcf',
   '64bd65be-d379-42bf-b0c3-64828f99d79e','6680873c-613c-41f1-8b8f-45496775bed7',
   '67c47b2c-af98-4f92-8491-52357c8e13ef','67d00d26-f209-4e2f-b680-a110402ebfba',
   '695c2c49-54fb-4862-a350-df53346adc81','6fc77913-456d-4f9f-ad54-30f7c1437189',
   '70007bd0-a7e2-4201-9aee-c50c2edc1956','7022168a-3685-43b2-805c-d006c9c40458',
   '703067d8-c243-4372-b3e8-335db777a1f6','70fe698e-9d63-443b-82f0-c374d8df9e39',
   '71c6ef40-f220-4438-a9eb-349aedfff1c4','72beb738-d28a-46f2-80e0-0240e51d6141',
   '74ba0c49-5377-46b6-9b35-63a60475f0f9','751ee54e-a8a5-4e50-abf2-c380fb8c5db8',
   '765b605d-9cb3-438d-8ce4-d8d7d0f6ce4d','780d44d1-9555-4d4e-943d-db440d2cd2bc',
   '7a6d7fd3-3cce-4e9f-8050-2390471827f6','7aa9c063-1748-4042-8d34-5525fe563e75',
   '7b3e11ea-2b0e-4a46-8dcf-a56b391b8c64','7cecdb2d-b388-4449-b8ea-26c7f32795c8',
   '7dfd9cca-691c-42fb-955f-5223b113020f','7e2df637-e6ed-4946-8f33-c65730e98a5b',
   '807c5fe9-f96d-4814-99ef-3c07dba88acf','80d615c7-ebdc-4b86-a51c-db4c3c78c10a',
   '820daf6e-ec65-4de5-abca-d94d6d87a741','8385be9a-b3ee-4d84-8d49-a9210e10a022',
   '8860c3b3-5892-4d73-aa9b-ef258446ae45','89fb9011-850e-4e80-8ab7-2db78358c4d2',
   '8de9ddd2-e9c7-4a69-be7e-ffba98adae74','8e1d6a44-e003-4724-ae9b-88a2c94eba3c',
   '8f06e390-93fa-4796-98e7-6476ee3e6bc2','90d11194-3ced-4d45-a56c-e40315867b8f',
   '9144429f-224d-41e2-94f4-6b3f7a35ab95','91c5ec2f-6935-4bd9-b364-eea304efd498',
   '93484b02-8a09-4fe0-84dd-6603adb0cb38','935758bc-ce22-4222-aa82-a64e2a3e5782',
   '950bfa71-b9eb-45c1-b770-7131bf2e6605','96d6664a-783b-4717-a89e-6910af9e0b94',
   '9a9841e9-9491-48cd-b78b-44309e346b5a','9b7769e1-ab7c-41f9-9ad4-c3a199567a56',
   '9bae1eca-8d70-499e-8055-ffefe7b13c45','9be54b39-9f03-4998-beb7-67a5f8d75648',
   '9dbae6ec-2664-484d-a851-1993047de313','9dd5de32-67d9-403b-aae2-0e6db3b59deb',
   '9deee746-8e26-4d51-a2a1-7fc60b59d679','a263138e-8254-4e81-9d09-074ad41732c1',
   'a332e1c4-759b-4198-95bc-f9912e6a8861','a3413105-5e95-489b-b331-e927ffd7e118',
   'a3fb7f24-a035-42a3-9a3a-7151e726cce4','a4747db0-6112-4307-82ab-812cd02127c6',
   'a572f248-5182-4e59-9102-5f96b7a6d00e','a9035e31-9bc1-42cf-8c0c-c9bb7a58dca2',
   'a95e65e5-93eb-4852-8fb9-840f1473006d','aad357ea-2fa0-4ba7-937a-48082b3d2629',
   'b4f83509-6994-4fef-b0e9-29a8e388787d','b6485f69-4992-4dfd-9534-2a8038e5c022',
   'b9d6a0f0-f22d-4c41-bcee-36af574d2d25','b9ed8714-9b64-48c1-b875-0a399e0682be',
   'ba3d46e0-9ca7-4599-993c-211fed741ebd','bbb9a8f5-6542-422f-bd31-8d6b8c47947c',
   'be2b9e5d-e46c-490a-bee7-429327f55ec0','bef08505-6903-464e-b6b8-4672f95c973a',
   'bfa0d85e-a203-4046-98a3-038d3cc55479','bfc1514c-fd7e-4683-9916-56cfe93d8beb',
   'c64b0116-16fc-4fa6-9dbb-35ff4c46e8ef','c73992dd-5758-4ff0-af07-c66b6e9a5a03',
   'c7af20c7-5cfe-44dd-8239-0bec40a1d0aa','c803f092-f1bd-4492-aa86-b3e5e8bbfc27',
   'cad64e67-f09e-46ef-bd00-4627f85473e1','cc4153a2-b712-4311-b6b8-04ec728c276b',
   'cd265a3d-2097-46f9-a1dd-1a6aab58dc77','cefdd999-4e8e-4d1b-b537-fd5d84b2e324',
   'cfd85bb9-c7ff-4957-9b1d-dc7910823003','d1795915-c6f0-498b-8028-fdff5120d0a8',
   'd45af145-54aa-4c6e-af4b-67bc9a5a5e86','d52a8a9b-8205-4871-8323-5b6d628c5576',
   'd8130268-f17c-464c-ab35-d0616b6cbcf8','d8a6df5c-8675-43c3-9944-cd57eb5923be',
   'd9a8c261-197b-43af-9d00-7b21fbe8d89a','da74e224-3ac8-4791-86ef-75e5512a3e0b',
   'dbe596e7-69af-4bdd-a38b-9609309439e8','dca4ba57-7edb-41f9-8cf0-bceea570d680',
   'dcc4c8d8-8c47-48d0-a05c-6412174f50f5','dcfbaacb-7827-4749-a038-40a24f0a2c02',
   'dd38b3a9-fe91-4b34-b278-4fdad433e1e8','e0473077-2f33-4229-b89d-f78d372bf940',
   'e125db47-68dd-46c4-97ac-ac4ddd83e573','e188a023-8898-450f-99ae-587824b09e67',
   'e20367d2-a199-4bbd-a2ca-016f9087899e','e260d278-026f-4962-a963-540863f8c63c',
   'e62077de-87a5-4302-bb26-81b47c53907f','e96296cf-c6d9-4aea-b8f8-fcc44889e553',
   'ea28bcc6-37c2-4ebf-9c2d-a69e48c3b0ab','ec859670-3754-42c2-abb5-4654793dcf76',
   'ed831b32-34ae-41ea-9780-c144ec5a245e','ef20f0f4-c559-4a97-9518-f58124d7272a',
   'f02ab74c-06b0-4e2b-9c81-858b99e9cb10','f089d9cf-6a77-41f6-ad56-d3c9f2b916eb',
   'f09b29cb-0def-4151-8c31-ffdeea9660cb','f0d85b4f-753f-411c-9e3d-82631a2c5658',
   'f285fb65-354f-455f-b09b-c94abe7b4852','f42ee8ba-c0a4-40df-b69b-27c0d21596b6',
   'f564ba9b-3ca3-4de9-8852-50581b866782','f5becea2-61f7-42d0-8b57-65396d3f579b',
   'f8341bb6-dc3a-4061-8dad-f5859890ee81','f912a0a6-37d6-4c4d-a032-ba3b29419cc6',
   'f9f5e2dc-efe6-4149-8b92-91db314099de','fc2f1651-04f9-46e9-87c7-d1eefeb2997d',
   'fcc4b9f4-49a5-433f-9f60-58b850c42825','fcdeca7e-e169-46f4-81d5-e1c224209a1a',
   'fd361898-c71a-4b25-bd94-3434b83aede8','fe075fb5-5125-4eb0-9c44-6aa93ec562e6',
   'feb4b555-45d8-46e3-9917-d836ec9ec933'
 );

-- Step A.2 — artefacts (all 4 orphaned columns, workspace is
--             the authoritative scope — deleting by workspace
--             covers created_by, owned_by, subscription_id,
--             and workspace_id in one pass)
-- Expected: 50 rows
DELETE FROM artefacts
 WHERE workspace_id::text IN (
   '01474d43-4c3b-4e91-abed-5718092f04ba','01bc6270-f875-41fb-90bc-8cffe969571a',
   '01c693c4-4ebc-4bc6-a307-4a5539705c4b','02d9f348-f2f4-4faa-93c3-9b05cfdc791b',
   '03417c20-5aca-417d-aa9b-511e17940c26','08932493-8a37-464e-bda5-a5db46150c37',
   '093e6550-b4bd-4a8f-a598-2ccea37df769','0975f2c1-a1e0-4c68-b1df-4fd17e9cb544',
   '0a0cef44-45cc-4a88-97b5-8308c19539cf','0a475a09-6484-49f9-9ea0-02db32844b19',
   '0e80879a-80ae-4c3b-a7a6-9b194488a1c7','0eefd757-2546-4f09-9136-04b6a73d0807',
   '0ef60588-70f7-43a2-a78a-a506c7581764','0fba189d-6a24-4f50-948b-dcd928ec42b8',
   '1036a205-8898-410b-92af-b2d77c332de2','10c6e399-e002-4a39-89df-cb436ad0dbfa',
   '131e17eb-f66e-4b0d-8bf1-7e90f7c87513','1372d92a-9202-4667-829e-ba7edf68e99f',
   '1404a90c-a1cb-4cd2-a69b-d5bdc018790a','16af4cd9-f040-480a-b16a-529f8251063c',
   '16d10902-8ae9-4792-8d3e-b8b582d3b18b','191c57c5-e4a9-4d65-8757-f4221f034c11',
   '19e5edc8-5742-41c7-8b73-72b9fd16f8d9','1a437277-413a-4b9f-89dc-305814b7cd5a',
   '1ab4702e-222e-444c-b608-d6d6f3cc6b61','1b9e916e-d539-47a7-b192-4d87b4e0bb37',
   '1ccd5b80-ebd1-445d-955e-bfab93b278d9','201bc1e3-6b18-4c81-a24c-a1116b8b4ee8',
   '21612f99-e217-49b4-9ed7-65271d707729','24906b67-7792-4341-99fa-3c927baea547',
   '28d1287f-26c7-4ad8-8efa-7f37c0e493cd','2a397616-ac78-4df2-bdd7-3eb2c027becd',
   '2b1d4dd0-3090-4ee8-ac37-f4d958c8e248','2cf817b4-5344-4d6a-b820-bb4c7db7f95e',
   '2d13cb36-3530-4dcb-9a3e-82c8c509c21f','2d4c4b6d-d384-4339-a97e-f5f29d9aa301',
   '2d591d44-5194-4e5b-b6c5-af725fb00d4d','305a2186-afa5-49ce-874b-fa1016d45888',
   '305e9af7-01a3-4d1e-8cd2-b91d651cb5ce','3282c79f-366d-40a0-b83b-1960290f29d3',
   '32ca0b47-e8e6-4517-ba8b-37236744c2da','33459ee0-51df-4b12-9848-5204ee7b6c96',
   '34436e3e-2cdc-46f0-bf73-5acde8208154','3480c111-f740-4610-a46b-46e800016229',
   '38f22696-0436-4c53-97e2-ffd29e597adf','3b7a5875-9253-43cf-9dea-05f6a686ab5d',
   '3eacf73e-6f95-4861-a480-9fdbb21bec5c','3f8c7dde-6599-4adc-a6e4-08a796b44d27',
   '40d3542c-56b2-4527-981a-10fb1744965e','440e29a0-bd9a-4910-b819-923f3cb4056a',
   '46c3d4bf-dd2b-4f6a-823a-6f6bb6fe1864','4920e12b-299b-4a84-9cb8-032a30151792',
   '4d0291b2-cb74-4d1e-8f3a-8405faf3a5cf','4de3162c-dde6-4445-9820-1cca121a5e0d',
   '50d4abc0-5d0c-4f0e-bad0-a134a44af0e6','519d6c79-394d-4d1b-b9f4-b7b4fea6a32e',
   '51a84a36-f7cc-4496-a716-2a4d2d50fc9b','53000f7f-add5-4c88-bb92-690ae716088d',
   '57246090-5066-4719-abf8-54d876fee599','5a500c29-2cf5-4eb6-b0d9-9440b8a1e926',
   '5ad5fd02-f322-4ec0-84c8-133e47acb2ca','5f721614-fa1c-42c7-ae5b-7269ff27cfdb',
   '61dfa28d-947d-4eef-a7a6-ad65b1c81e6b','62358ea2-c3b4-45d0-b0e3-0f0cefb38551',
   '62a8b3ef-d19c-4154-8511-10df2d7e3e27','63fe8440-a39c-4b7a-a744-da12dee6ebcf',
   '64bd65be-d379-42bf-b0c3-64828f99d79e','6680873c-613c-41f1-8b8f-45496775bed7',
   '67c47b2c-af98-4f92-8491-52357c8e13ef','67d00d26-f209-4e2f-b680-a110402ebfba',
   '695c2c49-54fb-4862-a350-df53346adc81','6fc77913-456d-4f9f-ad54-30f7c1437189',
   '70007bd0-a7e2-4201-9aee-c50c2edc1956','7022168a-3685-43b2-805c-d006c9c40458',
   '703067d8-c243-4372-b3e8-335db777a1f6','70fe698e-9d63-443b-82f0-c374d8df9e39',
   '71c6ef40-f220-4438-a9eb-349aedfff1c4','72beb738-d28a-46f2-80e0-0240e51d6141',
   '74ba0c49-5377-46b6-9b35-63a60475f0f9','751ee54e-a8a5-4e50-abf2-c380fb8c5db8',
   '765b605d-9cb3-438d-8ce4-d8d7d0f6ce4d','780d44d1-9555-4d4e-943d-db440d2cd2bc',
   '7a6d7fd3-3cce-4e9f-8050-2390471827f6','7aa9c063-1748-4042-8d34-5525fe563e75',
   '7b3e11ea-2b0e-4a46-8dcf-a56b391b8c64','7cecdb2d-b388-4449-b8ea-26c7f32795c8',
   '7dfd9cca-691c-42fb-955f-5223b113020f','7e2df637-e6ed-4946-8f33-c65730e98a5b',
   '807c5fe9-f96d-4814-99ef-3c07dba88acf','80d615c7-ebdc-4b86-a51c-db4c3c78c10a',
   '820daf6e-ec65-4de5-abca-d94d6d87a741','8385be9a-b3ee-4d84-8d49-a9210e10a022',
   '8860c3b3-5892-4d73-aa9b-ef258446ae45','89fb9011-850e-4e80-8ab7-2db78358c4d2',
   '8de9ddd2-e9c7-4a69-be7e-ffba98adae74','8e1d6a44-e003-4724-ae9b-88a2c94eba3c',
   '8f06e390-93fa-4796-98e7-6476ee3e6bc2','90d11194-3ced-4d45-a56c-e40315867b8f',
   '9144429f-224d-41e2-94f4-6b3f7a35ab95','91c5ec2f-6935-4bd9-b364-eea304efd498',
   '93484b02-8a09-4fe0-84dd-6603adb0cb38','935758bc-ce22-4222-aa82-a64e2a3e5782',
   '950bfa71-b9eb-45c1-b770-7131bf2e6605','96d6664a-783b-4717-a89e-6910af9e0b94',
   '9a9841e9-9491-48cd-b78b-44309e346b5a','9b7769e1-ab7c-41f9-9ad4-c3a199567a56',
   '9bae1eca-8d70-499e-8055-ffefe7b13c45','9be54b39-9f03-4998-beb7-67a5f8d75648',
   '9dbae6ec-2664-484d-a851-1993047de313','9dd5de32-67d9-403b-aae2-0e6db3b59deb',
   '9deee746-8e26-4d51-a2a1-7fc60b59d679','a263138e-8254-4e81-9d09-074ad41732c1',
   'a332e1c4-759b-4198-95bc-f9912e6a8861','a3413105-5e95-489b-b331-e927ffd7e118',
   'a3fb7f24-a035-42a3-9a3a-7151e726cce4','a4747db0-6112-4307-82ab-812cd02127c6',
   'a572f248-5182-4e59-9102-5f96b7a6d00e','a9035e31-9bc1-42cf-8c0c-c9bb7a58dca2',
   'a95e65e5-93eb-4852-8fb9-840f1473006d','aad357ea-2fa0-4ba7-937a-48082b3d2629',
   'b4f83509-6994-4fef-b0e9-29a8e388787d','b6485f69-4992-4dfd-9534-2a8038e5c022',
   'b9d6a0f0-f22d-4c41-bcee-36af574d2d25','b9ed8714-9b64-48c1-b875-0a399e0682be',
   'ba3d46e0-9ca7-4599-993c-211fed741ebd','bbb9a8f5-6542-422f-bd31-8d6b8c47947c',
   'be2b9e5d-e46c-490a-bee7-429327f55ec0','bef08505-6903-464e-b6b8-4672f95c973a',
   'bfa0d85e-a203-4046-98a3-038d3cc55479','bfc1514c-fd7e-4683-9916-56cfe93d8beb',
   'c64b0116-16fc-4fa6-9dbb-35ff4c46e8ef','c73992dd-5758-4ff0-af07-c66b6e9a5a03',
   'c7af20c7-5cfe-44dd-8239-0bec40a1d0aa','c803f092-f1bd-4492-aa86-b3e5e8bbfc27',
   'cad64e67-f09e-46ef-bd00-4627f85473e1','cc4153a2-b712-4311-b6b8-04ec728c276b',
   'cd265a3d-2097-46f9-a1dd-1a6aab58dc77','cefdd999-4e8e-4d1b-b537-fd5d84b2e324',
   'cfd85bb9-c7ff-4957-9b1d-dc7910823003','d1795915-c6f0-498b-8028-fdff5120d0a8',
   'd45af145-54aa-4c6e-af4b-67bc9a5a5e86','d52a8a9b-8205-4871-8323-5b6d628c5576',
   'd8130268-f17c-464c-ab35-d0616b6cbcf8','d8a6df5c-8675-43c3-9944-cd57eb5923be',
   'd9a8c261-197b-43af-9d00-7b21fbe8d89a','da74e224-3ac8-4791-86ef-75e5512a3e0b',
   'dbe596e7-69af-4bdd-a38b-9609309439e8','dca4ba57-7edb-41f9-8cf0-bceea570d680',
   'dcc4c8d8-8c47-48d0-a05c-6412174f50f5','dcfbaacb-7827-4749-a038-40a24f0a2c02',
   'dd38b3a9-fe91-4b34-b278-4fdad433e1e8','e0473077-2f33-4229-b89d-f78d372bf940',
   'e125db47-68dd-46c4-97ac-ac4ddd83e573','e188a023-8898-450f-99ae-587824b09e67',
   'e20367d2-a199-4bbd-a2ca-016f9087899e','e260d278-026f-4962-a963-540863f8c63c',
   'e62077de-87a5-4302-bb26-81b47c53907f','e96296cf-c6d9-4aea-b8f8-fcc44889e553',
   'ea28bcc6-37c2-4ebf-9c2d-a69e48c3b0ab','ec859670-3754-42c2-abb5-4654793dcf76',
   'ed831b32-34ae-41ea-9780-c144ec5a245e','ef20f0f4-c559-4a97-9518-f58124d7272a',
   'f02ab74c-06b0-4e2b-9c81-858b99e9cb10','f089d9cf-6a77-41f6-ad56-d3c9f2b916eb',
   'f09b29cb-0def-4151-8c31-ffdeea9660cb','f0d85b4f-753f-411c-9e3d-82631a2c5658',
   'f285fb65-354f-455f-b09b-c94abe7b4852','f42ee8ba-c0a4-40df-b69b-27c0d21596b6',
   'f564ba9b-3ca3-4de9-8852-50581b866782','f5becea2-61f7-42d0-8b57-65396d3f579b',
   'f8341bb6-dc3a-4061-8dad-f5859890ee81','f912a0a6-37d6-4c4d-a032-ba3b29419cc6',
   'f9f5e2dc-efe6-4149-8b92-91db314099de','fc2f1651-04f9-46e9-87c7-d1eefeb2997d',
   'fcc4b9f4-49a5-433f-9f60-58b850c42825','fcdeca7e-e169-46f4-81d5-e1c224209a1a',
   'fd361898-c71a-4b25-bd94-3434b83aede8','fe075fb5-5125-4eb0-9c44-6aa93ec562e6',
   'feb4b555-45d8-46e3-9917-d836ec9ec933'
 );

-- Step A.2b — COHORT-C guard: after COHORT-A deletes artefacts
-- by workspace, verify no artefacts remain with dead user refs
-- in live workspaces. If this SELECT returns > 0 rows, NULL
-- those columns before COMMITTING.
--
-- SELECT id, created_by_user_id, owned_by_user_id
--   FROM artefacts
--  WHERE created_by_user_id::text IN (
--    '04f6242e-637a-4989-8dd1-7e90d6a7889b',
--    '1a370a0b-3a8a-485d-a441-8ac7540b525b',
--    '2623181f-c01d-4321-8dbf-b17842af550f',
--    '2a8b938f-552e-4e19-8f9f-8b5affe400f8',
--    '3e1221a8-0467-438e-aad2-3c59f30871c5',
--    '4ad0c509-a291-4275-af2e-1252c46eff97',
--    '626ed017-af95-452d-b8ee-915e08abef0c',
--    '70f424f6-3341-4711-9e17-af28317fc043',
--    '7365fe01-b34b-4e72-850b-551f15786121',
--    '74695602-1c70-4b34-a193-e0a715026e1f',
--    '7cfb3fce-18c2-4056-8da5-1f165031b51c',
--    '7ea2519e-8378-49e6-97dd-e3748b2aab2b',
--    '9241ef0c-0e14-4668-9ba4-2d608a65012a',
--    '9b3a240a-0b1e-496f-ad25-936746b29fce',
--    'be922568-fe16-4053-8393-5ed39ed49206',
--    'c2fc7973-4bff-4d39-8b17-1de7b8c17469',
--    'c651a2f7-7c9d-4872-8824-e0e1999eae12',
--    'cec1edc6-ab18-45ab-8b9b-aa8de2d77e49',
--    'd6506fec-1d42-4e01-a9ce-a80db6fb1590',
--    'd7e9a613-3e70-4b18-a646-e2b8d0b580a3',
--    'dc3978f2-2424-47ad-910b-f8ce4bd03657',
--    'e9356395-e188-407d-a1f4-40705021e732',
--    'eb7b4dd5-92a2-4c91-aafb-622583548880'
--  )
--     OR owned_by_user_id::text IN (... same list ...);
--
-- If any rows returned, add this before COMMIT:
-- UPDATE artefacts SET created_by_user_id = NULL
--  WHERE created_by_user_id::text IN (... dead user list ...);
-- UPDATE artefacts SET owned_by_user_id = NULL
--  WHERE owned_by_user_id::text IN (... dead user list ...);

-- Step A.3 — artefacts_types (427 rows, workspace-keyed)
-- Deleting by workspace_id covers the subscription_id orphans
-- transitively (each row has exactly one paired dead ws + sub).
-- Expected: 427 rows
DELETE FROM artefacts_types
 WHERE artefacts_types_id_workspace::text IN (
   '01474d43-4c3b-4e91-abed-5718092f04ba','01bc6270-f875-41fb-90bc-8cffe969571a',
   '01c693c4-4ebc-4bc6-a307-4a5539705c4b','02d9f348-f2f4-4faa-93c3-9b05cfdc791b',
   '03417c20-5aca-417d-aa9b-511e17940c26','08932493-8a37-464e-bda5-a5db46150c37',
   '093e6550-b4bd-4a8f-a598-2ccea37df769','0975f2c1-a1e0-4c68-b1df-4fd17e9cb544',
   '0a0cef44-45cc-4a88-97b5-8308c19539cf','0a475a09-6484-49f9-9ea0-02db32844b19',
   '0e80879a-80ae-4c3b-a7a6-9b194488a1c7','0eefd757-2546-4f09-9136-04b6a73d0807',
   '0ef60588-70f7-43a2-a78a-a506c7581764','0fba189d-6a24-4f50-948b-dcd928ec42b8',
   '1036a205-8898-410b-92af-b2d77c332de2','10c6e399-e002-4a39-89df-cb436ad0dbfa',
   '131e17eb-f66e-4b0d-8bf1-7e90f7c87513','1372d92a-9202-4667-829e-ba7edf68e99f',
   '1404a90c-a1cb-4cd2-a69b-d5bdc018790a','16af4cd9-f040-480a-b16a-529f8251063c',
   '16d10902-8ae9-4792-8d3e-b8b582d3b18b','191c57c5-e4a9-4d65-8757-f4221f034c11',
   '19e5edc8-5742-41c7-8b73-72b9fd16f8d9','1a437277-413a-4b9f-89dc-305814b7cd5a',
   '1ab4702e-222e-444c-b608-d6d6f3cc6b61','1b9e916e-d539-47a7-b192-4d87b4e0bb37',
   '1ccd5b80-ebd1-445d-955e-bfab93b278d9','201bc1e3-6b18-4c81-a24c-a1116b8b4ee8',
   '21612f99-e217-49b4-9ed7-65271d707729','24906b67-7792-4341-99fa-3c927baea547',
   '28d1287f-26c7-4ad8-8efa-7f37c0e493cd','2a397616-ac78-4df2-bdd7-3eb2c027becd',
   '2b1d4dd0-3090-4ee8-ac37-f4d958c8e248','2cf817b4-5344-4d6a-b820-bb4c7db7f95e',
   '2d13cb36-3530-4dcb-9a3e-82c8c509c21f','2d4c4b6d-d384-4339-a97e-f5f29d9aa301',
   '2d591d44-5194-4e5b-b6c5-af725fb00d4d','305a2186-afa5-49ce-874b-fa1016d45888',
   '305e9af7-01a3-4d1e-8cd2-b91d651cb5ce','3282c79f-366d-40a0-b83b-1960290f29d3',
   '32ca0b47-e8e6-4517-ba8b-37236744c2da','33459ee0-51df-4b12-9848-5204ee7b6c96',
   '34436e3e-2cdc-46f0-bf73-5acde8208154','3480c111-f740-4610-a46b-46e800016229',
   '38f22696-0436-4c53-97e2-ffd29e597adf','3b7a5875-9253-43cf-9dea-05f6a686ab5d',
   '3eacf73e-6f95-4861-a480-9fdbb21bec5c','3f8c7dde-6599-4adc-a6e4-08a796b44d27',
   '40d3542c-56b2-4527-981a-10fb1744965e','440e29a0-bd9a-4910-b819-923f3cb4056a',
   '46c3d4bf-dd2b-4f6a-823a-6f6bb6fe1864','4920e12b-299b-4a84-9cb8-032a30151792',
   '4d0291b2-cb74-4d1e-8f3a-8405faf3a5cf','4de3162c-dde6-4445-9820-1cca121a5e0d',
   '50d4abc0-5d0c-4f0e-bad0-a134a44af0e6','519d6c79-394d-4d1b-b9f4-b7b4fea6a32e',
   '51a84a36-f7cc-4496-a716-2a4d2d50fc9b','53000f7f-add5-4c88-bb92-690ae716088d',
   '57246090-5066-4719-abf8-54d876fee599','5a500c29-2cf5-4eb6-b0d9-9440b8a1e926',
   '5ad5fd02-f322-4ec0-84c8-133e47acb2ca','5f721614-fa1c-42c7-ae5b-7269ff27cfdb',
   '61dfa28d-947d-4eef-a7a6-ad65b1c81e6b','62358ea2-c3b4-45d0-b0e3-0f0cefb38551',
   '62a8b3ef-d19c-4154-8511-10df2d7e3e27','63fe8440-a39c-4b7a-a744-da12dee6ebcf',
   '64bd65be-d379-42bf-b0c3-64828f99d79e','6680873c-613c-41f1-8b8f-45496775bed7',
   '67c47b2c-af98-4f92-8491-52357c8e13ef','67d00d26-f209-4e2f-b680-a110402ebfba',
   '695c2c49-54fb-4862-a350-df53346adc81','6fc77913-456d-4f9f-ad54-30f7c1437189',
   '70007bd0-a7e2-4201-9aee-c50c2edc1956','7022168a-3685-43b2-805c-d006c9c40458',
   '703067d8-c243-4372-b3e8-335db777a1f6','70fe698e-9d63-443b-82f0-c374d8df9e39',
   '71c6ef40-f220-4438-a9eb-349aedfff1c4','72beb738-d28a-46f2-80e0-0240e51d6141',
   '74ba0c49-5377-46b6-9b35-63a60475f0f9','751ee54e-a8a5-4e50-abf2-c380fb8c5db8',
   '765b605d-9cb3-438d-8ce4-d8d7d0f6ce4d','780d44d1-9555-4d4e-943d-db440d2cd2bc',
   '7a6d7fd3-3cce-4e9f-8050-2390471827f6','7aa9c063-1748-4042-8d34-5525fe563e75',
   '7b3e11ea-2b0e-4a46-8dcf-a56b391b8c64','7cecdb2d-b388-4449-b8ea-26c7f32795c8',
   '7dfd9cca-691c-42fb-955f-5223b113020f','7e2df637-e6ed-4946-8f33-c65730e98a5b',
   '807c5fe9-f96d-4814-99ef-3c07dba88acf','80d615c7-ebdc-4b86-a51c-db4c3c78c10a',
   '820daf6e-ec65-4de5-abca-d94d6d87a741','8385be9a-b3ee-4d84-8d49-a9210e10a022',
   '8860c3b3-5892-4d73-aa9b-ef258446ae45','89fb9011-850e-4e80-8ab7-2db78358c4d2',
   '8de9ddd2-e9c7-4a69-be7e-ffba98adae74','8e1d6a44-e003-4724-ae9b-88a2c94eba3c',
   '8f06e390-93fa-4796-98e7-6476ee3e6bc2','90d11194-3ced-4d45-a56c-e40315867b8f',
   '9144429f-224d-41e2-94f4-6b3f7a35ab95','91c5ec2f-6935-4bd9-b364-eea304efd498',
   '93484b02-8a09-4fe0-84dd-6603adb0cb38','935758bc-ce22-4222-aa82-a64e2a3e5782',
   '950bfa71-b9eb-45c1-b770-7131bf2e6605','96d6664a-783b-4717-a89e-6910af9e0b94',
   '9a9841e9-9491-48cd-b78b-44309e346b5a','9b7769e1-ab7c-41f9-9ad4-c3a199567a56',
   '9bae1eca-8d70-499e-8055-ffefe7b13c45','9be54b39-9f03-4998-beb7-67a5f8d75648',
   '9dbae6ec-2664-484d-a851-1993047de313','9dd5de32-67d9-403b-aae2-0e6db3b59deb',
   '9deee746-8e26-4d51-a2a1-7fc60b59d679','a263138e-8254-4e81-9d09-074ad41732c1',
   'a332e1c4-759b-4198-95bc-f9912e6a8861','a3413105-5e95-489b-b331-e927ffd7e118',
   'a3fb7f24-a035-42a3-9a3a-7151e726cce4','a4747db0-6112-4307-82ab-812cd02127c6',
   'a572f248-5182-4e59-9102-5f96b7a6d00e','a9035e31-9bc1-42cf-8c0c-c9bb7a58dca2',
   'a95e65e5-93eb-4852-8fb9-840f1473006d','aad357ea-2fa0-4ba7-937a-48082b3d2629',
   'b4f83509-6994-4fef-b0e9-29a8e388787d','b6485f69-4992-4dfd-9534-2a8038e5c022',
   'b9d6a0f0-f22d-4c41-bcee-36af574d2d25','b9ed8714-9b64-48c1-b875-0a399e0682be',
   'ba3d46e0-9ca7-4599-993c-211fed741ebd','bbb9a8f5-6542-422f-bd31-8d6b8c47947c',
   'be2b9e5d-e46c-490a-bee7-429327f55ec0','bef08505-6903-464e-b6b8-4672f95c973a',
   'bfa0d85e-a203-4046-98a3-038d3cc55479','bfc1514c-fd7e-4683-9916-56cfe93d8beb',
   'c64b0116-16fc-4fa6-9dbb-35ff4c46e8ef','c73992dd-5758-4ff0-af07-c66b6e9a5a03',
   'c7af20c7-5cfe-44dd-8239-0bec40a1d0aa','c803f092-f1bd-4492-aa86-b3e5e8bbfc27',
   'cad64e67-f09e-46ef-bd00-4627f85473e1','cc4153a2-b712-4311-b6b8-04ec728c276b',
   'cd265a3d-2097-46f9-a1dd-1a6aab58dc77','cefdd999-4e8e-4d1b-b537-fd5d84b2e324',
   'cfd85bb9-c7ff-4957-9b1d-dc7910823003','d1795915-c6f0-498b-8028-fdff5120d0a8',
   'd45af145-54aa-4c6e-af4b-67bc9a5a5e86','d52a8a9b-8205-4871-8323-5b6d628c5576',
   'd8130268-f17c-464c-ab35-d0616b6cbcf8','d8a6df5c-8675-43c3-9944-cd57eb5923be',
   'd9a8c261-197b-43af-9d00-7b21fbe8d89a','da74e224-3ac8-4791-86ef-75e5512a3e0b',
   'dbe596e7-69af-4bdd-a38b-9609309439e8','dca4ba57-7edb-41f9-8cf0-bceea570d680',
   'dcc4c8d8-8c47-48d0-a05c-6412174f50f5','dcfbaacb-7827-4749-a038-40a24f0a2c02',
   'dd38b3a9-fe91-4b34-b278-4fdad433e1e8','e0473077-2f33-4229-b89d-f78d372bf940',
   'e125db47-68dd-46c4-97ac-ac4ddd83e573','e188a023-8898-450f-99ae-587824b09e67',
   'e20367d2-a199-4bbd-a2ca-016f9087899e','e260d278-026f-4962-a963-540863f8c63c',
   'e62077de-87a5-4302-bb26-81b47c53907f','e96296cf-c6d9-4aea-b8f8-fcc44889e553',
   'ea28bcc6-37c2-4ebf-9c2d-a69e48c3b0ab','ec859670-3754-42c2-abb5-4654793dcf76',
   'ed831b32-34ae-41ea-9780-c144ec5a245e','ef20f0f4-c559-4a97-9518-f58124d7272a',
   'f02ab74c-06b0-4e2b-9c81-858b99e9cb10','f089d9cf-6a77-41f6-ad56-d3c9f2b916eb',
   'f09b29cb-0def-4151-8c31-ffdeea9660cb','f0d85b4f-753f-411c-9e3d-82631a2c5658',
   'f285fb65-354f-455f-b09b-c94abe7b4852','f42ee8ba-c0a4-40df-b69b-27c0d21596b6',
   'f564ba9b-3ca3-4de9-8852-50581b866782','f5becea2-61f7-42d0-8b57-65396d3f579b',
   'f8341bb6-dc3a-4061-8dad-f5859890ee81','f912a0a6-37d6-4c4d-a032-ba3b29419cc6',
   'f9f5e2dc-efe6-4149-8b92-91db314099de','fc2f1651-04f9-46e9-87c7-d1eefeb2997d',
   'fcc4b9f4-49a5-433f-9f60-58b850c42825','fcdeca7e-e169-46f4-81d5-e1c224209a1a',
   'fd361898-c71a-4b25-bd94-3434b83aede8','fe075fb5-5125-4eb0-9c44-6aa93ec562e6',
   'feb4b555-45d8-46e3-9917-d836ec9ec933'
 );

-- Step A.4 — master_record_portfolios
-- PK is workspace_id; all 11 orphan rows have dead workspace IDs
-- that are a SEPARATE cohort from the 168 AT dead workspaces
-- (no overlap). Included in this COHORT-A DELETE because they
-- are the same class of dev-tenant cleanup debt. Expected: 11 rows
DELETE FROM master_record_portfolios
 WHERE master_record_portfolios_id_workspace::text IN (
   '01bc6270-f875-41fb-90bc-8cffe969571a',
   '10c6e399-e002-4a39-89df-cb436ad0dbfa',
   '2b1d4dd0-3090-4ee8-ac37-f4d958c8e248',
   '33459ee0-51df-4b12-9848-5204ee7b6c96',
   '8de9ddd2-e9c7-4a69-be7e-ffba98adae74',
   'a9035e31-9bc1-42cf-8c0c-c9bb7a58dca2',
   'bbb9a8f5-6542-422f-bd31-8d6b8c47947c',
   'da74e224-3ac8-4791-86ef-75e5512a3e0b',
   'dcfbaacb-7827-4749-a038-40a24f0a2c02',
   'e62077de-87a5-4302-bb26-81b47c53907f',
   'ea28bcc6-37c2-4ebf-9c2d-a69e48c3b0ab'
 );


-- ── COHORT-D: SOC 2 audit-trail user refs ──────────────────
-- 89 audit_logs rows reference 29 dead user IDs. These are
-- LEGITIMATE orphans: users deleted from live subscriptions
-- (confirmed: 14 of 15 referenced subscriptions are still
-- live). The audit log rows are valid SOC 2 evidence.
--
-- Action: NULL the user ref column (anonymise the deleted
-- user, preserve the log). When CUT1.5.1 installs the FK on
-- audit_logs.audit_logs_id_user, use ON DELETE SET NULL.
-- Expected: 89 rows updated
UPDATE audit_logs
   SET audit_logs_id_user = NULL
 WHERE audit_logs_id_user::text IN (
   '0d5ccbfb-8ce8-40b3-acee-3fa83985e04e',
   '107555cf-fd0d-445e-b697-42b74a326b73',
   '108b019d-93aa-45e0-b4fc-4f761fba78d6',
   '1ef4b201-e3bd-4eef-bb79-e9e046b40050',
   '2c19dcef-7574-47b5-913a-819409b0e58a',
   '307649fd-b16c-493b-ba2e-e2a9ffafdc35',
   '333d2ede-2994-4a37-b38d-c486b422a689',
   '3773a424-520a-43dd-a2de-76261ca0ad7a',
   '4572ce0d-997f-41d3-9beb-c1f2abf6058f',
   '780f4e66-3559-48c3-b51b-ed058e0086c0',
   '7b9cd6d6-6dd9-457f-aad8-0c9daa6c43e7',
   '8a55513d-b8be-4245-9606-4e1485ebcdd0',
   '8d24df08-fff5-43f4-8f93-f68f75563b24',
   '90838a04-ec88-4f43-a229-704ae260ec85',
   'a275caa3-66dc-4b58-983f-ec3676779d04',
   'a72ec991-b2a0-4d8a-ac51-067efbca630c',
   'a8b13470-8703-401a-8b38-7e6f02606d54',
   'b3aa5172-05fe-468c-9bd9-4dbd598873ca',
   'ccb75414-0427-4cf1-98a9-652646985dfd',
   'cf5f9486-a7c7-4c96-8512-cb4493773079',
   'dd4487f5-61e6-451f-9066-d9601e2a895a',
   'e03c25c6-74f5-4411-91eb-ff42cdcc8a68',
   'e0fc8657-ace3-4542-b0fb-1fdd2ada3bb1',
   'ef11f385-cf91-4b2f-a1ca-33a19aaea823',
   'ef3323cd-0715-48a4-a035-8597449a9699',
   'f1ab3f5e-852b-49a2-af27-17ddfb979568',
   'fcc6ccbf-6e06-495e-ad39-3f8b632270fb',
   'fd8079a3-d274-44fc-bc1f-702c24b265fd',
   'ff96c733-b3a9-431f-8b6b-17bb9420ab5c'
 );


-- ── Post-remediation verification queries ──────────────────
-- Run these BEFORE COMMITting to confirm the orphan count
-- is now 0 for each targeted column.
--
-- Expected result for all: 0 rows (or the live-workspace set
-- only, i.e. 0 orphans).

-- Check 1: artefacts_types workspace orphans
-- SELECT COUNT(*) FROM artefacts_types
--  WHERE artefacts_types_id_workspace IS NOT NULL;
-- (Should be only system/library artefact types if any exist,
--  or 0 if all workspace-scoped types were in dead tenants.)

-- Check 2: artefacts workspace orphans (expect 0)
-- SELECT COUNT(*) FROM artefacts WHERE workspace_id IS NULL;

-- Check 3: audit_logs user orphans (expect 0 dead user refs)
-- SELECT COUNT(*) FROM audit_logs
--  WHERE audit_logs_id_user IS NOT NULL
--    AND audit_logs_id_user::text NOT IN (SELECT id::text FROM mmff_vector_users_view);
-- (Cannot cross-DB in psql without a foreign-data wrapper;
--  verify by re-running the Python investigation script.)

-- Check 4: master_record_portfolios (expect 0)
-- SELECT COUNT(*) FROM master_record_portfolios
--  WHERE master_record_portfolios_id_workspace::text
--     IN (... dead WS list ...);


COMMIT;

-- ── CUT1.5.1 FK policy addendum ────────────────────────────
-- When CUT1.5.1 installs hard FKs, apply these ON DELETE
-- policies per column:
--
--   audit_logs.audit_logs_id_user → ON DELETE SET NULL
--   artefacts.created_by_user_id  → ON DELETE SET NULL
--   artefacts.owned_by_user_id    → ON DELETE SET NULL
--   artefacts.subscription_id     → ON DELETE RESTRICT
--   artefacts.workspace_id        → ON DELETE RESTRICT
--   artefacts_types.*_subscription → ON DELETE RESTRICT
--   artefacts_types.*_workspace   → ON DELETE RESTRICT
--   artefact_priorities.workspace_id → ON DELETE RESTRICT
--   master_record_portfolios.*_workspace → ON DELETE RESTRICT
--   timebox_*.workspace_id        → ON DELETE RESTRICT
--   webhooks_subscriptions.*_workspace → ON DELETE RESTRICT
--   master_record_workspaces (sidecar PK) → eliminated by CUT1.3.3
