# Statement of Work: Enterprise Agile SaaS Platform

End‑to‑end portfolio & execution management · Scrum & Kanban  
**21 April 2026 · v2.0**

---

**Purpose:** A complete, scalable Agile platform for organisations of any size—from small business teams to global enterprises. This document outlines the scope, behaviour, hierarchy, and operational principles of the system.

## 1. Technical Environment (Plain‑language summary)

The platform runs on a modern, proven stack: **PostgreSQL** for data, **Node.js** for backend services, and **React** for the user interface. The database lives inside a Docker container for consistency, and the whole system is managed through a Plesk control panel on Ubuntu. For security, developers connect to staging and production databases exclusively through encrypted SSH tunnels—no database port is ever exposed to the open internet.

## 1.1 Deployment Modes

The platform is offered in two modes, and the data model is portable between them:

- **Hosted (cloud):** Operated by us. Customers are tenants on shared infrastructure; we run upgrades, backups, and monitoring. This is the default route for most customers.
- **On‑premise:** Operated by the customer inside their own environment. The same container images and schema run there, but the customer controls the hosts, network boundary, and upgrade cadence.

On‑premise deployments introduce an **update‑distribution** concern that hosted does not: how does a release reach the customer, get verified, and apply its database migrations safely? A dedicated update channel is planned — signed release artefacts, an opt‑in customer‑side updater, explicit version pinning, and deterministic migration ordering from `db/schema/*.sql`. This is called out as a known follow‑up so it is not forgotten during capacity planning; it does not change the schema design.

## 2. Core Work Hierarchy: Execution vs. Portfolio

The system splits work into two connected but distinct spaces.

### Execution Space (The Coal‑face)

Used daily by developers, QA, designers, scrum masters, and product owners. It's where work actually gets done. Artefacts here follow two patterns based on the chosen agile method.

- **Scrum:** Tasks → User Stories → Epic Stories → Features
- **Kanban:** User Stories → Epic Stories → Features (Tasks are not used in Kanban projects)

### Portfolio Stack (Planning & Roll‑up)

Sits above the Execution Space and rolls up progress for planning, roadmaps, and strategic oversight. Features sit at the overlap: they belong to both worlds. The default portfolio layers, from bottom to top, are: **Feature → Theme → Business Objective → Product**.

**Inheritance rule:** Progress flows strictly upwards. A Feature can contain many Epic Stories, an Epic can contain many User Stories, and a User Story can contain many Tasks. When all children are finished, the parent automatically becomes finished as well. This cascade continues all the way up the portfolio chain.

## 3. Workflow States (Progression)

Every work item has a defined lifecycle. Administrators can customise these flows and even add new portfolio layers, and the system will automatically generate the necessary state tracking.

| Artefact type | Default flow |
|---|---|
| Task | Defined → Ready → In Progress → Completed |
| User Story | Defined → Ready → In Progress → Completed → Accepted |
| Epic Story | Defined → Ready → In Progress → Completed → Accepted |
| Feature | Defined → Ready → In Progress → Completed → Accepted |
| Portfolio items (Theme, Objective, Product, and custom layers) | Defined → Ready → In Progress → Completed → Accepted |
| Defect | Same as User Story (mirrors its flow unless customised separately). A defect is only marked Accepted after QA verification. |
| Risk | Identified → Analysed → Assigned → Responded → Monitored → Closed |

Each project can also define short codes (for example, **TA** for Task, **US** for User Story, **FE** for Feature, **PR** for Product). These can be changed per project and are used to generate unique identifiers like `US‑MOBILE‑421`.

## 4. Transition Column Customisation

Kanban boards are flexible. Teams can map columns directly to the standard workflow states (one‑to‑one) or create a bespoke mapping where several columns all represent the same underlying status. For example, a team might create columns called *UX*, *UI*, *Development*, and *Testing* that all sit under the official **In Progress** state. Moving a card between these columns updates the visual board but does not alter the state of child tasks or stories. A future global configuration flag may optionally change that behaviour, but it is not part of the initial scope.

## 5. Page Structure & Key Views

### Common Pages (Scrum & Kanban)

- **Home:** Widget‑driven dashboard, fully customised by each user.
- **Artefact Backlogs:** Table views for User Stories, Defects, and all Portfolio items, showing parent‑child relationships.
- **Planning Tools:** Timeline (Gantt‑style), Capacity Planning (skills and availability), and Release Planning.
- **Risk Management:** Dedicated Risk Dashboard and a full Risk register table.
- **Administration:** User Management, Project configuration, and System settings.

### Kanban‑specific Pages

- **User Story Kanban Board:** Columns based on the User Story workflow, with custom mapping support.
- **Portfolio Kanban Boards:** Separate board views for Features and any custom portfolio layers.

