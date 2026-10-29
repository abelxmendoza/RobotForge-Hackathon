"""Run actual browser-independent table math and input validation in Node."""
import shutil
import subprocess
from pathlib import Path
import pytest

ROOT=Path(__file__).resolve().parents[1]

def test_workspace_queries_and_import_validation():
    node=shutil.which('node')
    if not node or not (ROOT/'web-next/node_modules/typescript').exists():
        pytest.skip('Frontend dependencies required for workspace TypeScript tests')
    result=subprocess.run([node,str(ROOT/'tests/workspace_mock.mjs')],capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stdout+result.stderr
