#!/usr/bin/env bash
# test_user_mgmt.sh — Enterprise User & Group Management  verification suite  v1.0.0
# Tests all modules with temporary users/groups; cleans up after itself.
# Usage: sudo bash tests/test_user_mgmt.sh [--verbose]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${SCRIPT_DIR}/config.conf"

VERBOSE=false
[[ "${1:-}" == "--verbose" ]] && VERBOSE=true

# ── Colours ───────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'

PASS=0; FAIL=0; SKIP=0
TEST_USER="test_mgmt_$$"
TEST_GROUP="test_grp_$$"
CLEANUP_USERS=()
CLEANUP_GROUPS=()

[[ $EUID -ne 0 ]] && { echo -e "${RED}Must be run as root${RESET}" >&2; exit 1; }

# ── Helpers ───────────────────────────────────────────────────────────────────
assert() {
    local desc="$1" result="$2" expected="${3:-0}"
    if [[ "$result" == "$expected" ]]; then
        echo -e "  ${GREEN}✔${RESET} ${desc}"
        (( PASS++ )) || true
    else
        echo -e "  ${RED}✘${RESET} ${desc} (got=${result} expected=${expected})"
        (( FAIL++ )) || true
    fi
}

skip() { echo -e "  ${YELLOW}⊘${RESET} $1 (skipped)"; (( SKIP++ )) || true; }

cleanup() {
    for u in "${CLEANUP_USERS[@]:-}"; do
        id "$u" &>/dev/null && userdel -r "$u" 2>/dev/null || true
    done
    for g in "${CLEANUP_GROUPS[@]:-}"; do
        getent group "$g" &>/dev/null && groupdel "$g" 2>/dev/null || true
    done
}
trap cleanup EXIT

# ── Tests ─────────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}${CYAN}Enterprise User & Group Management — Test Suite${RESET}"
echo -e "${CYAN}─────────────────────────────────────────────────${RESET}\n"

# ── Module: create_groups ────────────────────────────────────────────────────
echo -e "${BOLD}[create_groups]${RESET}"
groupadd "$TEST_GROUP" 2>/dev/null && CLEANUP_GROUPS+=("$TEST_GROUP")
assert "Test group created" "$(getent group "$TEST_GROUP" &>/dev/null; echo $?)" "0"
assert "Group exists in /etc/group" "$(grep -c "^${TEST_GROUP}:" /etc/group)" "1"

# ── Module: create_users ─────────────────────────────────────────────────────
echo -e "\n${BOLD}[create_users]${RESET}"
useradd -m -s /bin/bash -g "$TEST_GROUP" -c "Test User" "$TEST_USER" && CLEANUP_USERS+=("$TEST_USER")
assert "Test user created" "$(id "$TEST_USER" &>/dev/null; echo $?)" "0"
assert "Home directory exists" "$(test -d /home/${TEST_USER}; echo $?)" "0"
assert "Shell set correctly" "$(getent passwd "$TEST_USER" | cut -d: -f7)" "/bin/bash"
assert "Primary group correct" "$(id -gn "$TEST_USER")" "$TEST_GROUP"

# ── Module: password_aging ────────────────────────────────────────────────────
echo -e "\n${BOLD}[password_aging]${RESET}"
chage -M 90 -m 1 -W 14 -I 30 "$TEST_USER"
assert "Max password age set to 90" \
    "$(chage -l "$TEST_USER" | grep 'Maximum' | grep -c '90')" "1"
assert "Min password age set to 1" \
    "$(chage -l "$TEST_USER" | grep 'Minimum' | grep -c '1')" "1"
assert "Warning period set to 14" \
    "$(chage -l "$TEST_USER" | grep 'Warn' | grep -c '14')" "1"
assert "Inactive period set to 30" \
    "$(chage -l "$TEST_USER" | grep -i 'inactive' | grep -c '30')" "1"

# ── Module: account_locking ───────────────────────────────────────────────────
echo -e "\n${BOLD}[account_locking]${RESET}"
passwd -d "$TEST_USER" &>/dev/null  # clear to give a known state
passwd -l "$TEST_USER" &>/dev/null
assert "Account locked (passwd -l)" \
    "$(passwd -S "$TEST_USER" | awk '{print $2}')" "LK"
passwd -u "$TEST_USER" &>/dev/null
assert "Account unlocked (passwd -u)" \
    "$(passwd -S "$TEST_USER" 2>/dev/null | awk '{print $2}')" "NP"

# ── faillock check ────────────────────────────────────────────────────────────
echo -e "\n${BOLD}[faillock]${RESET}"
if [[ -f "/etc/security/faillock.conf" ]]; then
    assert "faillock.conf exists" "0" "0"
    assert "deny parameter present" \
        "$(grep -cE '^deny' /etc/security/faillock.conf || echo 0)" "1"
else
    skip "faillock.conf not found — pam_faillock not installed"
fi

# ── sudoers validation ────────────────────────────────────────────────────────
echo -e "\n${BOLD}[sudo_config]${RESET}"
if [[ -d "$SUDOERS_DIR" ]]; then
    assert "sudoers.d directory exists" "0" "0"
    local_fail=0
    for f in "${SUDOERS_DIR}"/*; do
        [[ -f "$f" ]] || continue
        visudo -c -f "$f" &>/dev/null || local_fail=1
    done
    assert "All sudoers.d fragments pass visudo syntax check" "$local_fail" "0"
else
    skip "${SUDOERS_DIR} does not exist"
fi

# ── pwquality check ───────────────────────────────────────────────────────────
echo -e "\n${BOLD}[password_policy]${RESET}"
if [[ -f "/etc/security/pwquality.conf" ]]; then
    assert "pwquality.conf exists" "0" "0"
    local_minlen=$(grep -E '^minlen' /etc/security/pwquality.conf | awk '{print $3}')
    assert "minlen applied (≥${PWQ_MINLEN})" "$(( ${local_minlen:-0} >= PWQ_MINLEN ))" "1"
else
    skip "pwquality.conf not found"
fi

# ── login.defs check ──────────────────────────────────────────────────────────
if [[ -f "/etc/login.defs" ]]; then
    local_max=$(grep -E '^PASS_MAX_DAYS' /etc/login.defs | awk '{print $2}')
    assert "PASS_MAX_DAYS applied (=${PASS_MAX_DAYS})" "$(( ${local_max:-0} == PASS_MAX_DAYS ))" "1"
else
    skip "/etc/login.defs not found"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}${CYAN}─────────────────────────────────────────────────${RESET}"
echo -e "${BOLD}Results:${RESET}  ${GREEN}PASS: ${PASS}${RESET}  ${RED}FAIL: ${FAIL}${RESET}  ${YELLOW}SKIP: ${SKIP}${RESET}"
echo ""

(( FAIL > 0 )) && exit 1 || exit 0
