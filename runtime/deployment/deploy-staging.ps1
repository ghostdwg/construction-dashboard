<#
.SYNOPSIS
    Laptop-side staging deploy orchestration (STUB — Phase R4).

.DESCRIPTION
    Validates preconditions and SSHes to superglitch to pull tagged images,
    apply staging migrations, and recreate the neuroglitch-staging Compose
    project.

    THIS IS A STUB. The script prints the actions it WOULD take and exits
    without making changes. Phase R7 implements the real body.

.PARAMETER Sha
    The full git SHA to deploy. Must be on main (or an approved branch) with
    CI green for that SHA.

.EXAMPLE
    .\deploy-staging.ps1 -Sha abc1234...

.NOTES
    Status: Phase R4 STUB. NOT ACTIVE. No SSH, no Docker, no Turso changes.
    Refusal conditions documented in runtime/deployment/compose-governance.md §4.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidatePattern('^[0-9a-f]{7,40}$')]
    [string]$Sha,

    [Parameter(Mandatory = $false)]
    [string]$SshAlias = 'superglitch'
)

Write-Output ""
Write-Output "============================================================"
Write-Output "  deploy-staging.ps1  ──  STUB (Phase R4 — NOT ACTIVE)"
Write-Output "============================================================"
Write-Output ""
Write-Output "If this script were active (Phase R7), it would perform:"
Write-Output ""
Write-Output "  1. VERIFY (laptop):"
Write-Output "      - git working tree clean"
Write-Output "      - CI green for SHA: $Sha"
Write-Output "      - SHA on main (or approved branch)"
Write-Output "      - GHCR image tags exist:"
Write-Output "          ghcr.io/ghostdwg/groundworx-app:$Sha"
Write-Output "          ghcr.io/ghostdwg/groundworx-sidecar:$Sha"
Write-Output "          ghcr.io/ghostdwg/groundworx-worker:$Sha"
Write-Output ""
Write-Output "  2. SSH to $SshAlias and execute on the host:"
Write-Output "      cd /opt/neuroglitch/construction-dashboard"
Write-Output "      git fetch && git checkout $Sha"
Write-Output "      runtime/deployment/apply-migrations.sh staging"
Write-Output "      APP_SHA=$Sha docker compose \"
Write-Output "        -f runtime/compose/base.yml \"
Write-Output "        -f runtime/compose/overrides/staging.active.yml \"
Write-Output "        -p neuroglitch-staging \"
Write-Output "        up -d --force-recreate app sidecar worker"
Write-Output ""
Write-Output "      # NOTE: staging.active.yml is the R6 activatable overlay."
Write-Output "      # staging.yml is the R3 documentation placeholder and is"
Write-Output "      # NOT used by the staging deploy path."
Write-Output ""
Write-Output "  3. HEALTH CHECK:"
Write-Output "      runtime/deployment/health-check.sh staging"
Write-Output ""
Write-Output "  4. RECORD:"
Write-Output "      Append entry to planning/ops-log-<year>.md"
Write-Output ""
Write-Output "REFUSAL CONDITIONS (would block before any SSH):"
Write-Output "  - git working tree dirty"
Write-Output "  - CI not green for SHA"
Write-Output "  - SHA not reachable from origin/main"
Write-Output "  - GHCR images missing for SHA"
Write-Output ""
Write-Output "STUB exiting without action."
Write-Output ""

# Stub returns success so calling scripts (e.g., CI dry-runs) succeed.
exit 0
