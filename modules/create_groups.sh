#!/usr/bin/env bash
# create_groups.sh — Bulk group creation and membership management  v1.0.0
# Sourced by user_mgmt_master.sh or run standalone.
# Usage (standalone): sudo bash modules/create_groups.sh [--dry-run] [--verbose]
set -euo pipefail

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    source "${SCRIPT_DIR}/config.conf"
    DRY_RUN=false; VERBOSE=false
    for _a in "$@"; do
        [[ "$_a" == "--dry-run" ]] && DRY_RUN=true
        [[ "$_a" == "--verbose" ]] && VERBOSE=true
    done
    log() { echo "[$(date '+%H:%M:%S')] [$1] [$2] $3"; }
    dry() { $DRY_RUN && echo "[DRY-RUN] $*" || "$@"; }
fi

module_create_groups() {
    log "INFO" "CREATE_GROUPS" "Starting bulk group creation and membership sync"

    local manifest="${GROUP_MANIFEST}"
    if [[ ! -f "$manifest" ]]; then
        log "WARN" "CREATE_GROUPS" "Group manifest not found: ${manifest} — creating sample"
        mkdir -p "$(dirname "$manifest")"
        cat > "$manifest" <<'MANIFEST'
# groupname,gid,members
# Leave gid blank for auto-assignment.  Members (":"-separated) must exist at run time.
developers,2001,alice:bob
ops_team,2002,carol:dave
auditors,2003,eve
contractors,2004,frank
git_users,2010,alice:bob:carol
docker_users,2011,carol:dave
deploy_team,2012,carol:dave
sudo_admins,2020,
MANIFEST
        log "INFO" "CREATE_GROUPS" "Sample manifest written to ${manifest}"
    fi

    local created=0 updated=0 skipped=0 failed=0

    while IFS=',' read -r groupname gid members; do
        [[ -z "$groupname" || "$groupname" =~ ^# ]] && continue
        groupname="${groupname// /}"
        gid="${gid// /}"

        # Create group if it does not exist
        if ! getent group "$groupname" &>/dev/null; then
            local ga_args=()
            [[ -n "$gid" ]] && ga_args+=("-g" "$gid")
            log "INFO" "CREATE_GROUPS" "Creating group: ${groupname} (gid=${gid:-auto})"
            if dry groupadd "${ga_args[@]}" "$groupname"; then
                (( created++ )) || true
            else
                log "ERROR" "CREATE_GROUPS" "Failed to create group: ${groupname}"
                (( failed++ )) || true
                continue
            fi
        else
            log "DEBUG" "CREATE_GROUPS" "Group '${groupname}' already exists"
            (( skipped++ )) || true
        fi

        # Sync membership
        if [[ -n "${members// /}" ]]; then
            local member_list="${members//:/ }"
            for member in $member_list; do
                member="${member// /}"
                [[ -z "$member" ]] && continue
                if ! id "$member" &>/dev/null; then
                    log "WARN" "CREATE_GROUPS" "User '${member}' not found — skipping membership in ${groupname}"
                    continue
                fi
                if ! id -nG "$member" 2>/dev/null | grep -qw "$groupname"; then
                    log "INFO" "CREATE_GROUPS" "Adding ${member} to ${groupname}"
                    dry usermod -aG "$groupname" "$member" && (( updated++ )) || true
                else
                    log "DEBUG" "CREATE_GROUPS" "${member} already in ${groupname}"
                fi
            done
        fi

    done < "$manifest"

    log "INFO" "CREATE_GROUPS" "Group management complete — created=${created} updated_memberships=${updated} skipped=${skipped} failed=${failed}"
    (( failed > 0 )) && return 1 || return 0
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    [[ $EUID -ne 0 ]] && { echo "Must be run as root" >&2; exit 1; }
    module_create_groups
fi
