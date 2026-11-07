#!/usr/bin/env bash
# Puts a Steam Web API key (needed to download Workshop maps: -authkey) into the deployment, from the clipboard.
#
#   1. Create the key: https://steamcommunity.com/dev/apikey  (domain: any, e.g. localhost)
#   2. Copy it (Cmd+C), then run:  scripts/set-steam-web-key.sh
#
# The token is never printed. It is written to terraform/secrets.auto.tfvars (git-ignored), applied to the game VM's
# metadata, and the game VM is restarted so the server registers with Steam (data lives on a separate disk).
# Works on macOS (pbpaste) and Linux/Cloud Shell (xclip/xsel, or pass the token on stdin: pbpaste-less: echo TOKEN | ...).
set -euo pipefail
cd "$(dirname "$0")/.."

TF="${TF:-$(command -v tofu || command -v terraform)}"

read_clip() {
  if [ ! -t 0 ]; then cat
  elif command -v pbpaste >/dev/null; then pbpaste
  elif command -v xclip >/dev/null; then xclip -o -selection clipboard
  elif command -v xsel >/dev/null; then xsel -ob
  else echo "no clipboard tool; pipe the token on stdin" >&2; exit 1
  fi
}

TOKEN="$(read_clip | tr -d '[:space:]"')"
if ! [[ "$TOKEN" =~ ^[0-9A-Fa-f]{32}$ ]]; then
  echo "The clipboard does not hold a Steam Web API key (expected 32 hex characters). Copy the key again and re-run." >&2
  exit 1
fi

FILE=terraform/secrets.auto.tfvars
[ -f "$FILE" ] || { echo "$FILE not found: run scripts/init-secrets.sh first" >&2; exit 1; }
KEY_VALUE="$TOKEN" FILE="$FILE" python3 - <<'PY'
import os, re
p, tok = os.environ["FILE"], os.environ["KEY_VALUE"]
s = open(p).read()
line = f'steam_web_api_key = "{tok}"'
if re.search(r'^steam_web_api_key\s*=.*$', s, flags=re.M):
    s = re.sub(r'^steam_web_api_key\s*=.*$', lambda m: line, s, flags=re.M)
else:
    s += "\n" + line + "\n"
open(p, "w").write(s)
os.chmod(p, 0o600)
PY
echo "Steam Web API key saved (${TOKEN:0:4}…${TOKEN: -4})."

export YC_TOKEN="${YC_TOKEN:-$(yc iam create-token)}"
cd terraform
"$TF" init -input=false >/dev/null
# the bucket resource needs S3-style credentials in the environment (see deploy.sh)
export YC_STORAGE_ACCESS_KEY="$("$TF" output -raw storage_access_key)"
export YC_STORAGE_SECRET_KEY="$("$TF" output -raw storage_secret_key)"
"$TF" apply -input=false -auto-approve

ID="$("$TF" output -raw cs2_instance_id)"
if [ "${1:-}" = "--no-restart" ]; then
  echo "Done. The new key is used after the next restart of the game VM."
  exit 0
fi
echo "Restarting the game VM so it picks up the key (game files and data are on a persistent disk)..."
yc compute instance restart "$ID"
echo "Done. Watch the status in the panel (Overview)."
