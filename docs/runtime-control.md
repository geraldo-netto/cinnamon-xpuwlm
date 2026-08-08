# Runtime control contract

The applet sends version 1 JSON commands to the user-session D-Bus service
`org.cinnamon.TpuWorkloadManager1`, object `/org/cinnamon/TpuWorkloadManager1`,
interface `org.cinnamon.TpuWorkloadManager1`, method `ApplyCommand(in s command,
out s acknowledgement)`. Calls time out after five seconds and are cancelled
when the applet is removed.

Commands and acknowledgements must match `runtime-command.schema.json` and
`runtime-acknowledgement.schema.json`. Each command carries the revision the
applet last observed. The service returns either an `applied` acknowledgement
with the authoritative portfolio and next revision, or a `rejected`
acknowledgement with the unchanged authoritative portfolio and a recovery
message. The applet never presents an optimistic local edit as applied.

`lib/runtime-control-service.js` is the transport-independent reference service.
Runtime implementations inject an atomic policy repository and workload catalog,
expose `RuntimeControlService.handle`, and return its result through D-Bus.
