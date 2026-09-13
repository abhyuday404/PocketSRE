# Wireless PC setup

PocketSRE runs on the PC, and Cloudflare Tunnel provides an HTTPS address for the phone. The phone can use Wi-Fi or mobile data; it does not need USB forwarding or the same network. Keep the PC awake, online, and running the backend and tunnel. No Render service is deployed or required.

The PC's private configuration lives outside the repository in `~/.pocketsre/gateway.env` (mode `0600`). Keep `GATEWAY_ACCESS_TOKEN` set to a long random key; the phone stores that key in SecureStore. GitHub's client ID and App slug also live in that config. Never include the key in the app bundle, a URL, or source control.

On Linux, install Cloudflare's official `cloudflared` binary in `~/.pocketsre/bin/cloudflared`, then run `pnpm wireless` from this repository. The script starts background user services and avoids restarting an already-running backend, preserving its current GitHub session. It verifies authentication is required before exposing the API. The local service uses port 4100 and retains project files under `services/gateway/.pocketsre-data` and monitoring state under `~/.pocketsre`.

Useful commands:

```sh
pnpm wireless
systemctl --user status pocketsre-backend pocketsre-tunnel
journalctl --user -u pocketsre-tunnel -o cat --no-pager | rg 'https://.*trycloudflare.com'
systemctl --user stop pocketsre-tunnel pocketsre-backend
```

These transient services last for the current user-manager session; run `pnpm wireless` again after reboot. A Quick Tunnel receives a new random address when the tunnel process restarts and does not offer an uptime guarantee. Change it under **Settings → Server connection**. If it still points to this same PC, explicitly enable **Same PC — use its saved key**; otherwise enter the new server's key. The saved address wins over the build's default on subsequent launches.

Use a standalone APK with JavaScript bundled (`pnpm android:internal`) to avoid depending on Metro. `EXPO_PUBLIC_GATEWAY_URL` sets the initial public address, never the access key. For a deliberate migration of an existing installation, `EXPO_PUBLIC_MIGRATE_BACKEND_FROM` names the exact previous address whose saved key may be reused with the HTTPS default. This must point to the same backend owned by the user.

Private repositories are supported. GitHub App installation access must include them, and the signed-in user must also have access. Use **Manage repository access on GitHub**, then **Refresh repositories**. This installation has Contents write access for confirmed PR merges, plus read access to metadata, pull requests, checks and commit statuses; enabling all personal repositories covers existing and future personal repositories. Organization repositories require that organization's installation/approval separately.

The GitHub OAuth session is held in backend memory and expires according to GitHub's token lifetime. Reconnect in the mobile app when needed or after restarting the backend. Project settings remain on disk.

References: [Cloudflare downloads](https://developers.cloudflare.com/tunnel/downloads/) and [GitHub user access](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).
