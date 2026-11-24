# Pipeline artifact tests

## Resolver behavior

Run from the repository root:

```sh
python3 -B Build/tests/test_resolve_artifact.py -v
```

The runner needs Python 3.8+ and PowerShell 7 (`pwsh` or `pwsh.exe`), or Windows
PowerShell 5.1 selected with the `PWSH` environment variable. It requires no
Python packages, PowerShell modules, credentials, or network access. For example:

```sh
PWSH='/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' python3 -B Build/tests/test_resolve_artifact.py -v
```

On Windows, use `py -3` in place of `python3`. Windows executables invoked from
WSL receive paths translated by `wslpath`; scratch files and module caches stay
in disposable directories beside the tests. Profiles and prompts are disabled.

The suite extracts and runs the entire current inline PowerShell block from
`../templates/resolve_artifact.yml`, including its YAML parameter defaults and
environment bindings. `invoke_resolver.ps1` supplies offline artifact/timeline
metadata and records every REST request and pipeline-variable output. It tests
producer versus consumer retries, matrix shards, stale output rejection,
malformed metadata, fixed-name historical runs, exact resource pins, partial
artifact sets, and branch/tag/result filters. The fake token must never appear
in URLs or emitted messages. Unexpected requests do not reach the network.

The suite reports the PowerShell version, invocation count, and resolver hash.
It fails if the resolver changes during a run or if PowerShell is unavailable.
It does not simulate Azure's publishing service or execute a pipeline.

## YAML artifact contracts

These checks additionally require PyYAML 6:

```sh
python3 -B Build/tests/test_pipeline_artifacts.py -v
```

They cover duplicate YAML keys, producer-attempt naming, distinct retry names,
reader/resolver wiring, and the exact exceptions documented in
`artifact-name-exceptions.json`. Unused exemptions fail. For an isolated baseline
comparison, `PIPELINE_ARTIFACT_ROOT` may point to another copy of the `Build`
YAML tree.
