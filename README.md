# Enterprise User & Group Management

**Clearance Protocol v1.0.0** — Production-grade Bash automation for user provisioning, group management, sudo policy, password aging, and account locking on RHEL 9.

## What It Does

| Module | Command Covered | Description |
|--------|-----------------|-------------|
| `create_users.sh` | `useradd`, `usermod`, `passwd` | Bulk user creation from CSV manifest |
| `create_groups.sh` | `groupadd`, `groupmod`, `usermod -aG` | Bulk group creation + membership sync |
| `sudo_config.sh` | `visudo`, `/etc/sudoers.d/` | Write validated sudoers fragments |
| `password_policy.sh` | `pwquality.conf`, `login.defs`, `authselect` | System-wide complexity + PAM pwhistory |
| `password_aging.sh` | `chage` | Per-user aging from CSV; global defaults fallback |
| `account_locking.sh` | `faillock`, `passwd -l/u` | Brute-force protection + manual lock/unlock |
| `audit_report.sh` | — | HTML + text security audit report |

## Quick Start

```bash
# Clone
git clone https://github.com/samiulAsumel/enterprise-user-mgmt.git
cd enterprise-user-mgmt

# Edit configuration
vi config.conf

# Edit CSV manifests (sample data included)
vi data/groups.csv
vi data/users.csv
vi data/aging.csv

# Preview — no changes applied
sudo bash user_mgmt_master.sh --dry-run --verbose

# Install system-wide
sudo bash install.sh --install

# Full pipeline
sudo user-mgmt

# Single module
sudo user-mgmt --module aging
sudo user-mgmt --module report
```

## Project Structure

```
enterprise-user-mgmt/
├── user_mgmt_master.sh     # Orchestrator
├── config.conf             # All configuration
├── install.sh              # System-wide installer
├── modules/
│   ├── create_users.sh
│   ├── create_groups.sh
│   ├── sudo_config.sh
│   ├── password_policy.sh
│   ├── password_aging.sh
│   ├── account_locking.sh
│   └── audit_report.sh
├── data/
│   ├── users.csv           # User manifest
│   ├── groups.csv          # Group manifest
│   ├── aging.csv           # Per-user aging settings
│   └── locks.csv           # Manual lock/unlock actions
├── tests/
│   └── test_user_mgmt.sh   # Verification suite
└── index.html              # Web documentation
```

## CSV Manifest Formats

**data/users.csv**
```
# username,uid,primary_group,secondary_groups,shell,comment
alice,1101,developers,git_users:docker_users,/bin/bash,Alice Johnson
frank,,contractors,,/bin/bash,Frank Brown — Contractor
```

**data/groups.csv**
```
# groupname,gid,members
developers,2001,alice:bob
ops_team,2002,carol:dave
```

**data/aging.csv**
```
# username,max_days,min_days,warn_days,inactive_days,expire_date
alice,90,1,14,30,-
frank,30,0,7,7,2025-12-31
```

**data/locks.csv**
```
# username,action  (lock | unlock | reset-faillock)
frank,lock
alice,unlock
bob,reset-faillock
```

## Flags

```bash
--dry-run       Preview all actions without applying any changes
--verbose       Show DEBUG-level output
--report-only   Run audit_report module only
--module <name> Run a single module: users|groups|sudo|policy|aging|locking|report
```

## Requirements

- RHEL 9 / CentOS Stream 9 / Rocky Linux 9 / AlmaLinux 9
- `shadow-utils` — useradd, chage, passwd
- `sudo` — visudo
- `pam` — pam_pwquality, pam_faillock
- `authselect` (RHEL 9 default)
- Root or sudo access

## Logs

| Path | Contents |
|------|----------|
| `/var/log/user-mgmt/user_mgmt.log` | Structured run log |
| `/var/log/user-mgmt/cron.log` | Weekly cron output |
| `/var/log/user-mgmt/reports/` | HTML + text audit reports |
| `/var/log/secure` | Security events via syslog `authpriv` |
| `/var/log/audit/audit.log` | faillock events via Linux Audit |

## Security Notes

- `sudo_config.sh` never modifies `/etc/sudoers` directly — all fragments go to `/etc/sudoers.d/` and are validated with `visudo -c` before being installed
- New users are created with passwords locked (`passwd -l`) — admin must explicitly set passwords
- All config file modifications are backed up with a datestamp suffix before changes are applied
- `faillock` brute-force protection is enabled at the system PAM level, not just per-application

## License

MIT — free to use, modify, and adapt for your environment.
