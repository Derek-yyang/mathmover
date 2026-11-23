param(
  [string]$DataDir = $(if ($env:MATHMOVER_MCP_DATA_DIR) {
    $env:MATHMOVER_MCP_DATA_DIR
  } elseif ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA 'MathMoverMCP'
  } else {
    Join-Path $HOME 'AppData\Local\MathMoverMCP'
  }),
  [string]$ConfigDir = $(if ($env:WORKBUDDY_CONFIG_DIR) {
    $env:WORKBUDDY_CONFIG_DIR
  } elseif ($env:CODEBUDDY_CONFIG_DIR) {
    $env:CODEBUDDY_CONFIG_DIR
  } else {
    Join-Path $HOME '.workbuddy'
  })
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$packageVersion = '0.1.4'
$packageUrls = @(
  "https://registry.npmjs.org/@derekk/mathmover-mcp/-/mathmover-mcp-$packageVersion.tgz",
  "https://registry.npmmirror.com/@derekk/mathmover-mcp/-/mathmover-mcp-$packageVersion.tgz"
)
$packageIntegrity = 'Y/1h55JELwvhyGE7uFfFYamB7Ra3yuwtKOJP2bD0UcxhUpqFXS9uAR19UNiiZ49XaE+nl22Q4/igWmiExiNJaA=='

$nodeVersion = '22.22.2'
$nodeArchiveRoot = "node-v$nodeVersion-win-x64"
$nodeUrls = @(
  "https://npmmirror.com/mirrors/node/v$nodeVersion/$nodeArchiveRoot.zip",
  "https://nodejs.org/dist/v$nodeVersion/$nodeArchiveRoot.zip"
)
$nodeArchiveSha256 = '7C93E9D92BF68C07182B471AA187E35EE6CD08EF0F24AB060DFFF605FCC1C57C'

