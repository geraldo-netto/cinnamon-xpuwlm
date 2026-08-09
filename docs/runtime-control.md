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
