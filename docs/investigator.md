# Phone-to-laptop investigation

The phone's **Share incident bundle** button writes sanitized JSON and opens Android's file share sheet. Transfer that file using Office Kit or another file-transfer app. PocketSRE does not integrate a proprietary Office Kit SDK.

From the monorepo root:

```bash
pnpm investigator /path/to/incident.json --repo /path/to/service --output /path/to/result.json
```

`--repo` is optional. Without it, the CLI performs simple configuration-keyword and repeated-error checks against the bundle, not a runtime investigation. With it, the CLI compares JavaScript/TypeScript environment-variable references under the service's `src/` directory against keys declared in its root `.env.example`. For a monorepo, point it at the individual service directory.

The static scan does not execute repository code or read `.env` files. It skips symlinks, limits depth to eight, reads at most 250 files of up to 128 KB each, and limits total content to 2 MB. It extracts variable names rather than values. A missing key is a configuration-contract discrepancy, not proof that the production environment lacks that variable. Tests, runtime checks, remote agents, and automatic code fixes are not implemented.

The output file must not already exist. Return it to the phone and use **Import JSON**. Results must match the incident ID and reference existing evidence IDs. Imported checks become additional evidence for another triage pass. Imported bundles and saved history are explicitly offline snapshots; recovery stays disabled until fresh gateway data is loaded.
