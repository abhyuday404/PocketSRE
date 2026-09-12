# Hosted PocketSRE

`render.yaml` defines one personal, authenticated Node service with a 1 GB persistent disk. The paid instance continues monitoring without a laptop or open mobile app. A single instance still has brief interruptions during deployments and provider outages; this is not a high-availability cluster.

Deploy only after approving the recurring hosting cost. The Render draft uses the `codex/hosted-backend` branch, native Node, the repository root, the build/start commands from the blueprint, and `/health` as its health check. Never commit deployment secrets. Set `GATEWAY_ACCESS_TOKEN` through Render's secret environment settings, along with the public GitHub App client ID and slug. Use the existing private device key when migrating this personal installation.

All persistent paths must point into `/var/data/pocketsre`, including `MONITOR_PATH`. The synthetic demo runs on an ephemeral loopback port inside the same process; only the authenticated API is public. `/health` is public for the platform health check. SIGTERM stops monitoring and closes both servers.

Before switching the phone, copy the existing project directory and monitoring state onto the mounted disk using Render SSH. Do not overwrite newer hosted state. Verify the hosted project list and a successful authenticated incident fetch before switching clients.

Build the mobile app with `EXPO_PUBLIC_BACKEND_URL` set to the assigned HTTPS service URL. It becomes the automatic service address, and the connection form is hidden when a saved key exists. For the existing phone only, set `EXPO_PUBLIC_MIGRATE_BACKEND_FROM` to its exact former URL so its SecureStore key can be reused. Credentials from unrelated servers are never reused. Neither variable contains a secret. A fresh installation needs its private app access key once under Settings, then normal GitHub device authorization. This is a personal backend, not a multi-user authentication service.

Use an Android build with bundled JavaScript for laptop-independent use; a Metro development build still needs the development machine. Confirm the finished app works with USB forwarding and Metro disconnected.

GitHub OAuth currently remains in server memory, so a redeploy requires reconnecting GitHub. Expiring GitHub App user tokens also require reauthorization. Stored projects, incident history, health monitoring configuration and audit records survive deployment through the disk; GitHub-dependent operations require a connected account. Do not describe this as permanently authenticated GitHub access.
