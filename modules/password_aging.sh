#!/usr/bin/env bash
# password_aging.sh — Per-user password aging via chage  v1.0.0
# Reads data/aging.csv and applies chage settings per user.
# Sourced by user_mgmt_master.sh or run standalone.
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

# ── Apply chage settings to a single user ────────────────────────────────────
_apply_aging() {
    local username="$1" max="$2" min="$3" warn="$4" inactive="$5" expire="$6"

    if ! id "$username" &>/dev/null; then
        log "WARN" "PASSWORD_AGING" "User '${username}' not found — skipping"
        return 0
    fi

    local chage_args=()
    [[ -n "$max"      && "$max"      != "-" ]] && chage_args+=("-M" "$max")
    [[ -n "$min"      && "$min"      != "-" ]] && chage_args+=("-m" "$min")
    [[ -n "$warn"     && "$warn"     != "-" ]] && chage_args+=("-W" "$warn")
    [[ -n "$inactive" && "$inactive" != "-" ]] && chage_args+=("-I" "$inactive")
    [[ -n "$expire"   && "$expire"   != "-" ]] && chage_args+=("-E" "$expire")

    if (( ${#chage_args[@]} == 0 )); then
        log "DEBUG" "PASSWORD_AGING" "No aging parameters for ${username} — skipping"
        return 0
    fi

    log "INFO" "PASSWORD_AGING" "Setting aging for ${username}: max=${max:-def} min=${min:-def} warn=${warn:-def} inactive=${inactive:-def} expire=${expire:-never}"
    dry chage "${chage_args[@]}" "$username"
    return $?
}

# ── Show current aging info for a user ───────────────────────────────────────
_show_aging() {
    local username="$1"
    log "DEBUG" "PASSWORD_AGING" "Current chage state for ${username}:"
    if $VERBOSE && ! $DRY_RUN; then
        chage -l "$username" 2>/dev/null | while IFS= read -r line; do
            log "DEBUG" "PASSWORD_AGING" "  ${line}"
        done
    fi
}

module_password_aging() {
    log "INFO" "PASSWORD_AGING" "Starting per-user password aging configuration"

    local manifest="${AGING_MANIFEST}"
    if [[ ! -f "$manifest" ]]; then
        log "WARN" "PASSWORD_AGING" "Aging manifest not found: ${manifest} — creating sample"
        mkdir -p "$(dirname "$manifest")"
        cat > "$manifest" <<'MANIFEST'
# username,max_days,min_days,warn_days,inactive_days,expire_date
# Use "-" to skip a field (keep existing/default).
# expire_date: YYYY-MM-DD or "never" or "-1" to clear expiry.
alice,90,1,14,30,-
bob,90,1,14,30,-
carol,60,1,7,14,-
dave,60,1,7,14,-
eve,365,0,30,-,-
frank,30,0,7,7,2025-12-31
MANIFEST
        log "INFO" "PASSWORD_AGING" "Sample manifest written to ${manifest}"
    fi

    local applied=0 skipped=0 failed=0

    while IFS=',' read -r username max_days min_days warn_days inactive_days expire_date; do
        [[ -z "$username" || "$username" =~ ^# ]] && continue
        username="${username// /}"
        max_days="${max_days// /}"
        min_days="${min_days// /}"
        warn_days="${warn_days// /}"
        inactive_days="${inactive_days// /}"
        expire_date="${expire_date// /}"

        if _apply_aging "$username" "$max_days" "$min_days" "$warn_days" "$inactive_days" "$expire_date"; then
            _show_aging "$username"
            (( applied++ )) || true
        else
            log "ERROR" "PASSWORD_AGING" "Failed to apply aging for ${username}"
            (( failed++ )) || true
        fi

    done < "$manifest"

    # ── Apply defaults to all non-system users not in the manifest ────────────
    log "INFO" "PASSWORD_AGING" "Applying global defaults (MAX=${PASS_MAX_DAYS} MIN=${PASS_MIN_DAYS} WARN=${PASS_WARN_AGE}) to unlisted users"

    # Build set of users already handled
    local handled_users=()
    while IFS=',' read -r u _rest; do
        [[ -z "$u" || "$u" =~ ^# ]] && continue
        handled_users+=("${u// /}")
    done < "$manifest"

    while IFS=: read -r uname _ uid _ _ _ _; do
        # Only regular users (UID ≥ 1000) not already configured
        (( uid < 1000 )) && continue
        [[ "$uname" == "nobody" ]] && continue
        local skip=false
        for h in "${handled_users[@]:-}"; do
            [[ "$h" == "$uname" ]] && skip=true && break
        done
        $skip && continue

        log "DEBUG" "PASSWORD_AGING" "Applying defaults to unlisted user: ${uname}"
        dry chage -M "$PASS_MAX_DAYS" -m "$PASS_MIN_DAYS" \
                  -W "$PASS_WARN_AGE" -I "$PASS_INACTIVE_DAYS" "$uname" \
            && (( applied++ )) || (( failed++ )) || true

    done < /etc/passwd

    log "INFO" "PASSWORD_AGING" "Password aging complete — applied=${applied} skipped=${skipped} failed=${failed}"
    (( failed > 0 )) && return 1 || return 0
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    [[ $EUID -ne 0 ]] && { echo "Must be run as root" >&2; exit 1; }
    module_password_aging
fi
