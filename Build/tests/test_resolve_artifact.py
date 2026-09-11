"""Offline tests of the complete inline PowerShell in resolve_artifact.yml."""

import copy
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit
import uuid


HERE = Path(__file__).resolve().parent
TEMPLATE_PATH = HERE.parent / "templates" / "resolve_artifact.yml"
WRAPPER_PATH = HERE / "invoke_resolver.ps1"
COLLECTION = "https://dev.azure.com/example-labs/"
PROJECT = "Toolchain SDK"
BUILD_ID = 314159
BASE = "compiler.bundle"
SYMBOLS = "compiler.symbols"
TOKEN = "offline-fixture-token-%25+?&="
PARAMETER_TYPES = {
    "artifactName": "string",
    "artifactNames": "object",
    "artifactNamesJson": "string",
    "buildId": "string",
    "project": "string",
    "definition": "string",
    "branch": "string",
    "tags": "string",
    "allowPartiallySucceededBuilds": "boolean",
    "allowFailedBuilds": "boolean",
    "allowMissing": "boolean",
    "variablePrefix": "string",
    "stepName": "string",
}
ENVIRONMENT_BINDINGS = {
    "SYSTEM_ACCESSTOKEN": "$(System.AccessToken)",
    "ARTIFACT_NAME": "${{ parameters.artifactName }}",
    "ARTIFACT_NAMES": "${{ convertToJson(parameters.artifactNames) }}",
    "ARTIFACT_NAMES_JSON": "${{ parameters.artifactNamesJson }}",
    "ARTIFACT_BUILD_ID": "${{ parameters.buildId }}",
    "ARTIFACT_PROJECT": "${{ parameters.project }}",
    "ARTIFACT_DEFINITION": "${{ parameters.definition }}",
    "ARTIFACT_BRANCH": "${{ parameters.branch }}",
    "ARTIFACT_TAGS": "${{ parameters.tags }}",
    "ARTIFACT_ALLOW_PARTIAL": "${{ parameters.allowPartiallySucceededBuilds }}",
    "ARTIFACT_ALLOW_FAILED": "${{ parameters.allowFailedBuilds }}",
    "ARTIFACT_ALLOW_MISSING": "${{ parameters.allowMissing }}",
    "ARTIFACT_VARIABLE_PREFIX": "${{ parameters.variablePrefix }}",
    "ARTIFACT_STEP_NAME": "${{ parameters.stepName }}",
}


@dataclass
class Template:
    script: str
    defaults: dict
    bindings: dict
    digest: str


def extract_template(text):
    """Accept only this template's small, explicit YAML grammar; never guess."""
    if "\t" in text:
        raise ValueError("Tabs are not supported in the resolver template")
    lines = text.splitlines()
    steps = [index for index, line in enumerate(lines) if line == "steps:"]
    if len(steps) != 1:
        raise ValueError("Expected exactly one unindented steps section")
    step = steps[0]
    header = [line for line in lines[:step] if line.strip() and not line.lstrip().startswith("#")]
    if not header or header[0] != "parameters:" or (len(header) - 1) % 3:
        raise ValueError("Unsupported parameter layout")
    defaults = {}
    for index in range(1, len(header), 3):
        name_match = re.fullmatch(r"- name: ([A-Za-z][A-Za-z0-9]*)", header[index])
        type_match = re.fullmatch(r"  type: (string|boolean|object)", header[index + 1])
        default_match = re.fullmatch(r"  default: (.+)", header[index + 2])
        if not (name_match and type_match and default_match):
            raise ValueError("Unsupported parameter declaration")
        name, kind, value = name_match[1], type_match[1], default_match[1]
        if name in defaults or PARAMETER_TYPES.get(name) != kind:
            raise ValueError("Unknown, duplicate, or incorrectly typed parameter: " + name)
        if kind == "string" and re.fullmatch(r"'(?:[^']|'')*'", value):
            value = value[1:-1].replace("''", "'")
        elif kind == "string" and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value):
            pass
        elif kind == "boolean" and value in {"true", "false"}:
            value = value == "true"
        elif kind == "object" and value == "[]":
            value = []
        else:
            raise ValueError("Unsupported parameter default: " + name)
        defaults[name] = value
    if defaults.keys() != PARAMETER_TYPES.keys():
        raise ValueError("The resolver parameter set changed")
    if lines[step + 1:step + 2] != ["- powershell: |"]:
        raise ValueError("Expected one powershell block using literal | with default chomping")
    body = []
    index = step + 2
    while index < len(lines) and (not lines[index].strip() or lines[index].startswith("    ")):
        line = lines[index]
        if not body and line.strip() and (len(line) - len(line.lstrip()) != 4):
            raise ValueError("PowerShell block indentation must be exactly four spaces")
        body.append(line[4:] if line.strip() else "")
        index += 1
    while body and not body[-1].strip():
        body.pop()
    if not body or not body[0].strip():
        raise ValueError("Expected a nonempty PowerShell block with explicit indentation")
    tail = lines[index:]
    while tail and not tail[-1].strip():
        tail.pop()
    if len(tail) < 4 or not re.fullmatch(r"  displayName: '(?:[^']|'')*'", tail[0]):
        raise ValueError("Unsupported step metadata after the PowerShell block")
    if tail[1:4] != [
        "  ${{ if ne(parameters.stepName, '') }}:",
        "    name: ${{ parameters.stepName }}",
        "  env:",
    ]:
        raise ValueError("Expected the named-output condition followed by env")
    bindings = {}
    for line in tail[4:]:
        match = re.fullmatch(r"    ([A-Z_]+): (.+)", line)
        if not match or match[1] in bindings:
            raise ValueError("Unsupported or duplicate environment declaration")
        bindings[match[1]] = match[2]
    if bindings != ENVIRONMENT_BINDINGS:
        raise ValueError("Resolver environment bindings changed; audit the fixture wiring")
    script = "\n".join(body) + "\n"
    return Template(script, defaults, bindings, hashlib.sha256(text.encode("utf-8")).hexdigest())


