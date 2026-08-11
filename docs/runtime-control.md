# Runtime control contract

The applet sends version 1 JSON commands to the user-session D-Bus service
`org.cinnamon.OmniTensor1`, object `/org/cinnamon/OmniTensor1`,
interface `org.cinnamon.OmniTensor1`, method `ApplyCommand(in s command,
out s acknowledgement)`. The service implementing this name is the OmniTensor
runtime, a separate sibling project. Calls time out after five seconds and are
cancelled when the applet is removed.

The bus, object, and interface names replaced the earlier TPU-specific names;
the operations themselves are unchanged: `set-profile-enabled`,
`set-profile-weight`, and `set-paused`, each carrying an optimistic
`expectedRevision`. A command to pin a workload to a specific backend is
explicitly future work; no such operation exists in the version 1 contract.

Commands and acknowledgements must match `runtime-command.schema.json` and
`runtime-acknowledgement.schema.json`. Each command carries the revision the
applet last observed. The service returns either an `applied` acknowledgement
with the authoritative portfolio and next revision, or a `rejected`
acknowledgement with the unchanged authoritative portfolio and a recovery
message. The applet never presents an optimistic local edit as applied.

`lib/runtime-control-service.js` is the transport-independent reference service.
Runtime implementations inject an atomic policy repository and workload catalog,
expose `RuntimeControlService.handle`, and return its result through D-Bus.

## Version handshake

`DescribeContract(out s description)` on the same interface answers what the
running service speaks, before anything is sent to it. The document is
validated against the mirrored `runtime-contract.schema.json` and names every
method the service exports plus the version each wire contract is pinned at.

The applet had no way to ask. It could only call a method and read the
failure, and "this service is older than you" arrives as a D-Bus
`UnknownMethod` or a `method-unknown` refusal — indistinguishable from a
service that is broken or has just stopped, which is the wrong thing to show a
user and the wrong thing to act on. D-Bus introspection would not have closed
the gap: it enumerates method *names*, and two services can both export
`ApplyCommand` while disagreeing entirely about what a command looks like.

`lib/runtime-contract.js` holds what this build requires — the methods it
calls and the version of every document it sends or parses — and compares them
against the answer. What the applet requires is a property of the applet, so
the comparison lives in a module with no transport and no UI;
`lib/runtime-contract-gateway.js` is the transport, and the manager asks once
at start and again whenever the bus name changes owner, because a service that
has just appeared may be a different build from the one that answered before.

Three rules follow from what the handshake is for:

- **Not knowing is not a mismatch.** Until the service answers, the applet
  reports nothing. Telling a user their versions disagree when the applet has
  simply not asked would invent a fault.
- **A failed handshake is silent.** Every reason it can fail is already
  reported by whichever call actually needed the service, and a failure leaves
  the applet knowing exactly what it knew before it asked.
- **Only what this build sends is compared.** A service speaking a newer
  `runtime-job-submit` costs nothing to an applet that submits no jobs;
  reporting it would be a mismatch with no remedy.

`tests/contract/runtime-contract-handshake-contract.test.js` pins the mirrored
schema, the exported method, and every required version against the service
sources wherever both checkouts are present. A handshake that itself drifts
would report agreement between two builds that do not agree, which is worse
than having none.

## Forecast readings

OmniTensor may attach one bounded forecast reading to a successful forecast
job: exactly `kind`, `targetFeature`, `horizon`, and `value`. `horizon` counts
future observations, not time. `value` has no implied unit. The applet rejects
missing, extra, out-of-range, and non-finite fields, then renders one advisory
row containing only target, horizon, and value. It does not invent units,
confidence, risk, or an autonomous action.

The popup's Run surface still submits picture workloads only. Trusted forecast
execution belongs to OmniTensor's `omnitensor-run-forecast` command, which
builds inputs from recorded history and installed bindings. OmniTensor also
publishes its forecast summary as a generic snapshot alert, so the existing
Alerts screen can show the result without claiming the applet submitted or owns
that job.