$dataRoot = [IO.Path]::GetFullPath($DataDir).TrimEnd([char[]]@('\', '/'))
$configRoot = [IO.Path]::GetFullPath($ConfigDir).TrimEnd([char[]]@('\', '/'))

function Assert-ChildPath([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith($dataRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside the MathMover data directory: $full"
  }
}

function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '')
  } finally {
    $sha.Dispose()
    $stream.Dispose()
  }
}

function Get-Sha512Base64([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $sha = [Security.Cryptography.SHA512]::Create()
  try {
    return [Convert]::ToBase64String($sha.ComputeHash($stream))
  } finally {
    $sha.Dispose()
    $stream.Dispose()
  }
}

function Test-Node22([string]$Path) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
    return $false
  }
  try {
    $version = & $Path -p "process.versions.node" 2>$null
    if ($LASTEXITCODE -ne 0) {
      return $false
    }
    $major = [int]($version.Trim().Split('.')[0])
    return $major -ge 22
  } catch {
    return $false
  }
}

function Find-WorkBuddyNode {
  $explicit = @($env:WORKBUDDY_NODE, $env:CODEBUDDY_NODE) |
    Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  foreach ($candidate in $explicit) {
    if (Test-Node22 $candidate) {
      return [IO.Path]::GetFullPath($candidate)
    }
  }

  $patterns = @(
    (Join-Path $HOME '.workbuddy\binaries\node\versions\*\node.exe'),
    (Join-Path $HOME '.codebuddy\binaries\node\versions\*\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\WorkBuddy\resources\app.asar.unpacked\runtime\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\WorkBuddy\resources\runtime\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\WorkBuddy\resources\app.asar.unpacked\node.exe')
  )
  foreach ($pattern in $patterns) {
    if (-not $pattern) {
      continue
    }
    foreach ($candidate in @(Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
      if (Test-Node22 $candidate.FullName) {
        return $candidate.FullName
      }
    }
  }

  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($nodeCommand -and (Test-Node22 $nodeCommand.Source)) {
    return $nodeCommand.Source
  }

  $processNodes = Get-Process node -ErrorAction SilentlyContinue |
    ForEach-Object {
      try { $_.Path } catch { $null }
    } |
    Where-Object { $_ } |
    Sort-Object -Unique
  foreach ($candidate in $processNodes) {
    if (Test-Node22 $candidate) {
      return $candidate
    }
  }
  return $null
}

function Install-Node22 {
  $runtimeDir = Join-Path $DataDir "runtime\node-v$nodeVersion"
  $nodePath = Join-Path $runtimeDir 'node.exe'
  $markerPath = Join-Path $runtimeDir 'installed.txt'
  if ((Test-Path -LiteralPath $nodePath) -and (Test-Path -LiteralPath $markerPath)) {
    return $nodePath
  }

  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  Assert-ChildPath $nodePath
  Assert-ChildPath $markerPath
  $zipPath = Join-Path $runtimeDir "node-runtime-$PID.zip"
  Assert-ChildPath $zipPath
  $downloaded = $false
  foreach ($url in $nodeUrls) {
    try {
      [Console]::Error.WriteLine("Downloading Node $nodeVersion from $url")
      Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -TimeoutSec 600
      $actualHash = Get-Sha256 $zipPath
      if ($actualHash -ne $nodeArchiveSha256) {
        throw "Node runtime checksum mismatch: $actualHash"
      }
      $downloaded = $true
      break
    } catch {
      [Console]::Error.WriteLine($_.Exception.Message)
      if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
      }
    }
  }
  if (-not $downloaded) {
    throw 'Unable to download the verified Node 22 runtime.'
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    foreach ($entryName in @("$nodeArchiveRoot/node.exe", "$nodeArchiveRoot/LICENSE")) {
      $entry = $archive.GetEntry($entryName)
      if ($null -eq $entry) {
        throw "Node runtime archive is missing $entryName"
      }
      $targetName = Split-Path -Leaf $entryName
      $target = Join-Path $runtimeDir $targetName
      Assert-ChildPath $target
      $staging = "$target.tmp-$PID"
      Assert-ChildPath $staging
      $inputStream = $entry.Open()
      $outputStream = [IO.File]::Open($staging, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
      try {
        $inputStream.CopyTo($outputStream)
      } finally {
        $outputStream.Dispose()
        $inputStream.Dispose()
      }
      Move-Item -LiteralPath $staging -Destination $target -Force
    }
  } finally {
    $archive.Dispose()
    if (Test-Path -LiteralPath $zipPath) {
      Remove-Item -LiteralPath $zipPath -Force
    }
  }

  [IO.File]::WriteAllText(
    $markerPath,
    "version=$nodeVersion`r`nsha256=$nodeArchiveSha256`r`n",
    [Text.UTF8Encoding]::new($false)
  )
  return $nodePath
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir 'bootstrap') | Out-Null

$mutex = New-Object System.Threading.Mutex($false, 'Local\MathMoverMCPBootstrap')
$lockHeld = $false
$extractDir = Join-Path $DataDir "bootstrap\extract-$PID"
$archivePath = Join-Path $DataDir "bootstrap\mathmover-mcp-$packageVersion.tgz"
$packageRoot = Join-Path $DataDir 'package'
$versionDir = Join-Path $packageRoot "mathmover-mcp-$packageVersion"
$cliPath = Join-Path $versionDir 'dist\cli.cjs'

try {
  $lockHeld = $mutex.WaitOne([TimeSpan]::FromMinutes(5))
  if (-not $lockHeld) {
    throw 'Timed out waiting for another MathMover installation to finish.'
  }

  $nodePath = Find-WorkBuddyNode
  if (-not $nodePath) {
    $nodePath = Install-Node22
  }
  if (-not (Test-Node22 $nodePath)) {
    throw "A usable Node.js 22 runtime was not found: $nodePath"
  }

  if (-not (Test-Path -LiteralPath $cliPath)) {
    New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null
    $archiveReady = $false
    if (Test-Path -LiteralPath $archivePath) {
      try {
        $existingIntegrity = Get-Sha512Base64 $archivePath
        $archiveReady = $existingIntegrity -eq $packageIntegrity
      } catch {
        $archiveReady = $false
      }
    }
    if (-not $archiveReady) {
      if (Test-Path -LiteralPath $archivePath) {
        Assert-ChildPath $archivePath
        Remove-Item -LiteralPath $archivePath -Force
      }
      foreach ($url in $packageUrls) {
        try {
          [Console]::Error.WriteLine("Downloading MathMover MCP $packageVersion from $url")
          Invoke-WebRequest -Uri $url -OutFile $archivePath -UseBasicParsing -TimeoutSec 600
          $actualIntegrity = Get-Sha512Base64 $archivePath
          if ($actualIntegrity -ne $packageIntegrity) {
            throw "MathMover package integrity mismatch: $actualIntegrity"
          }
          $archiveReady = $true
          break
        } catch {
          [Console]::Error.WriteLine($_.Exception.Message)
          if (Test-Path -LiteralPath $archivePath) {
            Remove-Item -LiteralPath $archivePath -Force
          }
        }
      }
    }
    if (-not $archiveReady) {
      throw 'Unable to download the verified MathMover MCP package.'
    }

    Assert-ChildPath $extractDir
    if (Test-Path -LiteralPath $extractDir) {
      Remove-Item -LiteralPath $extractDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path -LiteralPath $tar)) {
      $tar = (Get-Command tar.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    }
    if (-not $tar) {
      throw 'Windows tar.exe is required to unpack the MathMover package.'
    }
    & $tar -xzf $archivePath -C $extractDir
    if ($LASTEXITCODE -ne 0) {
      throw "tar.exe failed with exit code $LASTEXITCODE"
    }
    $extractedPackage = Join-Path $extractDir 'package'
    if (-not (Test-Path -LiteralPath (Join-Path $extractedPackage 'dist\cli.cjs'))) {
      throw 'The downloaded MathMover package does not contain dist/cli.cjs.'
    }
    if (Test-Path -LiteralPath $versionDir) {
      Assert-ChildPath $versionDir
      Remove-Item -LiteralPath $versionDir -Recurse -Force
    }
    Move-Item -LiteralPath $extractedPackage -Destination $versionDir
  }

  if (-not (Test-Path -LiteralPath $cliPath)) {
    throw "MathMover CLI was not installed at $cliPath"
  }

  $env:MATHMOVER_MCP_DATA_DIR = $DataDir
  $setupOutput = & $nodePath $cliPath setup-workbuddy --config-dir $ConfigDir 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "MathMover setup-workbuddy failed: $($setupOutput -join [Environment]::NewLine)"
  }

  $configPath = Join-Path $ConfigDir 'mcp.json'
  $config = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
  $server = $config.mcpServers.mathmover
  if ($null -eq $server) {
    throw "MathMover MCP configuration is missing from $configPath"
  }
  if ([IO.Path]::GetFullPath($server.command) -ne [IO.Path]::GetFullPath($nodePath)) {
    throw "WorkBuddy MCP points to an unexpected Node executable: $($server.command)"
  }
  if (-not $server.args -or [IO.Path]::GetFullPath($server.args[0]) -ne [IO.Path]::GetFullPath($cliPath)) {
    throw "WorkBuddy MCP points to an unexpected MathMover CLI: $($server.args -join ', ')"
  }

  if (Test-Path -LiteralPath $extractDir) {
    Assert-ChildPath $extractDir
    Remove-Item -LiteralPath $extractDir -Recurse -Force
  }

  $version = & $nodePath --version
  Write-Output 'MATHMOVER_BOOTSTRAP=success'
  Write-Output "MATHMOVER_VERSION=$packageVersion"
  Write-Output "NODE=$nodePath"
  Write-Output "NODE_VERSION=$version"
  Write-Output "CLI=$cliPath"
  Write-Output "CONFIG=$configPath"
  Write-Output 'RESTART_WORKBUDDY=true'
} finally {
  if ($lockHeld) {
    $mutex.ReleaseMutex()
  }
  $mutex.Dispose()
}
