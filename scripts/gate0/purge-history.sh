#!/usr/bin/env bash
set -euo pipefail
repo_dir="$1"
replacements="$2"
slug="$3"
command -v git-filter-repo >/dev/null
cd "$repo_dir"
git diff --quiet && git diff --cached --quiet
git filter-repo --force --replace-text "$replacements"
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$slug.git"
git push origin --force --all
git push origin --force --tags
gh repo edit "$slug" --visibility private --accept-visibility-change-consequences
gh api "repos/$slug/collaborators" --jq '.[] | [.login, .permissions.admin] | @tsv'
