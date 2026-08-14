# Repository instructions

These rules apply to the entire repository.

## Finding tracking

- Whenever any finding is discovered, add or update an entry in the root `TODO.md` before reporting or acting on it.
- Findings include bugs, security concerns, UX/UI issues, performance problems, missing tests, regressions, compatibility risks, and technical debt.
- Do not create duplicate entries. Update the existing row when the same finding changes.
- Move findings that cannot progress without external input, hardware, credentials, or a dependency into the dedicated `Blocked` table; move them back to `Findings` when they become actionable.
- Once a finding is fully resolved and verified, remove its row automatically instead of retaining completed work in `TODO.md`. Include the removal in the same scoped commit as the resolution; when no companion changes remain, commit the removal as a scoped documentation change.
- The `done` status is transitional only; no completed row should remain after its resolution is committed.
- Move findings intentionally rejected or not planned to the dedicated `Rejected / Won't fix` table in `TODO.md`; never mix them into the active `Findings` table. Record the decision and concise rationale in the description instead of removing the row.
- Use stable sequential IDs in the form `XTPU-0001`.
- Use only `open`, `in_progress`, or transitional `done` in the active `Findings` table.
- Use only `blocked` in the `Blocked` table.
- Use only `rejected` or `wont_fix` in the `Rejected / Won't fix` table.
- Use only these severity values: `critical`, `high`, `medium`, `low`.
- Use only these effort values: `xs`, `s`, `m`, `l`, `xl`.
- Put comma-separated IDs in `related ids`; use `—` when none exist.
- Keep descriptions concise, actionable, and specific.
- Preserve this exact schema for all three tables:

  `| id | status | severity | effort | related ids | description |`

## Software design and architecture

- All new and materially changed code must follow SOLID principles, domain-driven design (DDD), and idiomatic best practices for its language, framework, and ecosystem.
- Keep domain logic independent from UI, persistence, transport, infrastructure, and framework concerns. Dependencies must point toward the domain and application core.
- Keep contracts and interfaces separate from concrete implementations at every architectural boundary. Consumers must depend on injected abstractions, never implementation details; if the correct boundary or degree of decoupling is ambiguous, stop and ask the user before introducing coupling.
- Define bounded contexts and use consistent domain language. Apply entities, value objects, aggregates, repositories, domain services, and domain events where the domain requires them.
- Keep modules cohesive, responsibilities narrow, interfaces explicit, dependencies injected at boundaries, and side effects isolated.
- Follow language-native conventions for formatting, static analysis, typing, error handling, resource management, concurrency, security, testing, packaging, and public APIs.
- Keep architecture proportional to the problem. Add layers and abstractions only when they enforce a concrete domain boundary or maintenance need.
- Record unavoidable architectural compromises and technical debt in `TODO.md`.

## Implementation and fix quality gates

- Whenever implementing or fixing code, add or update all of the following:
  - unit and integration tests appropriate to the changed behavior;
  - regression tests whenever the change fixes or prevents a reproducible defect;
  - fuzz or property-based coverage for changed input boundaries and state transitions;
  - mutation tests covering changed logic.
- Achieve at least 80% coverage for every changed or added function or method, regardless of programming language. Aggregate file or project coverage does not replace this per-function requirement.
- Unless the user explicitly requests a long or full suite, run only tests and quality gates scoped to the changed behavior; do not run complete repository suites by default.
- Parallelize independent scoped tests and gates whenever safe, provided their temporary files, coverage data, and mutation reports cannot collide.
- A user may explicitly waive one or more named local quality gates for the current scoped commit. A waiver is one-time: stop or skip only the named gates, never report them as passing, and disclose the waiver and partial result in the commit message and final handoff. All remaining applicable gates must still pass.
- If required tooling is missing or a quality gate cannot run, record the blocker in `TODO.md`; do not treat the implementation or fix as complete.

## UX and UI

- For every UX/UI design or change, review and apply all relevant principles published at <https://lawsofux.com/>.
- Use familiar platform conventions, progressive disclosure, clear hierarchy, meaningful grouping, accessible contrast, readable typography, sufficiently large targets, visible focus, keyboard access, screen-reader labels, and explicit feedback states.
- Do not rely on aesthetics or color alone to communicate meaning.
- Validate UX/UI behavior at the supported sizes, themes, scale factors, input methods, loading states, empty states, error states, and recovery states.
- Record every UX/UI audit finding in `TODO.md`.

## Git

- Never push automatically. Push only when the user explicitly requests it.
- After an implementation or fix passes every applicable local test, regression, fuzz, mutation, and per-function coverage gate, commit the scoped changes automatically. A gate explicitly waived under the one-time rule above does not prevent that scoped commit.
- Do not commit a failing, incomplete, or blocked implementation or fix.
- Do not stage or commit unrelated user changes.
- Use concise Conventional Commit messages.
- Never add AI or assistant co-author trailers. Commit messages must contain no `Co-Authored-By` line naming Claude or any other assistant, and no generated-by attribution.
