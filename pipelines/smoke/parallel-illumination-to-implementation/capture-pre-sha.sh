#!/usr/bin/env bash
set -euo pipefail
sha=$(git rev-parse HEAD)
printf '{"pre_sha":"%s"}\n' "$sha"
