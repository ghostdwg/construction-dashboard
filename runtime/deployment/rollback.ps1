<#
.SYNOPSIS
    Laptop-side rollback to a previous tagged image (STUB — Phase R4).

.DESCRIPTION
    Rolls a tier back to a previously-deployed image SHA. Image-tag based:
    Compose pulls the prior tag and recreates without rebuilding.

    THIS IS A STUB. The script prints the actions it WOULD take and exits
    without making changes. Phase R8 implements the real body (relies on
    GHCR image tagging being live).

.PARAMETER Tier
    Either "staging" or "production".

.PARAMETER Sha
    Optional. The previous SHA to roll back to. If omitted, the script
    would look up the most recent prod-tagged SHA from git tags.

.EXAMPLE
    .\rollback.ps1 -Tier production -Sha abc1234...

.NOTES
    Status: Phase R4 STUB. NOT ACTIVE.
    Image-tag rollback requires Phase R8 (GHCR publishing) to be live.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('staging', 'production')]
    [string]$Tier,

    [Parameter(Mandatory = $false, Position = 1)]
    [ValidatePattern('^[0-9a-f]{7,40}$')]
    [string]$Sha,

    [Parameter(Mandatory = $false)]
    [string]$SshAlias = 'superglitch'
)

Write-Output ""
Write-Output "============================================================"
Write-Output "  rollback.ps1  ──  STUB (Phase R4 — NOT ACTIVE)"
Write-Output "============================================================"
Write-Output ""
Write-Output "Tier requested: $Tier"
if ($Sha) {
    Write-Output "Target SHA   : $Sha"
} else {
    Write-Output "Target SHA   : (not provided — would look up most recent prod-* tag)"
}
Write-Output ""
Write-Output "If this script were active (Phase R8), it would perform:"
Write-Output ""
Write-Output "  1. DETERMINE PREVIOUS SHA:"
Write-Output "      - if -Sha provided, use it"
Write-Output "      - else: git tag --list 'prod-*' --sort=-creatordate | head -2 | tail -1"
Write-Output "      - verify GHCR image tags exist for that SHA"
Write-Output "      - warn if SHA > 30 days old (operator must override)"
Write-Output ""
Write-Output "  2. SNAPSHOT current state (cannot roll forward without it):"
Write-Output "      ssh $SshAlias 'runtime/deployment/snapshot-prod.sh'"
Write-Output ""
Write-Output "  3. SSH to $SshAlias and execute:"
Write-Output "      cd /opt/neuroglitch/construction-dashboard"
Write-Output "      git fetch && git checkout <previous-sha>"
Write-Output "      docker compose \"
Write-Output "        -f runtime/compose/base.yml \"
Write-Output "        -f runtime/compose/overrides/$Tier.yml \"
Write-Output "        -p $(if ($Tier -eq 'production') { 'neuroglitch' } else { 'neuroglitch-staging' }) \"
Write-Output "        up -d --force-recreate app sidecar worker"
Write-Output ""
Write-Output "  4. HEALTH CHECK:"
Write-Output "      runtime/deployment/health-check.sh $Tier"
Write-Output ""
Write-Output "REFUSAL CONDITIONS:"
Write-Output "  - no previous SHA found"
Write-Output "  - previous SHA > 30 days old without --force flag"
Write-Output "  - current state cannot be snapshotted first"
Write-Output ""
Write-Output "NOTE: Rollback does NOT reverse-migrate the database. If the"
Write-Output "current deploy applied a migration, the operator must restore"
Write-Output "the snapshot taken in step 2 manually."
Write-Output ""
Write-Output "STUB exiting without action."
Write-Output ""

exit 0
