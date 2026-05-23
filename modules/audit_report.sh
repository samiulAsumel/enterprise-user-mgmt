#!/usr/bin/env bash
# audit_report.sh — Generate HTML + text user/group/security audit report  v1.0.0
# Reports on all regular users: groups, sudo access, password aging, lock status.
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

module_audit_report() {
    log "INFO" "AUDIT_REPORT" "Generating user & group audit report"

    if $DRY_RUN; then
        log "INFO" "AUDIT_REPORT" "[DRY-RUN] Would generate report at ${REPORT_DIR}"
        return 0
    fi

    mkdir -p "$REPORT_DIR"
    local ts; ts="$(date '+%Y-%m-%d %H:%M:%S')"
    local datestamp; datestamp="$(date '+%Y%m%d_%H%M%S')"
    local hostname; hostname="$(hostname -f 2>/dev/null || hostname)"

    # ── Build data ────────────────────────────────────────────────────────────
    local report_text="${REPORT_DIR}/audit_${datestamp}.txt"
    local report_html="${REPORT_DIR}/audit_${datestamp}.html"

    # Collect users
    local users_data=""
    local total_users=0 locked_users=0 sudo_users=0 expired_users=0

    while IFS=: read -r uname _ uid gid gecos home shell; do
        (( uid < 1000 )) && continue
        [[ "$uname" == "nobody" ]] && continue
        (( total_users++ )) || true

        # Groups
        local groups; groups=$(id -nG "$uname" 2>/dev/null | tr ' ' ',') || groups="unknown"

        # Sudo
        local has_sudo="No"
        if groups "$uname" 2>/dev/null | grep -qwE "wheel|sudo|sudo_admins"; then
            has_sudo="Yes (admin)"
            (( sudo_users++ )) || true
        elif sudo -l -U "$uname" 2>/dev/null | grep -q "(root)"; then
            has_sudo="Yes (restricted)"
            (( sudo_users++ )) || true
        fi

        # Password status
        local pw_status; pw_status=$(passwd -S "$uname" 2>/dev/null | awk '{print $2}') || pw_status="unknown"
        local locked_label="Active"
        if [[ "$pw_status" == "L" || "$pw_status" == "LK" ]]; then
            locked_label="LOCKED"
            (( locked_users++ )) || true
        elif [[ "$pw_status" == "NP" ]]; then
            locked_label="No Password"
        fi

        # Aging (chage)
        local max_days last_change expire_date warn_days inactive
        max_days=$(chage -l "$uname" 2>/dev/null | grep "Maximum" | awk -F': ' '{print $2}') || max_days="-"
        last_change=$(chage -l "$uname" 2>/dev/null | grep "Last password change" | awk -F': ' '{print $2}') || last_change="-"
        expire_date=$(chage -l "$uname" 2>/dev/null | grep "Account expires" | awk -F': ' '{print $2}') || expire_date="never"
        warn_days=$(chage -l "$uname" 2>/dev/null | grep "Warn" | awk -F': ' '{print $2}') || warn_days="-"

        # Check if account is expired
        if [[ "$expire_date" != "never" && "$expire_date" != "password must be changed" ]]; then
            local expire_epoch; expire_epoch=$(date -d "$expire_date" +%s 2>/dev/null) || expire_epoch=0
            local now_epoch; now_epoch=$(date +%s)
            if (( expire_epoch > 0 && expire_epoch < now_epoch )); then
                (( expired_users++ )) || true
                expire_date="⚠ EXPIRED: ${expire_date}"
            fi
        fi

        # Faillock status
        local faillock_status
        faillock_status=$(faillock --user "$uname" 2>/dev/null | grep -c "V" || echo "0")
        local fail_label
        (( faillock_status > 0 )) && fail_label="Failed: ${faillock_status}" || fail_label="Clean"

        users_data+="${uname}|${uid}|${groups}|${has_sudo}|${locked_label}|${last_change}|${max_days}|${warn_days}|${expire_date}|${fail_label}|${shell}"$'\n'
    done < /etc/passwd

    # ── Text report ───────────────────────────────────────────────────────────
    if [[ "$REPORT_FORMAT" == "text" || "$REPORT_FORMAT" == "both" ]]; then
        {
            echo "════════════════════════════════════════════════════════════════"
            echo "  ${REPORT_TITLE}"
            echo "  Host: ${hostname}   Generated: ${ts}"
            echo "════════════════════════════════════════════════════════════════"
            printf "\n  SUMMARY\n"
            printf "  Total users: %d | Locked: %d | Sudo access: %d | Expired: %d\n\n" \
                "$total_users" "$locked_users" "$sudo_users" "$expired_users"
            printf "  %-16s %-6s %-12s %-18s %-10s %-12s %-8s %s\n" \
                "USERNAME" "UID" "STATUS" "SUDO" "LAST CHG" "MAX DAYS" "WARN" "EXPIRE"
            printf "  %s\n" "$(printf '─%.0s' {1..100})"
            while IFS='|' read -r u uid g sudo st lc md wd ed fl sh; do
                [[ -z "$u" ]] && continue
                printf "  %-16s %-6s %-12s %-18s %-10s %-12s %-8s %s\n" \
                    "$u" "$uid" "$st" "$sudo" "$lc" "$md" "$wd" "$ed"
            done <<< "$users_data"
            echo ""
            echo "  Groups:"
            getent group | awk -F: '$3 >= 1000 {printf "  %-20s GID=%-6s Members: %s\n", $1, $3, $4}'
        } > "$report_text"
        log "INFO" "AUDIT_REPORT" "Text report written: ${report_text}"
    fi

    # ── HTML report ───────────────────────────────────────────────────────────
    if [[ "$REPORT_FORMAT" == "html" || "$REPORT_FORMAT" == "both" ]]; then
        {
            cat <<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${REPORT_TITLE}</title>
<style>
  body{font-family:'JetBrains Mono',monospace;background:#030712;color:#7DD3FC;margin:0;padding:24px}
  h1{color:#06B6D4;font-size:1.4rem;margin-bottom:4px}
  .meta{color:#4E7BA8;font-size:.8rem;margin-bottom:24px}
  .summary{display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap}
  .stat{background:#0E1929;border:1px solid #132234;padding:12px 20px;border-radius:8px;text-align:center}
  .stat-n{font-size:2rem;font-weight:700;color:#22D3EE}
  .stat-l{font-size:.75rem;color:#4E7BA8;text-transform:uppercase}
  table{width:100%;border-collapse:collapse;font-size:.8rem}
  th{background:#0A1220;color:#06B6D4;padding:8px 12px;text-align:left;border-bottom:2px solid #132234}
  td{padding:7px 12px;border-bottom:1px solid #0E1929}
  tr:hover td{background:#0E1929}
  .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.7rem;font-weight:600}
  .b-active{background:rgba(16,185,129,.15);color:#10B981}
  .b-locked{background:rgba(244,63,94,.15);color:#F43F5E}
  .b-nopw{background:rgba(245,158,11,.15);color:#FBBF24}
  .b-sudo{background:rgba(6,182,212,.15);color:#06B6D4}
  .b-nosudo{background:rgba(30,58,95,.4);color:#4E7BA8}
  .b-expired{background:rgba(244,63,94,.25);color:#FB7185;font-weight:700}
</style>
</head>
<body>
<h1>🔐 ${REPORT_TITLE}</h1>
<div class="meta">Host: ${hostname} &nbsp;|&nbsp; Generated: ${ts}</div>
<div class="summary">
  <div class="stat"><div class="stat-n">${total_users}</div><div class="stat-l">Total Users</div></div>
  <div class="stat"><div class="stat-n">${locked_users}</div><div class="stat-l">Locked</div></div>
  <div class="stat"><div class="stat-n">${sudo_users}</div><div class="stat-l">Sudo Access</div></div>
  <div class="stat"><div class="stat-n">${expired_users}</div><div class="stat-l">Expired</div></div>
</div>
<table>
<thead><tr><th>Username</th><th>UID</th><th>Status</th><th>Sudo</th><th>Last Change</th><th>Max Days</th><th>Warn</th><th>Expiry</th><th>Faillock</th><th>Shell</th></tr></thead>
<tbody>
HTML
            while IFS='|' read -r u uid g sudo st lc md wd ed fl sh; do
                [[ -z "$u" ]] && continue
                local st_class="b-active"
                [[ "$st" == "LOCKED" ]] && st_class="b-locked"
                [[ "$st" == "No Password" ]] && st_class="b-nopw"
                local sudo_class="b-nosudo"
                [[ "$sudo" != "No" ]] && sudo_class="b-sudo"
                local expire_class=""
                [[ "$ed" == *"EXPIRED"* ]] && expire_class=' class="b-expired"'
                echo "<tr><td><strong>${u}</strong></td><td>${uid}</td>"
                echo "<td><span class=\"badge ${st_class}\">${st}</span></td>"
                echo "<td><span class=\"badge ${sudo_class}\">${sudo}</span></td>"
                echo "<td>${lc}</td><td>${md}</td><td>${wd}</td>"
                echo "<td${expire_class}>${ed}</td><td>${fl}</td><td>${sh}</td></tr>"
            done <<< "$users_data"
            echo "</tbody></table></body></html>"
        } > "$report_html"
        log "INFO" "AUDIT_REPORT" "HTML report written: ${report_html}"
    fi

    # ── Email ─────────────────────────────────────────────────────────────────
    if [[ -n "$REPORT_EMAIL" ]] && command -v sendmail &>/dev/null; then
        log "INFO" "AUDIT_REPORT" "Sending report to ${REPORT_EMAIL}"
        {
            echo "To: ${REPORT_EMAIL}"
            echo "Subject: [user-mgmt] Audit Report — ${hostname} — ${ts}"
            echo "Content-Type: text/html"
            echo ""
            cat "$report_html"
        } | sendmail "$REPORT_EMAIL" 2>/dev/null \
            && log "INFO" "AUDIT_REPORT" "Report emailed successfully" \
            || log "WARN" "AUDIT_REPORT" "Failed to send report email"
    fi

    log "INFO" "AUDIT_REPORT" "Audit report complete — users=${total_users} locked=${locked_users} sudo=${sudo_users} expired=${expired_users}"
    return 0
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    [[ $EUID -ne 0 ]] && { echo "Must be run as root" >&2; exit 1; }
    module_audit_report
fi
