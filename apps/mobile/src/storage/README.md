# Offline incident history

The mobile store is independent of gateway persistence. Each gateway URL has its own
history. Imported bundles and merged investigations share a separate offline collection;
sample analyses have another collection. Offline entries are visible regardless of the
current connection. They never grant permission to execute actions.

The store retains the latest five distinct captures per incident/service, with at most
thirty captures in each gateway, import, or sample collection. Capture order determines
retention even if a device clock moves backwards. Diagnoses expire with their snapshots.
Reanalyzing an identical snapshot replaces that snapshot's diagnosis. Identical refreshes
reuse the existing capture and analysis; changed timestamps count as a new snapshot.

A SHA-256 snapshot ID includes provenance, gateway, and the entire validated, sanitized
bundle, including health, evidence contents, collection results, and generated timestamps.
Every stored diagnosis names its snapshot ID and is validated against that bundle before
and after sanitization, and again when read. Invalid analyses are discarded while valid
evidence remains available. The hash detects mismatches; it does not authenticate a cache
or turn imported data into trusted gateway data.

On startup the newest available snapshot for the current gateway or offline collections
is shown while the app attempts a live refresh. Reopening a Saved row restores its exact
analysis and evidence offline. A live refresh may restore only a matching gateway snapshot;
changed evidence clears the displayed analysis. Changing the view or refreshing also
invalidates any action confirmation already on screen.

The version 2 local envelope has a revision, JSON payload, and SHA-256 checksum covering
the revision and payload. Writes alternate between two files and verify the written data,
leaving the prior generation available during an interrupted write. Reads choose the
newest intact generation and skip malformed records/analyses. Recovery can lose the
interrupted save, but preserves the previous intact generation. This is local crash
recovery, not an encrypted backup or an authenticity guarantee.

Legacy arrays of `{ gateway, bundle }` are migrated across all gateways. Their capture
time is explicitly unknown, and they have no diagnosis. Migration writes and verifies the
new format before removing the old copy. A failed migration leaves readable legacy data
available. Unknown future formats are not overwritten.

All storage operations, including migration and clearing, run in one queue. **Clear all
saved data** deletes both generations across all gateways, imports, samples, and diagnoses,
and removes the active offline analysis from memory. Exported files are not deleted.
Subsequent refreshes, imports, or analyses save new data. No backend API or import/export
wire contract changes are needed: exported incident bundles remain schema version 1.

The diagnosis task owns the forthcoming shared `sanitizeDiagnosis` helper and collection
redaction. Until integration, the local persistence boundary applies `redactText` and
validates again. Replace that small adapter with the shared helper when integrating;
do not change the snapshot association or accept unvalidated diagnoses. The gateway task's
additive contract fields will be included in snapshot IDs as soon as those contracts are
integrated. The UI already labels unknown health, null releases, and gateway evidence.