### Scrum‑specific Pages

- **Sprint Page:** Displays the sprint backlog with burn charts and acceptance ratios; users can switch between past and current sprints.
- **Sprint Manager:** Create and configure sprints (name, dates, goals).
- **Team Board:** A task‑focused column board that follows the Task workflow.

> **Switching between Scrum and Kanban:** Administrators can change the agile model for a project at any time. If switching from Scrum to Kanban, the system will warn that all existing Tasks will be detached and removed, since Kanban projects do not use Tasks.

## 6. Operational Decisions (Clarified Behaviour)

During scoping, several edge cases were discussed and resolved. The following rules are now part of the system's expected behaviour:

- **Manual parent completion:** If someone manually marks a User Story as "Completed" while its child Tasks are still open, the system does nothing to those children. The assumption is that execution‑space workers are responsible for maintaining accurate state, and this action is considered a deliberate override.
- **Renaming portfolio layers:** Layers are identified by a permanent internal reference, not just their name. Renaming "Business Objective" to "Outcome" does not break historical data or reporting.
- **Schema changes by admins:** Adding new portfolio layers or renaming states is a trusted administrative function and does not require secondary approval. The "Trust No One" security policy applies strictly to authentication, authorisation, and data access controls, not to these product configuration tasks.
- **Defect completion:** A Defect moves to "Accepted" only after formal QA verification. In a future phase, integration with GitHub will allow commit messages to reference Stories and Defects by their short codes, linking code changes directly to work items.

## 7. Data Integrity & History

Every action, no matter how small, is recorded in an immutable history log attached directly to the relevant work item. Whether someone clicks on a Task, updates a Defect, or changes a Product's status, a full audit trail is available in a dedicated "History" tab. This includes who made the change, when it happened, and what the old and new values were. The database is structured to enforce multi‑tenant isolation automatically; queries can never accidentally cross between different customer organisations.

To keep the interface fast while handling complex hierarchies, any automated status cascades (like a Task finishing and updating its parent Story) are processed in the background rather than making the user wait.

## 8. Security Philosophy: "Trust No One"

The platform is built with a Zero Trust mindset for all security and authentication layers. Every request is verified, every tenant's data is strictly separated at the database row level, and access is continuously validated. Enterprise single sign‑on (SAML and OIDC) and LDAP directory synchronisation are fully supported. Users who log in via their company directory may have certain profile fields locked to prevent local editing, maintaining consistency with corporate identity systems.

---

## 9. Summary of Abbreviations & Identifiers

| Artefact | Default code |
|---|---|
| Task | TA |
| User Story | US |
| Epic Story | ES |
| Feature | FE |
| Theme | TH |
| Business Objective | BO |
| Product | PR |

These can be customised per project. Codes (referred to internally as "tags") are 2–4 characters — the defaults above are all two characters, but a team can rename `TA` to `JOB` or `US` to `STORY` without migrating history. The combination of abbreviation, project key, and sequential number creates a globally unique, human‑readable reference for every work item in the system.

## 10. Future Integration (GitHub Hooks)

Planned enhancements include a listener for GitHub commit messages. When a developer writes a commit message containing a work item short code, the system will record the commit hash in the item's history. This creates a direct, auditable link between code changes and the Agile backlog without requiring manual updates.

## 11. Planned Layer: OKRs

Objectives and Key Results are a planned addition to the portfolio stack. The exact position (above Portfolio, under Product, or orthogonal to the hierarchy as a cross-cutting link) and the shape (Objective-only vs Objective → Key Result → item ladder) are yet to be finalised. This note exists so the OKR layer is not overlooked during backlog design — the item tables should not be frozen until the OKR position is decided, because items will need to ladder up to an Objective or Key Result.

## 12. Planned Paid Tier: Multi-Division Config

For tenants that operate multiple sub-divisions under one corporate umbrella (e.g. a holding company like News Corp running "The Sun" and "The Times" as separate mastheads), a paid-tier feature is planned that allows configuration — tag vocabularies, artefact hierarchy, workflow states, and key-number sequences — to be scoped **per sub-division** rather than per tenant. Each sub-division gets its own ring-fenced config root so that, for example, "The Sun" can rename `US` to `STORY` and begin issuing `STORY-00000001` independently of "The Times". Default tenants retain a single tenant-scoped configuration. This note exists so the base schema is not designed in a way that closes the door on per-division scoping later — a nullable config-root pointer can be added to the item-type and state tables as a non-breaking migration when the feature is built.

---

**Statement of Work · Enterprise Agile SaaS Platform · Page 1/1**

This document defines the scope and intended behaviour of the system. All sections have been proofread for clarity.