def read_template():
    return extract_template(TEMPLATE_PATH.read_text(encoding="utf-8"))


def render_environment(template, parameters=None, macros=None):
    """Expand only the parameter and macro forms declared in the checked YAML."""
    values = copy.deepcopy(template.defaults)
    parameters = parameters or {}
    if parameters.keys() - values.keys():
        raise ValueError("Unknown template parameter in fixture")
    values.update(parameters)
    system = {
        "System.AccessToken": TOKEN,
        "System.CollectionUri": COLLECTION,
        "System.TeamProjectId": PROJECT,
        "System.JobAttempt": "1",
        "Build.BuildId": str(BUILD_ID),
    }
    system.update(macros or {})
    environment = {
        "SYSTEM_COLLECTIONURI": system["System.CollectionUri"],
        "SYSTEM_JOBATTEMPT": system["System.JobAttempt"],
        "BUILD_BUILDID": system["Build.BuildId"],
    }
    for name, expression in template.bindings.items():
        parameter = re.fullmatch(r"\$\{\{ parameters\.([A-Za-z0-9]+) \}\}", expression)
        if parameter:
            value = values[parameter[1]]
            value = str(value).lower() if isinstance(value, bool) else str(value)
        elif expression == "${{ convertToJson(parameters.artifactNames) }}":
            value = json.dumps(values["artifactNames"])
        elif expression == "$(System.AccessToken)":
            value = system["System.AccessToken"]
        else:
            raise ValueError("Unsupported environment expression")
        environment[name] = re.sub(r"\$\(([A-Za-z0-9_.-]+)\)", lambda match: system.get(match[1], match[0]), value)
    return environment


def identifier(label):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "https://fixtures.invalid/" + label))


def api_url(path, query=None, collection=COLLECTION, project=PROJECT):
    base = collection.rstrip("/") + "/" + quote(project, safe="") + "/_apis/build/"
    return base + path + "?" + urlencode(query or {"api-version": "7.1"}, quote_via=quote)


def artifact(name, producer="producer", build=BUILD_ID):
    return {
        "id": uuid.UUID(identifier(name)).int % 1000000 + 1,
        "name": name,
        "source": identifier(producer),
        "resource": {
            "type": "PipelineArtifact",
            "data": "1234567890abcdef" * 4,
            "url": api_url("builds/{}/artifacts".format(build), {"artifactName": name, "api-version": "7.1"}),
            "downloadUrl": "https://downloads.invalid/{}/{}?format=zip".format(build, quote(name, safe="")),
            "properties": {"RootId": "0123456789abcdef" * 4, "artifactsize": "2048"},
        },
    }


def job(label="producer", attempt=1, previous=(), result="succeeded", state="completed", shard="linux-x64"):
    return {
        "id": identifier(label),
        "parentId": identifier("stage"),
        "type": "Job",
        "name": "Build toolchain",
        "identifier": "Build.Toolchain." + shard,
        "order": 2,
        "startTime": "2026-01-02T03:04:05Z",
        "finishTime": "2026-01-02T03:14:05Z" if state == "completed" else None,
        "currentOperation": None,
        "percentComplete": 100 if state == "completed" else 50,
        "state": state,
        "result": result,
        "resultCode": None,
        "changeId": 12,
        "lastModified": "2026-01-02T03:14:05Z",
        "workerName": "fixture-worker",
        "details": None,
        "errorCount": 1 if result == "failed" else 0,
        "warningCount": 0,
        "url": None,
        "log": {"id": 4, "type": "Container", "url": api_url("builds/{}/logs/4".format(BUILD_ID))},
        "task": None,
        "attempt": attempt,
        "previousAttempts": [
            {"attempt": number, "recordId": identifier(old), "timelineId": identifier("timeline-" + old)}
            for old, number in previous
        ],
        "issues": [],
    }


def timeline(records, build=BUILD_ID, collection=COLLECTION, project=PROJECT):
    stage = job("stage")
    stage.update(type="Stage", parentId=None, identifier="Build", name="Build")
    task = job("publish-task")
    task.update(type="Task", parentId=identifier("producer"), name="Publish pipeline artifact", identifier=None)
    task["task"] = {"id": identifier("publish-task-definition"), "name": "PublishPipelineArtifact", "version": "1.0.0"}
    records = [stage, task] + copy.deepcopy(records)
    for record in records:
        if record.get("log"):
            record["log"]["url"] = api_url(
                "builds/{}/logs/{}".format(build, record["log"]["id"]), collection=collection, project=project,
            )
    return {
        "id": identifier("timeline"),
        "changeId": 13,
        "lastChangedBy": identifier("service"),
        "lastChangedOn": "2026-01-02T03:14:05Z",
        "url": api_url("builds/{}/timeline".format(build), collection=collection, project=project),
        "records": records,
    }


