#!/bin/sh
set -e
# installations whose image volume or TLS files belong to root must keep running as root
as_node() {
  setpriv --reuid=node --regid=node --init-groups "$@"
}

can_drop_root() {
  as_node test -w /imageUploads || return 1
  for file in "${HTTPS_KEY_PATH:-./secrets/ssl.key}" "${HTTPS_CERT_PATH:-./secrets/ssl.cert}"; do
    if [ -e "$file" ] && ! as_node test -r "$file"; then
      return 1
    fi
  done
}

if [ "$(id -u)" = "0" ]; then
  if can_drop_root; then
    exec setpriv --reuid=node --regid=node --init-groups "$@"
  fi
  echo "vrt-entrypoint: /imageUploads or the TLS files are not accessible to uid 1000 (node); running as root" >&2
fi
exec "$@"
