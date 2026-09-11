"""Artifact naming and reader wiring checks for the pipeline YAML tree."""

import json
import os
from pathlib import Path
import unittest

import yaml


HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("PIPELINE_ARTIFACT_ROOT", HERE.parent))
ATTEMPT_SUFFIX = "_attempt$(System.JobAttempt)"


class UniqueKeyLoader(yaml.SafeLoader):
    def construct_mapping(self, node, deep=False):
        keys = [self.construct_object(key, deep=deep) for key, _ in node.value]
        if len(keys) != len(set(keys)):
            raise ValueError("Duplicate YAML mapping key at " + str(node.start_mark))
        return super().construct_mapping(node, deep=deep)


def mappings(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from mappings(child)
    elif isinstance(value, list):
        for child in value:
            yield from mappings(child)


def publisher_name(node):
    task = str(node.get("task", "")).lower()
    if node.get("output") in ("pipelineArtifact", "buildArtifacts") or "publish" in node:
        inputs = node
    elif task.startswith(("publishpipelineartifact@", "publishbuildartifacts@")):
        inputs = node.get("inputs", {})
    else:
        return None
    for key in ("artifactName", "ArtifactName", "artifact"):
        if key in inputs:
            return str(inputs[key])
    return "<implicit artifact name>"


class PipelineArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.documents = {}
        for path in sorted(ROOT.rglob("*.yml")):
            cls.documents[path.relative_to(ROOT).as_posix()] = yaml.load(path.read_text(encoding="utf-8"), Loader=UniqueKeyLoader)
        cls.exceptions = json.loads((HERE / "artifact-name-exceptions.json").read_text(encoding="utf-8"))
        cls.publishers = [
            (path, publisher_name(node))
            for path, document in cls.documents.items()
            for node in mappings(document)
            if publisher_name(node) is not None
        ]

    def test_all_publishers_use_producer_attempt_or_documented_exception(self):
        self.assertTrue(self.publishers)
        exceptions = {(entry["file"], entry["name"]) for entry in self.exceptions}
        for path, name in self.publishers:
            with self.subTest(path=path, artifact=name):
                if (path, name) not in exceptions:
                    self.assertTrue(name.endswith(ATTEMPT_SUFFIX), name)
                    self.assertEqual(name.count("$(System.JobAttempt)"), 1, name)

    def test_exceptions_are_specific_and_still_used(self):
        seen = set()
        for entry in self.exceptions:
            identity = (entry["file"], entry["name"])
            self.assertNotIn(identity, seen)
            seen.add(identity)
            self.assertIn(identity, self.publishers)
            self.assertTrue(entry["reason"].strip())

    def test_retries_have_distinct_remote_names(self):
        for path, name in self.publishers:
            if name.endswith(ATTEMPT_SUFFIX):
                with self.subTest(path=path, artifact=name):
                    resolved = {name.replace("$(System.JobAttempt)", str(attempt)) for attempt in (1, 2, 10)}
                    self.assertEqual(len(resolved), 3)

    def test_readers_never_use_the_consumers_attempt(self):
        for path, document in self.documents.items():
            for node in mappings(document):
                is_task = str(node.get("task", "")).lower().startswith("downloadpipelineartifact@")
                if is_task or node.get("input") == "pipelineArtifact" or "download" in node:
                    with self.subTest(path=path, reader=node):
                        self.assertNotIn("$(System.JobAttempt)", json.dumps(node))

    def test_migrated_literal_names_are_not_downloaded_directly(self):
        bases = {name[:-len(ATTEMPT_SUFFIX)] for _, name in self.publishers if name.endswith(ATTEMPT_SUFFIX)}
        bases = {name for name in bases if "$" not in name}
        for path, document in self.documents.items():
            for node in mappings(document):
                if str(node.get("task", "")).lower().startswith("downloadpipelineartifact@"):
                    inputs = node.get("inputs", {})
                elif node.get("input") == "pipelineArtifact" or "download" in node:
                    inputs = node
                else:
                    continue
                name = inputs.get("artifactName", inputs.get("artifact"))
                with self.subTest(path=path, artifact=name):
                    self.assertNotIn(name, bases)

    def test_resolver_calls_in_extends_parameters_use_the_source_repository(self):
        for path, document in self.documents.items():
            if not isinstance(document, dict) or not isinstance(document.get("extends"), dict):
                continue
            for node in mappings(document["extends"].get("parameters", {})):
                template = str(node.get("template", ""))
                if template.split("@", 1)[0].endswith("/resolve_artifact.yml"):
                    with self.subTest(path=path, template=template):
                        self.assertTrue(template.startswith("/") and template.endswith("@self"), template)

    def test_resolver_calls_use_declared_parameters(self):
        helper = self.documents["templates/resolve_artifact.yml"]
        parameters = {parameter["name"] for parameter in helper["parameters"]}
        for path, document in self.documents.items():
            for node in mappings(document):
                if str(node.get("template", "")).split("@", 1)[0].endswith("/resolve_artifact.yml"):
                    supplied = node.get("parameters", {})
                    names = {key for key in supplied if not key.startswith("${{")}
                    with self.subTest(path=path):
                        self.assertFalse(names - parameters, names - parameters)
                        self.assertNotIn("$(System.JobAttempt)", json.dumps(supplied))
                        if "definition" in supplied:
                            self.assertIn("branch", supplied)


if __name__ == "__main__":
    unittest.main()
