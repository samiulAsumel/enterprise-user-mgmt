#!/usr/bin/env bash
# account_locking.sh — Account locking via faillock + passwd -l  v1.0.0
# Configures /etc/security/faillock.conf for brute-force protection,
# and processes a lock/unlock manifest for manual account state changes.
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

# ── Set a value in faillock.conf ─────────────────────────────────────────────
_set_faillock_value() {
    local file="/etc/security/faillock.conf" key="$1" value="$2"
    if grep -qE "^[[:space:]]*${key}[[:space:]=]" "$file" 2>/dev/null; then
        dry sed -i "s|^[[:space:]]*${key}[[:space:]=].*|${key} = ${value}|" "$file"
    elif grep -qE "^#[[:space:]]*${key}[[:space:]=]" "$file" 2>/dev/null; then
        dry sed -i "s|^#[[:space:]]*${key}[[:space:]=].*|${key} = ${value}|" "$file"
    else
        $DRY_RUN || echo "${key} = ${value}" >> "$file"
        $DRY_RUN && echo "[DRY-RUN] Appending: ${key} = ${value} to ${file}"
    fi
}

module_account_locking() {
    log "INFO" "ACCOUNT_LOCKING" "Configuring account locking and brute-force protection"

    # ── 1. Configure /etc/security/faillock.conf ──────────────────────────────
    local faillock_conf="/etc/security/faillock.conf"
    if [[ ! -f "$faillock_conf" ]]; then
        log "WARN" "ACCOUNT_LOCKING" "${faillock_conf} not found — pam_faillock may not be installed"
    else
        if ! $DRY_RUN; then
            cp "$faillock_conf" "${faillock_conf}.bak.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
        fi

        log "INFO" "ACCOUNT_LOCKING" "Configuring faillock: deny=${FAILLOCK_DENY} fail_interval=${FAILLOCK_FAIL_INTERVAL}s unlock_time=${FAILLOCK_UNLOCK_TIME}s"

        _set_faillock_value "deny"           "$FAILLOCK_DENY"
        _set_faillock_value "fail_interval"  "$FAILLOCK_FAIL_INTERVAL"
        _set_faillock_value "unlock_time"    "$FAILLOCK_UNLOCK_TIME"
        $FAILLOCK_AUDIT        && _set_faillock_value "audit"           ""
        $FAILLOCK_SILENT       && _set_faillock_value "silent"          ""
        $FAILLOCK_NO_LOG_INFO  && _set_faillock_value "no_log_info"     ""
        $FAILLOCK_EVEN_DENY_ROOT && _set_faillock_value "even_deny_root"  ""
        if $FAILLOCK_EVEN_DENY_ROOT; then
            _set_faillock_value "root_unlock_time" "$FAILLOCK_ROOT_UNLOCK_TIME"
        fi

        # Ensure PAM includes pam_faillock via authselect
        if command -v authselect &>/dev/null; then
            if $DRY_RUN; then
                echo "[DRY-RUN] authselect enable-feature with-faillock"
            else
                authselect enable-feature with-faillock 2>/dev/null \
                    || log "WARN" "ACCOUNT_LOCKING" "authselect with-faillock feature may already be active"
                log "INFO" "ACCOUNT_LOCKING" "authselect: with-faillock feature enabled"
            fi
        else
            log "WARN" "ACCOUNT_LOCKING" "authselect not available — manually verify PAM pam_faillock in /etc/pam.d/"
        fi
    fi

    # ── 2. Process manual lock/unlock manifest ────────────────────────────────
    local lock_manifest="${LOCK_MANIFEST}"
    if [[ ! -f "$lock_manifest" ]]; then
        log "WARN" "ACCOUNT_LOCKING" "Lock manifest not found: ${lock_manifest} — creating sample"
        mkdir -p "$(dirname "$lock_manifest")"
        cat > "$lock_manifest" <<'MANIFEST'
# username,action
# action: lock | unlock | reset-faillock
# lock   — disables the account password (passwd -l); user cannot log in
# unlock — re-enables the account password (passwd -u)
# reset-faillock — clears faillock counters (faillock --user <name> --reset)
# frank,lock
# alice,unlock
# bob,reset-faillock
MANIFEST
        log "INFO" "ACCOUNT_LOCKING" "Sample lock manifest written to ${lock_manifest}"
        return 0
    fi

    local locked=0 unlocked=0 reset=0 failed=0

    while IFS=',' read -r username action; do
        [[ -z "$username" || "$username" =~ ^# ]] && continue
        username="${username// /}"
        action="${action// /}"

        if ! id "$username" &>/dev/null; then
            log "WARN" "ACCOUNT_LOCKING" "User '${username}' not found — skipping ${action}"
            (( failed++ )) || true
            continue
        fi

        case "$action" in
            lock)
                log "INFO" "ACCOUNT_LOCKING" "Locking account: ${username}"
                if dry passwd -l "$username"; then
                    log "INFO" "ACCOUNT_LOCKING" "Account locked: ${username}"
                    # Log to syslog as security event
                    $DRY_RUN || logger -p authpriv.notice -t "user-mgmt" "Account locked by enterprise-user-mgmt: ${username}"
                    (( locked++ )) || true
                else
                    log "ERROR" "ACCOUNT_LOCKING" "Failed to lock: ${username}"
                    (( failed++ )) || true
                fi
                ;;
            unlock)
                log "INFO" "ACCOUNT_LOCKING" "Unlocking account: ${username}"
                if dry passwd -u "$username"; then
                    # Also reset any faillock entries
                    dry faillock --user "$username" --reset 2>/dev/null || true
                    log "INFO" "ACCOUNT_LOCKING" "Account unlocked: ${username}"
                    $DRY_RUN || logger -p authpriv.notice -t "user-mgmt" "Account unlocked by enterprise-user-mgmt: ${username}"
                    (( unlocked++ )) || true
                else
                    log "ERROR" "ACCOUNT_LOCKING" "Failed to unlock: ${username}"
                    (( failed++ )) || true
                fi
                ;;
            reset-faillock)
                log "INFO" "ACCOUNT_LOCKING" "Resetting faillock counters for: ${username}"
                if dry faillock --user "$username" --reset; then
                    log "INFO" "ACCOUNT_LOCKING" "Faillock reset: ${username}"
                    (( reset++ )) || true
                else
                    log "ERROR" "ACCOUNT_LOCKING" "Failed to reset faillock for: ${username}"
                    (( failed++ )) || true
                fi
                ;;
            *)
                log "WARN" "ACCOUNT_LOCKING" "Unknown action '${action}' for ${username} — use lock|unlock|reset-faillock"
                (( failed++ )) || true
                ;;
        esac

    done < "$lock_manifest"

    # ── 3. Report current locked accounts ────────────────────────────────────
    if $VERBOSE && ! $DRY_RUN; then
        log "INFO" "ACCOUNT_LOCKING" "Currently locked accounts:"
        while IFS=: read -r uname _ uid _ _ _ _; do
            (( uid < 1000 )) && continue
            [[ "$uname" == "nobody" ]] && continue
            local shadow_status
            shadow_status=$(passwd -S "$uname" 2>/dev/null | awk '{print $2}') || true
            if [[ "$shadow_status" == "L" || "$shadow_status" == "LK" ]]; then
                log "INFO" "ACCOUNT_LOCKING" "  LOCKED: ${uname}"
            fi
        done < /etc/passwd
    fi

    log "INFO" "ACCOUNT_LOCKING" "Account locking complete — locked=${locked} unlocked=${unlocked} faillock_reset=${reset} failed=${failed}"
    (( failed > 0 )) && return 1 || return 0
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    [[ $EUID -ne 0 ]] && { echo "Must be run as root" >&2; exit 1; }
    module_account_locking
fi
