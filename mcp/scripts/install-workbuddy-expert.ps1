param(
  [string]$ConfigDir = $(if ($env:WORKBUDDY_CONFIG_DIR) { $env:WORKBUDDY_CONFIG_DIR } else { Join-Path $HOME '.workbuddy' }),
  [string]$StageDir = $(Join-Path (Split-Path $PSScriptRoot -Parent) '.expert-output\mathmover-builder')
)

$ErrorActionPreference = 'Stop'
$stage = (Resolve-Path -LiteralPath $StageDir).Path
$marketplace = Join-Path $ConfigDir 'plugins\marketplaces\my-experts'
$pluginsDir = Join-Path $marketplace 'plugins'
$expertName = Split-Path -Leaf $stage
$destination = Join-Path $pluginsDir $expertName
$normalizedPlugins = [IO.Path]::GetFullPath($pluginsDir).TrimEnd('\')
$normalizedDestination = [IO.Path]::GetFullPath($destination)

if (-not $normalizedDestination.StartsWith($normalizedPlugins + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to install outside the WorkBuddy experts directory: $normalizedDestination"
}
if ((Split-Path -Leaf $normalizedDestination) -ne $expertName) {
  throw "Unexpected expert directory: $normalizedDestination"
}

New-Item -ItemType Directory -Force -Path $pluginsDir | Out-Null
$backup = $null
if (Test-Path -LiteralPath $destination) {
  $backup = Join-Path $pluginsDir ('.backup-' + $expertName + '-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  Move-Item -LiteralPath $destination -Destination $backup
}

try {
  Copy-Item -LiteralPath $stage -Destination $destination -Recurse
} catch {
  if (Test-Path -LiteralPath $destination) {
    Remove-Item -LiteralPath $destination -Recurse -Force
  }
  if ($backup -and (Test-Path -LiteralPath $backup)) {
    Move-Item -LiteralPath $backup -Destination $destination
  }
  throw
}

$manifestPath = Join-Path $marketplace '.codebuddy-plugin\marketplace.json'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $manifestPath) | Out-Null
if (Test-Path -LiteralPath $manifestPath) {
  $marketplaceManifest = [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
} else {
  $marketplaceManifest = [pscustomobject]@{
    name = 'my-experts'
    description = 'my-experts marketplace (auto-generated)'
    plugins = @()
  }
}

$pluginManifest = [IO.File]::ReadAllText(
  (Join-Path $destination '.codebuddy-plugin\plugin.json'),
  [Text.Encoding]::UTF8
) | ConvertFrom-Json
$source = './plugins/' + $expertName
$plugins = @($marketplaceManifest.plugins)
$existing = $plugins | Where-Object { $_.source -eq $source -or $_.name -eq $pluginManifest.name }
if ($existing) {
  $existing.name = $pluginManifest.name
  $existing.source = $source
  $existing.description = $pluginManifest.description
} else {
  $plugins += [pscustomobject]@{
    name = $pluginManifest.name
    source = $source
    description = $pluginManifest.description
  }
}
$marketplaceManifest.plugins = $plugins
$json = $marketplaceManifest | ConvertTo-Json -Depth 20
[IO.File]::WriteAllText($manifestPath, $json, [Text.UTF8Encoding]::new($false))

if ($backup -and (Test-Path -LiteralPath $backup)) {
  Remove-Item -LiteralPath $backup -Recurse -Force
}

Write-Output "Installed $($pluginManifest.displayName.zh) at $destination"
Write-Output "Registered in $manifestPath"
