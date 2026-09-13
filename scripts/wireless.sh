#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
repository_root="$PWD"
node_binary="$(command -v node)"
cloudflared_binary="${CLOUDFLARED:-$HOME/.pocketsre/bin/cloudflared}"
if [[ ! -x "$cloudflared_binary" ]]; then
  echo 'Install cloudflared at ~/.pocketsre/bin/cloudflared or set CLOUDFLARED to its path.' >&2
  echo 'Official downloads: https://developers.cloudflare.com/tunnel/downloads/' >&2
  exit 1
fi
"$node_binary" --env-file="$HOME/.pocketsre/gateway.env" --input-type=module -e '
  if (!process.env.GATEWAY_ACCESS_TOKEN?.trim()) throw Error("Set a private GATEWAY_ACCESS_TOKEN before tunneling.");
'
if ! systemctl --user is-active --quiet pocketsre-backend; then
  pnpm --filter @pocketsre/gateway... build
  systemctl --user reset-failed pocketsre-backend 2>/dev/null || true
  systemd-run --user --unit=pocketsre-backend --property=Restart=on-failure --property=RestartSec=3 \
    --working-directory="$repository_root/services/gateway" --setenv=POCKETSRE_EMBED_DEMO=1 \
    "$node_binary" dist/server.js
fi
"$node_binary" --input-type=module -e '
  for (let attempt=0; attempt<50; attempt++) {
    try {
      const r=await fetch("http://127.0.0.1:4100/v1/projects");
      if (r.status !== 401) throw Error("Refusing to tunnel an unprotected API");
      process.exit(0);
    } catch (error) {
      if (error.message.includes("unprotected")) throw error;
      await new Promise(resolve=>setTimeout(resolve,200));
    }
  }
  throw Error("Backend did not become ready on port 4100");
'
if ! systemctl --user is-active --quiet pocketsre-tunnel; then
  systemctl --user reset-failed pocketsre-tunnel 2>/dev/null || true
  systemd-run --user --unit=pocketsre-tunnel --property=Restart=always --property=RestartSec=5 \
    "$cloudflared_binary" tunnel --no-autoupdate --url http://127.0.0.1:4100 --protocol http2
fi
echo 'Backend and tunnel are running in the background. Keep this PC awake and online.'
echo 'Find the current HTTPS address with:'
echo 'journalctl --user -u pocketsre-tunnel -o cat --no-pager | rg "https://.*trycloudflare.com"'

if [[ -f "$HOME/.pocketsre/demo-lab/config.json" ]] && ! systemctl --user is-active --quiet pocketsre-demo-lab; then
  systemd-run --user --unit=pocketsre-demo-lab --property=Restart=on-failure --property=RestartSec=5 \
    --working-directory="$repository_root" "$node_binary" "$repository_root/scripts/demo-lab.mjs" "$HOME/.pocketsre/demo-lab"
fi
