#!/bin/sh
set -eu

STAGECRAFT_HOME="${STAGECRAFT_HOME:-$(CDPATH= cd "$(dirname "$0")/../.." && pwd)}"
PATH="${STAGECRAFT_HOME}/bin:${PATH}"
export STAGECRAFT_HOME PATH

usage() {
  cat <<'EOF'
Stagecraft Docker runner

Usage:
  docker run --rm -v "$PWD:/workspace" stagecraft-runner:latest run --cwd /workspace
  docker run --rm -v "$PWD:/workspace" stagecraft-runner:latest devteam status --cwd /workspace

The image delegates to the normal devteam CLI. Mount the target project at
/workspace and pass credentials through --env-file, -e, Docker secrets, or your
runtime's secret manager. No pipeline starts when no command is supplied.
EOF
}

if [ "$#" -eq 0 ]; then
  usage
  exit 0
fi

if [ "${1:-}" = "devteam" ]; then
  shift
fi

workspace_from_args() {
  previous=""
  for arg in "$@"; do
    if [ "$previous" = "--cwd" ]; then
      printf '%s\n' "$arg"
      return 0
    fi
    case "$arg" in
      --cwd=*)
        printf '%s\n' "${arg#--cwd=}"
        return 0
        ;;
    esac
    previous="$arg"
  done
  if [ -d /workspace ]; then
    printf '%s\n' "/workspace"
  else
    pwd
  fi
}

lock_value() {
  file="$1"
  key="$2"
  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    const key = process.argv[2];
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (data[key] !== undefined && data[key] !== null) {
        process.stdout.write(String(data[key]));
      }
    } catch {}
  ' "$file" "$key"
}

report_lock() {
  cwd="$1"
  lock="${cwd}/pipeline/run.lock"
  [ -f "$lock" ] || return 0

  pid="$(lock_value "$lock" pid || true)"
  started="$(lock_value "$lock" started_at || true)"
  host="$(lock_value "$lock" host || true)"

  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "[stagecraft-runner] active run.lock: $lock" >&2
    echo "[stagecraft-runner] pid ${pid}, host ${host:-unknown}, started ${started:-unknown}" >&2
    echo "[stagecraft-runner] inspect: devteam status --cwd $cwd" >&2
    echo "[stagecraft-runner] resume after it stops: devteam run --cwd $cwd --resume" >&2
    return 0
  fi

  echo "[stagecraft-runner] stale run.lock detected: $lock" >&2
  echo "[stagecraft-runner] resume: devteam run --cwd $cwd --resume" >&2
  echo "[stagecraft-runner] force if you accept the risk: devteam run --cwd $cwd --force" >&2
  if [ "${STAGECRAFT_RUNNER_CLEAR_STALE_LOCK:-0}" = "1" ]; then
    rm -f "$lock"
    echo "[stagecraft-runner] removed stale run.lock because STAGECRAFT_RUNNER_CLEAR_STALE_LOCK=1" >&2
  else
    echo "[stagecraft-runner] set STAGECRAFT_RUNNER_CLEAR_STALE_LOCK=1 to remove it before delegation" >&2
  fi
}

cwd="$(workspace_from_args "$@")"
report_lock "$cwd"

exec devteam "$@"
