#!/usr/bin/env bash
# create_users.sh — Bulk user creation module  v1.0.0
# Sourced by user_mgmt_master.sh or run standalone.
# Usage (standalone): sudo bash modules/create_users.sh [--dry-run] [--verbose]
set -euo pipefail

# ── Standalone bootstrap ──────────────────────────────────────────────────────
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

# ── Module main ───────────────────────────────────────────────────────────────
module_create_users() {
    log "INFO" "CREATE_USERS" "Starting bulk user creation"

    # Create data/ directory sample manifest if absent
    local manifest="${USER_MANIFEST}"
    if [[ ! -f "$manifest" ]]; then
        log "WARN" "CREATE_USERS" "User manifest not found: ${manifest} — creating sample"
        mkdir -p "$(dirname "$manifest")"
        cat > "$manifest" <<'MANIFEST'
# username,uid,primary_group,secondary_groups,shell,comment
# Leave uid blank for auto-assignment.  Use ":" to separate multiple secondary groups.
alice,1101,developers,git_users:docker_users,/bin/bash,Alice Johnson — Backend Developer
bob,1102,developers,git_users,/bin/bash,Bob Smith — Frontend Developer
carol,1103,ops_team,docker_users:deploy_team,/bin/bash,Carol Davis — DevOps Engineer
dave,1104,ops_team,deploy_team,/bin/bash,Dave Wilson — Sysadmin
eve,1105,auditors,,/sbin/nologin,Eve Martinez — Security Auditor
frank,1106,contractors,,/bin/bash,Frank Brown — Contractor (temp)
MANIFEST
        log "INFO" "CREATE_USERS" "Sample manifest written to ${manifest}"
    fi

    local created=0 skipped=0 failed=0

    while IFS=',' read -r username uid primary_group secondary_groups shell comment; do
        # Skip comments and empty lines
        [[ -z "$username" || "$username" =~ ^# ]] && continue

        username="${username// /}"    # strip accidental whitespace
        uid="${uid// /}"
        primary_group="${primary_group// /}"
        shell="${shell// /}"

        # Validate username
        if ! [[ "$username" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
            log "WARN" "CREATE_USERS" "Invalid username '${username}', skipping"
            (( failed++ )) || true
            continue
        fi

        # Skip if user already exists
        if id "$username" &>/dev/null; then
            log "DEBUG" "CREATE_USERS" "User '${username}' already exists — skipping"
            (( skipped++ )) || true
            continue
        fi

        # Build useradd arguments
        local ua_args=("-m" "-s" "${shell:-$DEFAULT_SHELL}"
                       "--skel" "$DEFAULT_SKEL"
                       "-c" "${comment:-$username}")

        [[ -n "$uid" ]]           && ua_args+=("-u" "$uid")
        [[ -n "$primary_group" ]] && ua_args+=("-g" "$primary_group")

        # Build secondary group list
        if [[ -n "$secondary_groups" ]]; then
            local sec_groups; sec_groups="${secondary_groups//:/ }"
            # Verify groups exist before assigning
            local valid_sec=()
            for g in $sec_groups; do
                if getent group "$g" &>/dev/null; then
                    valid_sec+=("$g")
                else
                    log "WARN" "CREATE_USERS" "Secondary group '${g}' does not exist — skipping for ${username}"
                fi
            done
            if (( ${#valid_sec[@]} > 0 )); then
                local joined; joined=$(IFS=','; echo "${valid_sec[*]}")
                ua_args+=("-G" "$joined")
            fi
        fi

        # Create the user
        log "INFO" "CREATE_USERS" "Creating user: ${username} (uid=${uid:-auto}, shell=${shell:-$DEFAULT_SHELL})"
        if dry useradd "${ua_args[@]}" "$username"; then
            # Lock password until admin sets it
            if ! $DRY_RUN; then
                passwd -l "$username" &>/dev/null || true
                # Set home directory permissions
                chmod 750 "${DEFAULT_HOME_BASE}/${username}" 2>/dev/null || true
            fi
            log "INFO" "CREATE_USERS" "Created user: ${username} — home=${DEFAULT_HOME_BASE}/${username} (password locked pending admin reset)"
            (( created++ )) || true
        else
            log "ERROR" "CREATE_USERS" "Failed to create user: ${username}"
            (( failed++ )) || true
        fi

    done < "$manifest"

    log "INFO" "CREATE_USERS" "User creation complete — created=${created} skipped=${skipped} failed=${failed}"
    (( failed > 0 )) && return 1 || return 0
}

# ── Standalone entry ──────────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    [[ $EUID -ne 0 ]] && { echo "Must be run as root" >&2; exit 1; }
    module_create_users
fi
