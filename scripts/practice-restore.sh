#!/usr/bin/env bash
set -euo pipefail

source_id="${1:?usage: practice-restore.sh <crm|bahikhata> <dump_dir> [target_db] [original_db]}"
dump_dir="${2:?dump directory required}"
target_db="${3:-${source_id}_practice}"
original_db="${4:-$(ls -1 "$dump_dir" | grep -v '^oplog' | head -n1)}"
uri="${PRACTICE_MONGO_URI:-mongodb://127.0.0.1:27017}"

case "$uri" in
  mongodb://127.0.0.1*|mongodb://localhost*|mongodb://\[::1\]*) ;;
  mongodb://*@127.0.0.1*|mongodb://*@localhost*) ;;
  *) echo "refusing non-local target: $uri" >&2; exit 1 ;;
esac

if [ ! -d "$dump_dir/$original_db" ]; then
  echo "dump database folder not found: $dump_dir/$original_db" >&2
  exit 1
fi

mongorestore --uri "$uri" --drop --nsInclude "${original_db}.*" --nsFrom "${original_db}.*" --nsTo "${target_db}.*" "$dump_dir"
mongosh "$uri" --quiet --eval "const d = db.getSiblingDB('${target_db}'); printjson(d.getCollectionNames().map((name) => ({ name, count: d.getCollection(name).estimatedDocumentCount() })))"
