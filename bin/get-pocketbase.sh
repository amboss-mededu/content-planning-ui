#!/usr/bin/env bash
# Downloads the pinned PocketBase release into ./bin/pocketbase and
# verifies its SHA256 against checksums.txt. Idempotent: skips when the
# binary already exists at the right version. Run from repo root.
set -euo pipefail

PB_VERSION="0.37.5"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "${SCRIPT_DIR}/.." && pwd )"
BIN_PATH="${REPO_ROOT}/bin/pocketbase"

# Pinned SHA256s for v0.37.5 (from
# https://github.com/pocketbase/pocketbase/releases/download/v0.37.5/checksums.txt).
declare -A SHA256
SHA256[darwin_amd64]="9a840c3b8e88566fd20bbca004f477f1eeea38ded4d5e2fd0f9de8859f5c3ce3"
SHA256[darwin_arm64]="25ed98f669c586470ab2b90f418a50d9623dd578dd8d1562d38c1216dbf1f9d9"
SHA256[linux_amd64]="8faf6fc372604c62a20450daadbbe83b090e191a9784ff0eb1fb361d288fdb98"
SHA256[linux_arm64]="b27e7011c937833c368ff6307b046496ee0e342cc29dbe3a1e63a3be753c0d17"
SHA256[linux_armv7]="147e8ede3ff0536ca5c9a756bc25acb23da57e929d21f8b3422fe41fd0e2f4b3"

uname_s="$(uname -s | tr '[:upper:]' '[:lower:]')"
uname_m="$(uname -m)"
case "${uname_s}_${uname_m}" in
  darwin_x86_64)  PLATFORM="darwin_amd64" ;;
  darwin_arm64)   PLATFORM="darwin_arm64" ;;
  linux_x86_64)   PLATFORM="linux_amd64"  ;;
  linux_aarch64)  PLATFORM="linux_arm64"  ;;
  linux_armv7l)   PLATFORM="linux_armv7"  ;;
  *) echo "unsupported platform: ${uname_s} ${uname_m}" >&2; exit 1 ;;
esac

if [[ -x "${BIN_PATH}" ]]; then
  current_version="$( "${BIN_PATH}" --version 2>/dev/null | awk '{print $NF}' || true )"
  if [[ "${current_version}" == "v${PB_VERSION}" || "${current_version}" == "${PB_VERSION}" ]]; then
    echo "PocketBase v${PB_VERSION} already at ${BIN_PATH} — nothing to do."
    exit 0
  fi
  echo "Existing binary at ${BIN_PATH} reports ${current_version:-unknown}; re-downloading v${PB_VERSION}."
fi

EXPECTED_SHA="${SHA256[$PLATFORM]:-}"
if [[ -z "${EXPECTED_SHA}" ]]; then
  echo "no pinned SHA256 for platform ${PLATFORM}" >&2; exit 1
fi

ARCHIVE="pocketbase_${PB_VERSION}_${PLATFORM}.zip"
URL="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${ARCHIVE}"
TMP="$( mktemp -d )"
trap 'rm -rf "${TMP}"' EXIT

echo "Downloading ${URL}..."
curl -fsSL "${URL}" -o "${TMP}/${ARCHIVE}"

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA="$( sha256sum "${TMP}/${ARCHIVE}" | awk '{print $1}' )"
else
  ACTUAL_SHA="$( shasum -a 256 "${TMP}/${ARCHIVE}" | awk '{print $1}' )"
fi
if [[ "${ACTUAL_SHA}" != "${EXPECTED_SHA}" ]]; then
  echo "SHA256 mismatch for ${ARCHIVE}" >&2
  echo "  expected: ${EXPECTED_SHA}" >&2
  echo "  actual:   ${ACTUAL_SHA}" >&2
  exit 1
fi
echo "SHA256 verified: ${ACTUAL_SHA}"

if command -v unzip >/dev/null 2>&1; then
  unzip -q -o "${TMP}/${ARCHIVE}" -d "${TMP}"
else
  echo "unzip not found; install it first" >&2; exit 1
fi

mkdir -p "${REPO_ROOT}/bin"
mv "${TMP}/pocketbase" "${BIN_PATH}"
chmod +x "${BIN_PATH}"

echo
echo "Installed PocketBase v${PB_VERSION} at ${BIN_PATH}"
echo "Next steps:"
echo "  ./bin/pocketbase serve         # admin UI on http://localhost:8090/_/"
echo "  ./bin/pocketbase migrate up    # apply pb_migrations/ (also auto-runs on serve)"
