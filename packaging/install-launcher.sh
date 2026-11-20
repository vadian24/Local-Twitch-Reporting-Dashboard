#!/usr/bin/env bash
set -euo pipefail

bundle_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exe="$bundle_dir/Local-Twitch-Reporting-Dashboard"
icon="$bundle_dir/dashboard-icon.png"
app_id="com.vadian24.local-twitch-reporting-dashboard"
applications_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"

if [[ ! -x "$exe" || ! -f "$icon" ]]; then
  printf '%s\n' 'Run this script from the extracted Linux dashboard folder.' >&2
  exit 1
fi

# Desktop entries escape their value before applying Exec argument quoting.
exec_argument="$(python3 - "$exe" <<'PY'
import sys

value = sys.argv[1].replace('%', '%%')
value = ''.join('\\' + character if character in '\\"$`' else character for character in value)
print(('"' + value + '"').replace('\\', '\\\\'))
PY
)"
icon="${icon//\\/\\\\}"
mkdir -p -- "$applications_dir"
cat > "$applications_dir/$app_id.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Local Twitch Reporting Dashboard
Exec=$exec_argument
Icon=$icon
Terminal=false
StartupWMClass=$app_id
Categories=Utility;
DESKTOP
printf '%s\n' 'Open Local Twitch Reporting Dashboard from your application menu, then pin it to your taskbar.'
