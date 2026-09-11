# Pipeline artifact identities

Product artifacts use `<logical-name>_attempt$(System.JobAttempt)` as their
published Azure Pipelines names. The suffix belongs to the **producing job**;
retrying a consumer does not change which producer output it needs.

| Logical name | Producer | In-tree reader |
| --- | --- | --- |
| `cpptools.vsix` | `cg/cg.yml` | None (diagnostic output) |
| `vsix` | `package/jobs_package_vsix.yml` | `publish/jobs_publish_vsix.yml` |
| `unsigned_lldb-mi_<arch>` | `lldb-mi/lldb-mi.template.yml` | `lldb-mi/lldb-mi-sign.template.yml` |
| `lldb-mi_<arch>_zip` | `lldb-mi/lldb-mi-sign.template.yml` | None |

Architecture suffixes are part of the logical name. Append the attempt suffix
once, after the complete logical name. Only the remote artifact name changes;
VSIX/ZIP filenames, local directories, signing inputs, and package contents do
not include the attempt suffix.

## Resolve before downloading

[`templates/resolve_artifact.yml`](templates/resolve_artifact.yml) is a step
template with inline PowerShell, so it also works in jobs with `checkout: none`.
It reads Azure Pipelines artifact and timeline metadata using the job access
token; it does not download artifact contents.

- Supply `artifactName`, an `artifactNames` list, or `artifactNamesJson` for a
  list computed at runtime, using logical names without attempt suffixes.
- Supply an exact `buildId` and `project`, or a `definition` with an exact
  `branch` and optional `tags`. The defaults select the current build/project.
  A pipeline resource reader should pass that resource's `runID` and `projectID`.
- `allowPartiallySucceededBuilds` and `allowFailedBuilds` opt into those results
  when selecting the latest build. `allowFailedBuilds` also permits artifacts
  from failed producing jobs. `allowMissing` omits unavailable artifacts instead
  of failing; it never permits fallback to an earlier attempt.
- The default variables are `$(ResolvedArtifactName)`,
  `$(ResolvedArtifactBuildId)`, and `$(ResolvedArtifactPatterns)`. Use
  `variablePrefix` to give another prefix. `Name` is populated for a single
  selected artifact; `Patterns` contains one `<resolved-name>/**` line per
  artifact. Keep downloads pinned to the resolved build ID.
- Set `stepName` to expose `Name`, `BuildId`, and `Patterns` as job outputs.
  Release jobs resolve metadata in a preceding normal job, then map the output
  through `dependencies` to a variable in their existing typed artifact input.
  This preserves the release template's artifact and SBOM validation.

The resolver matches an artifact's `source` to the current producing timeline
job ID. `previousAttempts` connects older outputs to that job, so a retry that
publishes nothing cannot silently reuse a stale output. Historical fixed-name
artifacts are accepted only when they belong to the current producing job.

Names owned by external services or toolchains require their owning contract to
be verified before renaming; an absence of in-tree readers does not establish
that an artifact has no external consumers.

The localization pipeline's `drop` is deliberately retained pending confirmation
of its external service contract. Its local translation inputs and output
directories do not establish whether external handoff readers accept a renamed
pipeline artifact.

See [`tests`](tests/README.md) for offline resolver and artifact-contract checks.
