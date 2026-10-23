#!/usr/bin/env bash
# Builds the CodeitLab CLI launcher package and publishes it to npm.
#
#   ./scripts/publish-codeitlab-cli.sh                 # build → dry-run → confirm → publish
#   ./scripts/publish-codeitlab-cli.sh --dry-run       # build → dry-run only
#   ./scripts/publish-codeitlab-cli.sh --yes --otp 123456
#   ./scripts/publish-codeitlab-cli.sh --tag nightly --version 0.1.0-nightly.1
#
# The tarball is a launcher: it runs the CLI of the installed CodeitLab app and
# falls back to downloading the release archive (see docs/codeitlab/PUBLISH-NPM.md).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PACKAGE_NAME="codeitlab"
VERSION="$(node -p "require('./apps/server/package.json').version")"
TAG="latest"
OTP=""
PROVENANCE=0
DRY_RUN_ONLY=0
ASSUME_YES=0
SKIP_BUILD=0
OUTPUT_DIR="${TMPDIR:-/tmp}/codeitlab-npm-packages"

usage() {
  cat <<'EOF'
Builds the CodeitLab CLI launcher package and publishes it to npm.

  ./scripts/publish-codeitlab-cli.sh                 # build → dry-run → confirm → publish
  ./scripts/publish-codeitlab-cli.sh --dry-run       # build → dry-run only
  ./scripts/publish-codeitlab-cli.sh --yes --otp 123456
  ./scripts/publish-codeitlab-cli.sh --tag nightly --version 0.1.0-nightly.1


Flags:
  --version <v>      Package version (default: apps/server/package.json)
  --tag <tag>        npm dist-tag: latest | nightly | preview (default: latest)
  --otp <code>       npm 2FA one-time password
  --provenance       Attach npm provenance (only works in CI with OIDC)
  --dry-run          Build and dry-run publish, then stop
  --yes              Skip the interactive confirmation
  --skip-build       Reuse an existing tarball in --output-dir
  --output-dir <d>   Where to build the package (default: $TMPDIR/codeitlab-npm-packages)
  -h, --help         Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:?--version needs a value}"; shift 2 ;;
    --tag) TAG="${2:?--tag needs a value}"; shift 2 ;;
    --otp) OTP="${2:?--otp needs a value}"; shift 2 ;;
    --provenance) PROVENANCE=1; shift ;;
    --dry-run) DRY_RUN_ONLY=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --output-dir) OUTPUT_DIR="${2:?--output-dir needs a value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; usage >&2; exit 2 ;;
  esac
done

TARBALL="$OUTPUT_DIR/$PACKAGE_NAME.tgz"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] \
  || fail "Not a valid semver version: $VERSION"

step "1/5 Build the $PACKAGE_NAME npm launcher ($VERSION)"
if [[ "$SKIP_BUILD" -eq 1 ]]; then
  [[ -f "$TARBALL" ]] || fail "--skip-build was passed but $TARBALL does not exist"
  echo "Reusing $TARBALL"
else
  mkdir -p "$OUTPUT_DIR"
  node scripts/build-npm-launcher.ts build-codeitlab-cli-package \
    --version "$VERSION" \
    --output-dir "$OUTPUT_DIR"
fi
[[ -f "$TARBALL" ]] || fail "The builder did not produce $TARBALL"
echo "Tarball: $TARBALL ($(wc -c <"$TARBALL" | tr -d ' ') bytes)"

if [[ "$DRY_RUN_ONLY" -eq 0 ]]; then
  step "2/5 Check the npm login"
  npm whoami >/dev/null 2>&1 || fail "Not logged in. Run: npm login"
  echo "Logged in as $(npm whoami)"
fi

step "3/5 Dry-run publish"
PUBLISH_ARGS=(publish --access public --tag "$TAG" --dry-run "$TARBALL")
[[ "$PROVENANCE" -eq 1 ]] && PUBLISH_ARGS+=(--provenance)
[[ -n "$OTP" ]] && PUBLISH_ARGS+=(--otp "$OTP")
npm "${PUBLISH_ARGS[@]}"

if [[ "$DRY_RUN_ONLY" -eq 1 ]]; then
  step "Done (dry-run only)"
  echo "Nothing was published. Re-run without --dry-run to publish."
  exit 0
fi

if [[ "$ASSUME_YES" -eq 0 ]]; then
  echo
  read -r -p "Publish $PACKAGE_NAME@$VERSION with dist-tag '$TAG'? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || { echo "Cancelled."; exit 1; }
fi

step "4/5 Publish"
PUBLISH_ARGS=(publish --access public --tag "$TAG" "$TARBALL")
[[ "$PROVENANCE" -eq 1 ]] && PUBLISH_ARGS+=(--provenance)
[[ -n "$OTP" ]] && PUBLISH_ARGS+=(--otp "$OTP")
npm "${PUBLISH_ARGS[@]}"

step "5/5 Verify"
npm view "$PACKAGE_NAME@$VERSION" version dist.tarball
npm view "$PACKAGE_NAME" dist-tags

cat <<EOF

Published $PACKAGE_NAME@$VERSION (dist-tag: $TAG).

Next steps:
  • First publish only: register the trusted publisher at
    https://www.npmjs.com/package/$PACKAGE_NAME → Settings → Trusted publishing
    (GitHub Actions, workflow .github/workflows/release.yml).
  • Make sure release archives (t3-<version>-<platform>-<arch>.tar.gz + SHA256SUMS)
    exist so \`npx $PACKAGE_NAME\` works outside a checkout, and that
    CODEITLAB_RELEASE_BASE_URL points at your repo.
  • Try it: npx --yes $PACKAGE_NAME --version
EOF
