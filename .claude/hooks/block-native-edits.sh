#!/usr/bin/env bash
# PreToolUse hook — bloque toute édition dans android/ ou ios/.
# Toute modif native doit passer par app.config.js + expo-build-properties + expo prebuild.
set -euo pipefail

payload="$(cat)"
file_path="$(printf '%s' "$payload" | /usr/bin/python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null || true)"

if [[ -z "$file_path" ]]; then
  exit 0
fi

case "$file_path" in
  */android/*|*/ios/*|android/*|ios/*)
    cat <<'JSON'
{
  "decision": "block",
  "reason": "Édition directe interdite dans android/ ou ios/. Passe par app.config.js + expo-build-properties + 'npx expo prebuild' (règle rn-expo-dev / feedback_expo_native_folders)."
}
JSON
    exit 0
    ;;
esac

exit 0
