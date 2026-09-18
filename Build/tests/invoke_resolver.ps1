param(
    [Parameter(Mandatory = $true)][string] $ScriptPath,
    [Parameter(Mandatory = $true)][string] $FixturePath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$script:fixture = Get-Content -LiteralPath $FixturePath -Raw -Encoding UTF8 | ConvertFrom-Json
$script:calls = [System.Collections.Generic.List[object]]::new()
$script:messages = [System.Collections.Generic.List[string]]::new()
$script:responseIndex = 0

# Windows children must keep their working directory and caches in test scratch.
$scratch = [System.IO.Path]::GetDirectoryName($FixturePath)
Set-Location -LiteralPath $scratch
[Environment]::CurrentDirectory = $scratch
foreach ($name in @('TEMP', 'TMP', 'TMPDIR')) {
    [Environment]::SetEnvironmentVariable($name, $scratch)
}
foreach ($entry in @(Get-ChildItem Env:)) {
    if ($entry.Name -match '^(ARTIFACT_|SYSTEM_|BUILD_|RESOURCES_)') {
        [Environment]::SetEnvironmentVariable($entry.Name, $null)
    }
}
foreach ($entry in $script:fixture.environment.PSObject.Properties) {
    [Environment]::SetEnvironmentVariable($entry.Name, [string]$entry.Value)
}

function Invoke-RestMethod {
    [CmdletBinding()]
    param(
        [string] $Uri,
        [hashtable] $Headers,
        [string] $Method,
        [int] $MaximumRedirection,
        [int] $TimeoutSec
    )

    $copiedHeaders = @{}
    if ($null -ne $Headers) {
        foreach ($key in $Headers.Keys) {
            $copiedHeaders[$key] = [string]$Headers[$key]
        }
    }
    $script:calls.Add([pscustomobject]@{
        uri = $Uri
        headers = $copiedHeaders
        method = $Method
        maximumRedirection = $MaximumRedirection
        timeoutSec = $TimeoutSec
        parameters = @($PSBoundParameters.Keys)
    })
    if ($script:responseIndex -ge $script:fixture.responses.Count) {
        throw 'Unexpected metadata request; the test fixture never accesses the network.'
    }
    $response = $script:fixture.responses[$script:responseIndex]
    $script:responseIndex += 1
    if ($response.error) {
        throw [string]$response.error
    }
    return $response.response
}

function Write-Host {
    [CmdletBinding()]
    param(
        [Parameter(Position = 0, ValueFromRemainingArguments = $true)][object[]] $Object,
        [string] $Separator = ' ',
        [switch] $NoNewline,
        [ConsoleColor] $ForegroundColor,
        [ConsoleColor] $BackgroundColor
    )
    $script:messages.Add([string]::Join($Separator, [string[]]$Object))
}

$source = Get-Content -LiteralPath $ScriptPath -Raw -Encoding UTF8
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) {
    throw "The extracted PowerShell does not parse: $($parseErrors.Message -join '; ')"
}

# Reject command changes that could bypass the offline transport mock.
$allowedCommands = @(
    'Get-BuildMetadata', 'Set-ArtifactVariable', 'Select-Artifact',
    'Invoke-RestMethod', 'Write-Host', 'Where-Object', 'ForEach-Object',
    'ConvertFrom-Json', 'Select-Object'
)
$commands = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true)
foreach ($command in $commands) {
    if ($command.GetCommandName() -cnotin $allowedCommands -or
        $command.InvocationOperator -ne [System.Management.Automation.Language.TokenKind]::Unknown) {
        throw "Offline fixture needs an explicit command audit: $($command.Extent.Text)"
    }
}

$errorMessage = $null
$errorPosition = $null
try {
    # Run the whole script in a child scope, not copies of its selector functions.
    & ([scriptblock]::Create($source)) | ForEach-Object {
        $script:messages.Add([string]$_)
    }
} catch {
    $errorMessage = $_.Exception.Message
    $errorPosition = $_.InvocationInfo.PositionMessage
}

$result = [ordered]@{
    success = $null -eq $errorMessage
    error = $errorMessage
    errorPosition = $errorPosition
    messages = @($script:messages.ToArray())
    calls = @($script:calls.ToArray())
    powerShellVersion = $PSVersionTable.PSVersion.ToString()
}
[Console]::WriteLine(($result | ConvertTo-Json -Depth 100 -Compress))