def build_record(build=BUILD_ID, definition=73, branch="refs/heads/release/tools", tags=None, result="succeeded"):
    return {
        "id": build,
        "buildNumber": "20260102.1",
        "status": "completed",
        "result": result,
        "queueTime": "2026-01-02T03:00:00Z",
        "startTime": "2026-01-02T03:04:05Z",
        "finishTime": "2026-01-02T03:14:05Z",
        "sourceBranch": branch,
        "sourceVersion": "abcdef0123456789" * 2 + "abcdef01",
        "definition": {"id": definition, "name": "Toolchain producer", "type": "build"},
        "project": {"id": identifier("project"), "name": PROJECT},
        "repository": {"id": identifier("repository"), "type": "TfsGit", "name": "tools"},
        "tags": tags or [],
        "url": api_url("builds/{}".format(build)),
    }


def metadata_responses(artifacts, jobs, build=BUILD_ID, collection=COLLECTION, project=PROJECT):
    artifacts = copy.deepcopy(artifacts)
    for item in artifacts:
        item["resource"]["url"] = api_url(
            "builds/{}/artifacts".format(build), {"artifactName": item["name"], "api-version": "7.1"},
            collection=collection, project=project,
        )
        item["resource"]["downloadUrl"] = "https://downloads.invalid/{}/{}?format=zip".format(build, quote(item["name"], safe=""))
    return [
        {"uri": api_url("builds/{}/artifacts".format(build), collection=collection, project=project),
         "response": {"count": len(artifacts), "value": artifacts}},
        {"uri": api_url("builds/{}/timeline".format(build), collection=collection, project=project),
         "response": timeline(jobs, build, collection, project)},
    ]


def powershell_executable():
    executable = os.environ.get("PWSH") or shutil.which("pwsh") or shutil.which("pwsh.exe")
    if not executable:
        raise RuntimeError("PowerShell 7 is required: install pwsh, or set PWSH to its executable path")
    return executable


def host_path(path, executable):
    if sys.platform.startswith("linux") and str(executable).lower().endswith(".exe"):
        wslpath = shutil.which("wslpath")
        if not wslpath:
            raise RuntimeError("Windows PowerShell from Linux requires WSL and wslpath")
        return subprocess.run([wslpath, "-w", str(path)], check=True, capture_output=True, text=True, timeout=10).stdout.strip()
    return str(path)


def invoke_powershell(template, environment, responses, executable):
    with tempfile.TemporaryDirectory(prefix=".resolver-tests-", dir=HERE) as scratch_name:
        scratch = Path(scratch_name)
        script_path = scratch / "actual inline resolver.ps1"
        fixture_path = scratch / "metadata fixture.json"
        script_path.write_text(template.script, encoding="utf-8")
        fixture_path.write_text(json.dumps({"environment": environment, "responses": responses}), encoding="utf-8")
        child_env = os.environ.copy()
        scratch_host = host_path(scratch, executable)
        settings = {
            "TEMP": scratch_host, "TMP": scratch_host, "TMPDIR": scratch_host,
            "POWERSHELL_TELEMETRY_OPTOUT": "1",
            "PSModuleAnalysisCachePath": host_path(scratch / "module-cache", executable),
        }
        child_env.update(settings)
        if sys.platform.startswith("linux") and str(executable).lower().endswith(".exe"):
            inherited = [entry for entry in child_env.get("WSLENV", "").split(":") if entry and entry.split("/")[0] not in settings]
            child_env["WSLENV"] = ":".join(inherited + list(settings))
        command = [
            executable, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
            "-File", host_path(WRAPPER_PATH, executable),
            "-ScriptPath", host_path(script_path, executable),
            "-FixturePath", host_path(fixture_path, executable),
        ]
        process = subprocess.run(command, cwd=scratch, env=child_env, capture_output=True, text=True, encoding="utf-8", timeout=45)
        if process.returncode or process.stderr.strip():
            raise AssertionError("PowerShell fixture failed (exit {}):\n{}\n{}".format(process.returncode, process.stdout, process.stderr))
        try:
            return json.loads(process.stdout)
        except json.JSONDecodeError as error:
            raise AssertionError("PowerShell fixture did not return JSON: " + process.stdout) from error


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.text = TEMPLATE_PATH.read_text(encoding="utf-8")

    def test_extracts_complete_inline_script(self):
        template = extract_template(self.text)
        self.assertTrue(template.script.startswith("$ErrorActionPreference = 'Stop'\n"))
        self.assertIn("function Select-Artifact", template.script)
        self.assertIn("$collection = [uri]$env:SYSTEM_COLLECTIONURI", template.script)
        self.assertIn("Set-ArtifactVariable 'Name'", template.script)
        indented = "\n".join("    " + line if line else "" for line in template.script.splitlines())
        actual = self.text.split("- powershell: |\n", 1)[1].split("  displayName:", 1)[0]
        self.assertEqual(indented.rstrip(), actual.rstrip())

    def test_accepts_crlf_without_changing_script(self):
        self.assertEqual(extract_template(self.text.replace("\n", "\r\n")).script, extract_template(self.text).script)

    def test_rejects_other_block_styles(self):
        for header in ["- powershell: >", "- powershell: |-", "- powershell: |4", "- pwsh: |", "  - powershell: |"]:
            with self.subTest(header=header), self.assertRaises(ValueError):
                extract_template(self.text.replace("- powershell: |", header, 1))

    def test_rejects_second_step_or_section(self):
        for suffix in ["\n- powershell: |\n    Write-Host unsafe\n", "\nsteps:\n- powershell: |\n    Write-Host unsafe\n"]:
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                extract_template(self.text + suffix)

    def test_rejects_ambiguous_indentation(self):
        for spaces in ["  ", "      ", "\t"]:
            with self.subTest(spaces=spaces), self.assertRaises(ValueError):
                extract_template(self.text.replace("    $ErrorActionPreference", spaces + "$ErrorActionPreference", 1))

    def test_rejects_missing_or_rewired_environment(self):
        line = "    ARTIFACT_BUILD_ID: ${{ parameters.buildId }}"
        for replacement in ["", "    ARTIFACT_BUILD_ID: ${{ parameters.definition }}", line + "\n" + line]:
            with self.subTest(replacement=replacement), self.assertRaises(ValueError):
                extract_template(self.text.replace(line, replacement, 1))

    def test_rejects_unexpected_yaml(self):
        for before, after in [
            ("parameters:", "parameters: &defaults"),
            ("- name: buildId", "- name: unknownParameter"),
            ("  type: string", "  type: object"),
            ("  env:", "  pwsh: true\n  env:"),
            ("    name: ${{ parameters.stepName }}", "    name: differentName"),
        ]:
            with self.subTest(after=after), self.assertRaises(ValueError):
                extract_template(self.text.replace(before, after, 1))

    def test_environment_comes_from_template_parameters_and_macros(self):
        environment = render_environment(read_template(), {
            "artifactNames": [BASE, SYMBOLS], "buildId": "$(resources.pipeline.tools.runID)",
            "allowMissing": True, "stepName": "selectTools", "variablePrefix": "Tools_",
        }, {"resources.pipeline.tools.runID": "98765"})
        self.assertEqual(environment["ARTIFACT_BUILD_ID"], "98765")
        self.assertEqual(environment["ARTIFACT_ALLOW_MISSING"], "true")
        self.assertEqual(environment["ARTIFACT_STEP_NAME"], "selectTools")
        self.assertEqual(environment["ARTIFACT_VARIABLE_PREFIX"], "Tools_")
        self.assertEqual(json.loads(environment["ARTIFACT_NAMES"]), [BASE, SYMBOLS])


class ResolverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.executable = powershell_executable()
        cls.digests = set()
        cls.versions = set()
        cls.invocations = 0

    @classmethod
    def tearDownClass(cls):
        current = read_template().digest
        print("\nResolver fixture: {} PowerShell invocations; versions {}; YAML SHA-256 {}".format(
            cls.invocations, ", ".join(sorted(cls.versions)), ", ".join(sorted(cls.digests))), file=sys.stderr)
        if cls.digests and cls.digests != {current}:
            raise AssertionError("The resolver changed during this run; rerun the suite against a stable on-disk version")

    def run_resolver(self, artifacts=None, jobs=None, parameters=None, macros=None, environment=None,
                     responses=None, build=BUILD_ID, call_counts=None):
        template = read_template()
        self.digests.add(template.digest)
        params = {"artifactName": BASE}
        params.update(parameters or {})
        env = render_environment(template, params, macros)
        env.update(environment or {})
        if responses is None:
            responses = metadata_responses(
                artifacts if artifacts is not None else [artifact(BASE + "_attempt1")],
                jobs if jobs is not None else [job()], build,
                collection=env["SYSTEM_COLLECTIONURI"], project=env["ARTIFACT_PROJECT"],
            )
        result = invoke_powershell(template, env, responses, self.executable)
        type(self).invocations += 1
        self.versions.add(result["powerShellVersion"])
        message = "Resolver result: " + json.dumps(result, indent=2)
        self.assertIn(len(result["calls"]), call_counts if call_counts is not None else {len(responses)}, message)
        for call, expected in zip(result["calls"], responses):
            with self.subTest(uri=call["uri"]):
                actual_uri, expected_uri = urlsplit(call["uri"]), urlsplit(expected["uri"])
                self.assertEqual(actual_uri._replace(query=""), expected_uri._replace(query=""), message)
                self.assertEqual(parse_qs(actual_uri.query, keep_blank_values=True), parse_qs(expected_uri.query, keep_blank_values=True), message)
                self.assertEqual(call["method"].lower(), "get")
                self.assertIn("MaximumRedirection", call["parameters"])
                self.assertEqual(call["maximumRedirection"], 0)
                self.assertIn("TimeoutSec", call["parameters"])
                self.assertEqual(call["timeoutSec"], 60)
                self.assertEqual(call["headers"], {"Authorization": "Bearer " + env["SYSTEM_ACCESSTOKEN"]})
                self.assertNotIn(TOKEN, call["uri"])
                self.assertNotIn(TOKEN, unquote(call["uri"]))
                self.assertNotIn("downloads.invalid", call["uri"])
        self.assertNotIn(TOKEN, "\n".join(result["messages"]) + str(result["error"]))
        return result

    def assert_selected(self, result, names, build=BUILD_ID, requested_count=1, prefix="ResolvedArtifact", outputs=False):
        self.assertTrue(result["success"], json.dumps(result, indent=2))
        values = [
            ("BuildId", str(build)),
            ("Patterns", "\n".join(name + "/**" for name in names)),
            ("Name", names[0] if requested_count == 1 and len(names) == 1 else ""),
        ]
        expected = []
        for name, value in values:
            escaped = value.replace("%", "%AZP25").replace("\r", "%0D").replace("\n", "%0A")
            expected.append("##vso[task.setvariable variable={}]{}".format(prefix + name, escaped))
            if outputs:
                expected.append("##vso[task.setvariable variable={};isOutput=true]{}".format(name, escaped))
        commands = [line for line in result["messages"] if line.startswith("##vso[")]
        self.assertEqual(commands, expected)
        self.assertTrue(all("\n" not in line and "\r" not in line for line in commands))

    def assert_rejected(self, result, error=None):
        self.assertFalse(result["success"], json.dumps(result, indent=2))
        self.assertTrue(result["error"])
        if error:
            self.assertRegex(result["error"], error)
        self.assertFalse(any(line.startswith("##vso[") for line in result["messages"]), result["messages"])

    def retry_fixture(self, publish_current=True, result="succeeded"):
        artifacts = [artifact(BASE + "_attempt1", "old-producer")]
        if publish_current:
            artifacts.append(artifact(BASE + "_attempt2"))
        return artifacts, [job(attempt=2, previous=[("old-producer", 1)], result=result)]

    def test_producer_attempt_two_consumer_attempt_one(self):
        artifacts, jobs = self.retry_fixture()
        jobs.append(job("consumer", state="inProgress", result=None, shard="download"))
        self.assert_selected(self.run_resolver(artifacts, jobs), [BASE + "_attempt2"])

    def test_consumer_only_retry_keeps_producer_attempt_one(self):
        jobs = [job(), job("consumer", attempt=8, state="inProgress", result=None, shard="download")]
        result = self.run_resolver(jobs=jobs, macros={"System.JobAttempt": "8"})
        self.assert_selected(result, [BASE + "_attempt1"])

    def test_attempt_ten_is_numeric_not_lexicographic(self):
        artifacts = [artifact(BASE + "_attempt{}".format(attempt), "attempt-{}".format(attempt)) for attempt in (9, 10, 2)]
        jobs = [job("attempt-10", attempt=10, previous=[("attempt-2", 2), ("attempt-9", 9)])]
        self.assert_selected(self.run_resolver(artifacts, jobs), [BASE + "_attempt10"])

    def test_old_failed_artifact_remains_without_poisoning_successful_retry(self):
        artifacts, jobs = self.retry_fixture()
        jobs.insert(0, job("old-producer", result="failed"))
        self.assert_selected(self.run_resolver(artifacts, jobs), [BASE + "_attempt2"])

    def test_newer_failed_producer_rejects_stale_fallback(self):
        for published in [False, True]:
            with self.subTest(current_published=published):
                artifacts, jobs = self.retry_fixture(published, "failed")
                self.assert_rejected(self.run_resolver(artifacts, jobs), "No usable artifact")

    def test_newer_successful_producer_missing_output_rejects_stale_fallback(self):
        artifacts, jobs = self.retry_fixture(False)
        self.assert_rejected(self.run_resolver(artifacts, jobs), "No usable artifact")

    def test_allow_failed_selects_only_current_failed_output(self):
        artifacts, jobs = self.retry_fixture(True, "failed")
        self.assert_selected(self.run_resolver(artifacts, jobs, {"allowFailedBuilds": True}), [BASE + "_attempt2"])
        artifacts, jobs = self.retry_fixture(False, "failed")
        self.assert_rejected(self.run_resolver(artifacts, jobs, {"allowFailedBuilds": True}), "No usable artifact")

    def test_incomplete_or_canceled_producer_never_selects_artifact(self):
        for state, result in [("inProgress", None), ("completed", "canceled"), ("completed", "skipped"), ("completed", None)]:
            with self.subTest(state=state, result=result):
                self.assert_rejected(self.run_resolver(jobs=[job(state=state, result=result)]))

    def test_succeeded_with_issues_producer_is_usable(self):
        self.assert_selected(self.run_resolver(jobs=[job(result="succeededWithIssues")]), [BASE + "_attempt1"])

    def test_matrix_shards_with_same_display_name_stay_separate(self):
        linux, arm = BASE + ".linux", BASE + ".arm64"
        artifacts = [artifact(linux + "_attempt1", "linux-old"), artifact(linux + "_attempt2", "linux"), artifact(arm + "_attempt1", "arm")]
        jobs = [job("arm", shard="windows-arm64"), job("linux", attempt=2, previous=[("linux-old", 1)], shard="linux-x64")]
        result = self.run_resolver(artifacts, jobs, {"artifactName": "", "artifactNames": [linux, arm]})
        self.assert_selected(result, [linux + "_attempt2", arm + "_attempt1"], requested_count=2)

    def test_current_timeline_previous_attempt_links_need_no_historical_fetch(self):
        artifacts, jobs = self.retry_fixture()
        self.assert_selected(self.run_resolver(artifacts, jobs), [BASE + "_attempt2"])

    def test_historical_duplicate_records_do_not_create_extra_producers(self):
        artifacts, jobs = self.retry_fixture()
        historical = job("old-producer", result="failed")
        jobs.extend([historical, copy.deepcopy(historical)])
        self.assert_selected(self.run_resolver(artifacts, jobs), [BASE + "_attempt2"])

    def test_explicit_build_pin_ignores_consumer_build_and_retry(self):
        pinned = 271828
        result = self.run_resolver(parameters={"buildId": str(pinned)}, macros={"Build.BuildId": "999999", "System.JobAttempt": "11"}, build=pinned)
        self.assert_selected(result, [BASE + "_attempt1"], build=pinned)

    def test_pipeline_resource_run_pin_is_expanded_from_yaml_environment(self):
        pinned = 98765
        result = self.run_resolver(parameters={"buildId": "$(resources.pipeline.sdk.runID)", "project": "Shared Dependencies"},
                                   macros={"resources.pipeline.sdk.runID": str(pinned), "Build.BuildId": "999999"}, build=pinned)
        self.assert_selected(result, [BASE + "_attempt1"], build=pinned)

    def test_legacy_fixed_name_current_producer_works_on_consumer_retry(self):
        result = self.run_resolver([artifact(BASE)], macros={"System.JobAttempt": "7"})
        self.assert_selected(result, [BASE])

    def test_legacy_fixed_name_from_previous_producer_attempt_fails(self):
        result = self.run_resolver([artifact(BASE, "old-producer")], [job(attempt=2, previous=[("old-producer", 1)])])
        self.assert_rejected(result, "No usable artifact")

    def test_legacy_fixed_name_owned_by_current_retry_is_usable(self):
        result = self.run_resolver([artifact(BASE)], [job(attempt=3, previous=[("old-producer", 1)])])
        self.assert_selected(result, [BASE])

    def test_attempt_artifact_wins_over_legacy_name(self):
        artifacts, jobs = self.retry_fixture()
        artifacts.append(artifact(BASE, "old-producer"))
        self.assert_selected(self.run_resolver(artifacts, jobs), [BASE + "_attempt2"])

    def test_ambiguous_multiple_producers_fail_even_if_one_is_newer(self):
        artifacts = [artifact(BASE + "_attempt1", "other-producer"), artifact(BASE + "_attempt2")]
        self.assert_rejected(self.run_resolver(artifacts, [job("other-producer"), job(attempt=2)]), "exactly one producing job")

    def test_unknown_or_absent_provenance_fails(self):
        for source in [None, "", identifier("unknown"), identifier("publish-task")]:
            with self.subTest(source=source):
                item = artifact(BASE + "_attempt1")
                item["source"] = source
                self.assert_rejected(self.run_resolver([item]))

    def test_known_and_unknown_candidates_fail_closed(self):
        artifacts = [artifact(BASE + "_attempt1"), artifact(BASE + "_attempt2", "unknown")]
        self.assert_rejected(self.run_resolver(artifacts), "provenance")

    def test_invalid_producer_attempts_fail(self):
        for attempt in [None, "", 0, -1, "two", "1.5", "2147483648"]:
            with self.subTest(attempt=attempt):
                self.assert_rejected(self.run_resolver(jobs=[job(attempt=attempt)]), "Invalid producing job attempt")

    def test_duplicate_selected_artifact_metadata_fails(self):
        item = artifact(BASE + "_attempt1")
        self.assert_rejected(self.run_resolver([item, copy.deepcopy(item)]), "Duplicate artifact metadata")

    def test_duplicate_current_job_records_fail(self):
        self.assert_rejected(self.run_resolver(jobs=[job(), job()]), "exactly one producing job")

    def test_missing_job_timeline_fails_even_when_artifacts_are_optional(self):
        self.assert_rejected(self.run_resolver(jobs=[], parameters={"allowMissing": True}), "timeline metadata")

    def test_suffix_attempt_without_matching_current_owner_is_not_selected(self):
        artifacts = [artifact(BASE + "_attempt2", "old-producer")]
        self.assert_rejected(self.run_resolver(artifacts, [job(attempt=2, previous=[("old-producer", 1)])]), "No usable artifact")

    def test_unrelated_higher_job_attempt_does_not_override_current_producer(self):
        artifacts = [artifact(BASE + "_attempt1"), artifact(SYMBOLS + "_attempt10", "unrelated")]
        jobs = [job(), job("unrelated", attempt=10, previous=[("unrelated-old", 9)])]
        self.assert_selected(self.run_resolver(artifacts, jobs), [BASE + "_attempt1"])

    def test_optional_multi_artifact_omits_stale_output_without_mixing_attempts(self):
        artifacts, jobs = self.retry_fixture(result="succeededWithIssues")
        artifacts.append(artifact(SYMBOLS + "_attempt1", "old-producer"))
        params = {"artifactName": "", "artifactNames": [BASE, SYMBOLS],
                  "allowMissing": True, "allowPartiallySucceededBuilds": True}
        self.assert_selected(self.run_resolver(artifacts, jobs, params), [BASE + "_attempt2"], requested_count=2)

    def test_required_multi_artifact_failure_emits_no_partial_variables(self):
        artifacts, jobs = self.retry_fixture()
        artifacts.append(artifact(SYMBOLS + "_attempt1", "old-producer"))
        params = {"artifactName": "", "artifactNames": [BASE, SYMBOLS]}
        self.assert_rejected(self.run_resolver(artifacts, jobs, params), "No usable artifact")

    def test_optional_empty_selection_emits_empty_patterns_not_wildcard(self):
        self.assert_selected(self.run_resolver([], parameters={"allowMissing": True}), [])

    def test_optional_failed_retry_omits_both_stale_and_failed_outputs(self):
        artifacts, jobs = self.retry_fixture(True, "failed")
        self.assert_selected(self.run_resolver(artifacts, jobs, {"allowMissing": True}), [])

    def test_optional_unknown_provenance_is_not_silently_omitted(self):
        self.assert_rejected(self.run_resolver([artifact(BASE + "_attempt1", "unknown")], parameters={"allowMissing": True}))

    def test_multiline_patterns_are_escaped_and_named_outputs_are_emitted(self):
        artifacts = [artifact(BASE + "_attempt1"), artifact(SYMBOLS + "_attempt1")]
        params = {"artifactName": "", "artifactNames": [SYMBOLS, BASE], "variablePrefix": "Toolchain_", "stepName": "resolveTools"}
        result = self.run_resolver(artifacts, parameters=params)
        self.assert_selected(result, [SYMBOLS + "_attempt1", BASE + "_attempt1"], requested_count=2, prefix="Toolchain_", outputs=True)
        self.assertIn("%0A", "\n".join(result["messages"]))

    def test_single_name_output_uses_prefix_and_output_alias(self):
        result = self.run_resolver(parameters={"variablePrefix": "Pinned_", "stepName": "resolveOne"})
        self.assert_selected(result, [BASE + "_attempt1"], prefix="Pinned_", outputs=True)

    def test_runtime_json_names_select_only_current_shard_attempts(self):
        artifacts, jobs = self.retry_fixture()
        artifacts.append(artifact(SYMBOLS + "_attempt1", "symbols-producer"))
        jobs.append(job("symbols-producer"))
        names = json.dumps([BASE, SYMBOLS])
        params = {"artifactName": "", "artifactNamesJson": "$(ExpectedArtifacts)"}
        result = self.run_resolver(artifacts, jobs, params, macros={"ExpectedArtifacts": names})
        self.assert_selected(result, [BASE + "_attempt2", SYMBOLS + "_attempt1"], requested_count=2)

    def test_runtime_json_requires_one_valid_array_input(self):
        cases = [
            {"artifactName": BASE, "artifactNamesJson": json.dumps([BASE])},
            {"artifactName": "", "artifactNames": [BASE], "artifactNamesJson": json.dumps([BASE])},
            {"artifactName": "", "artifactNamesJson": json.dumps(BASE)},
            {"artifactName": "", "artifactNamesJson": json.dumps({"name": BASE})},
            {"artifactName": "", "artifactNamesJson": "[broken"},
            {"artifactName": "", "artifactNamesJson": json.dumps([BASE, BASE])},
            {"artifactName": "", "artifactNamesJson": json.dumps([None])},
        ]
        for params in cases:
            with self.subTest(parameters=params):
                self.assert_rejected(self.run_resolver(parameters=params, responses=[]))

    def test_literal_name_matching_escapes_regex_metacharacters(self):
        base = "bundle (linux).debug"
        artifacts = [artifact(base + "_attempt1"), artifact("bundle linuxXdebug_attempt9", "unrelated")]
        self.assert_selected(self.run_resolver(artifacts, parameters={"artifactName": base}), [base + "_attempt1"])

    def test_matching_is_exact_and_case_sensitive(self):
        artifacts = [artifact(BASE + "_attempt1"), artifact(BASE.upper() + "_attempt9", "unrelated"), artifact(BASE + ".extra_attempt9", "unrelated")]
        self.assert_selected(self.run_resolver(artifacts), [BASE + "_attempt1"])

    def test_invalid_names_and_variable_prefixes_fail_before_requests(self):
        cases = [
            {"artifactName": "../bundle"}, {"artifactName": "bundle/*"}, {"artifactName": "bundle\\child"},
            {"artifactName": "bundle%0Ainjected"}, {"artifactName": "bundle\r\ninjected"},
            {"artifactName": "", "artifactNames": []},
            {"artifactName": "", "artifactNames": [BASE, BASE]},
            {"artifactName": BASE, "artifactNames": [SYMBOLS]},
            {"variablePrefix": "bad;isOutput=true"}, {"variablePrefix": "bad]value"},
        ]
        for params in cases:
            with self.subTest(parameters=params):
                self.assert_rejected(self.run_resolver(parameters=params, responses=[]))

    def test_malformed_artifact_name_json_fails_before_requests(self):
        self.assert_rejected(self.run_resolver(environment={"ARTIFACT_NAMES": "[broken"}, responses=[]))

    def test_invalid_build_ids_fail_without_any_metadata_request(self):
        for build in ["0", "-1", "bad", "1.5", "2147483648", "$(resources.pipeline.missing.runID)"]:
            with self.subTest(build=build):
                self.assert_rejected(self.run_resolver(parameters={"buildId": build}, responses=[]), "resolved build ID")

    def test_collection_url_and_token_validation_precede_api_requests(self):
        for collection in ["http://dev.azure.com/example-labs/", "https://untrusted.invalid/", "https://dev.azure.com/",
                           "https://dev.azure.com/example-labs/extra/", "https://dev.azure.com:444/example-labs/",
                           "https://user@dev.azure.com/example-labs/", "https://dev.azure.com/example-labs/?q=1",
                           "https://dev.azure.com/example-labs/#fragment"]:
            with self.subTest(collection=collection):
                self.assert_rejected(self.run_resolver(macros={"System.CollectionUri": collection}, responses=[]), "collection URL")
        self.assert_rejected(self.run_resolver(environment={"SYSTEM_ACCESSTOKEN": ""}, responses=[]), "access token")

    def test_generic_legacy_collection_host_is_supported(self):
        result = self.run_resolver(macros={"System.CollectionUri": "https://example-labs.visualstudio.com/"})
        self.assert_selected(result, [BASE + "_attempt1"])

    def test_legacy_default_collection_path_is_supported(self):
        result = self.run_resolver(macros={"System.CollectionUri": "https://example-labs.visualstudio.com/DefaultCollection/"})
        self.assert_selected(result, [BASE + "_attempt1"])

    def test_project_name_is_one_escaped_url_segment(self):
        result = self.run_resolver(parameters={"project": "Toolchain SDK + portable"})
        self.assert_selected(result, [BASE + "_attempt1"])

    def latest_responses(self, build=271828, partial=False, failed=False, tags="sdk release,stable+validated", value=None):
        branch = "refs/heads/releases/tools + portable"
        results = ["succeeded"] + (["partiallySucceeded"] if partial else []) + (["failed"] if failed else [])
        query = {"api-version": "7.1", "statusFilter": "completed", "queryOrder": "finishTimeDescending", "$top": "1",
                 "definitions": "73", "branchName": branch, "resultFilter": ",".join(results)}
        if tags:
            query["tagFilters"] = tags
        builds = value if value is not None else [build_record(build, branch=branch, tags=tags.split(",") if tags else [])]
        responses = [{"uri": api_url("builds", query), "response": {"count": len(builds), "value": builds}}]
        params = {"definition": "73", "branch": branch, "tags": tags,
                  "allowPartiallySucceededBuilds": partial, "allowFailedBuilds": failed}
        return params, responses

    def test_latest_definition_branch_tag_and_result_filters_pin_exact_selected_build(self):
        for partial, failed in [(False, False), (True, False), (False, True), (True, True)]:
            with self.subTest(partial=partial, failed=failed):
                params, responses = self.latest_responses(partial=partial, failed=failed)
                responses += metadata_responses([artifact(BASE + "_attempt1", build=271828)], [job()], build=271828)
                self.assert_selected(self.run_resolver(parameters=params, responses=responses), [BASE + "_attempt1"], build=271828)

    def test_latest_without_tags_does_not_send_empty_tag_filter(self):
        params, responses = self.latest_responses(tags="")
        responses += metadata_responses([artifact(BASE + "_attempt1")], [job()], build=271828)
        self.assert_selected(self.run_resolver(parameters=params, responses=responses), [BASE + "_attempt1"], build=271828)

    def test_missing_artifact_in_latest_build_does_not_search_an_older_run(self):
        params, responses = self.latest_responses()
        responses += metadata_responses([], [job()], build=271828)
        self.assert_rejected(self.run_resolver(parameters=params, responses=responses), "No usable artifact")

    def test_zero_or_ambiguous_latest_builds_fail_before_artifact_requests(self):
        for builds in [[], [build_record(1), build_record(2)]]:
            with self.subTest(build_count=len(builds)):
                params, responses = self.latest_responses(value=builds)
                self.assert_rejected(self.run_resolver(parameters=params, responses=responses), "No build matches")

    def test_invalid_latest_build_id_fails_before_artifact_requests(self):
        for build in [None, "bad", 0, -1]:
            with self.subTest(build=build):
                params, responses = self.latest_responses(value=[build_record(build)])
                self.assert_rejected(self.run_resolver(parameters=params, responses=responses), "resolved build ID")

    def test_latest_requires_positive_definition_and_exact_branch(self):
        for definition, branch in [("0", "refs/heads/main"), ("-1", "refs/heads/main"), ("invalid", "refs/heads/main"), ("73", "")]:
            with self.subTest(definition=definition, branch=branch):
                self.assert_rejected(self.run_resolver(parameters={"definition": definition, "branch": branch}, responses=[]), "definition ID and an exact branch")

    def test_metadata_transport_error_is_sanitized_and_not_retried(self):
        responses = [{"uri": api_url("builds/{}/artifacts".format(BUILD_ID)),
                      "error": "Redirect or 401 while using Bearer " + TOKEN}]
        self.assert_rejected(self.run_resolver(responses=responses), "Unable to read Azure Pipelines build metadata")

    def test_malformed_artifact_envelope_must_not_look_like_optional_omission(self):
        responses = metadata_responses([], [job()])
        responses[0]["response"] = {"count": 1, "unexpected": [artifact(BASE + "_attempt1")]}
        self.assert_rejected(self.run_resolver(parameters={"allowMissing": True}, responses=responses, call_counts={1, 2}))

    def test_ambiguous_previous_attempt_record_ids_fail(self):
        producer = job(attempt=3, previous=[("old-producer", 1)])
        producer["previousAttempts"].append({
            "attempt": 2, "recordId": identifier("old-producer"), "timelineId": identifier("conflicting-timeline"),
        })
        artifacts = [artifact(BASE + "_attempt1", "old-producer"), artifact(BASE + "_attempt3")]
        self.assert_rejected(self.run_resolver(artifacts, [producer]))


if __name__ == "__main__":
    unittest.main()
