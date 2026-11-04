"""The optional local Gazebo companion cannot become a remote command runner."""
import pytest
from robotforge.simulator import allowed_request, normalize_job, platform_status

def test_origin_and_host_are_exact():
    assert allowed_request('127.0.0.1:8765','http://localhost:3100',{'http://localhost:3100'},'workshop')
    for host,origin,client in [('evil.test:8765','http://localhost:3100','workshop'),('127.0.0.1:8765','https://evil.test','workshop'),('127.0.0.1:8765',None,'workshop'),('127.0.0.1:8765','http://localhost:3100','')]:
        assert not allowed_request(host,origin,{'http://localhost:3100'},client)

def test_only_bounded_spec_jobs_are_accepted():
    from robotforge.schema import RobotSpec
    import json
    from pathlib import Path
    spec=json.loads((Path(__file__).resolve().parents[1]/'examples/pathfinder.json').read_text())
    clean=normalize_job({'spec':spec,'robotId':'r','versionId':'v','scenario':'flat'})
    assert isinstance(clean['spec'],RobotSpec)
    assert clean['spec'].name=='workshop_robot'  # model names never become XML/path injection
    for patch in [{'scenario':'ramp'},{'spec':{'name':'../../evil'}},{'robotId':''},{'command':'rm -rf /'}]:
        with pytest.raises(ValueError):normalize_job({'spec':spec,'robotId':'r','versionId':'v','scenario':'flat',**patch})

def test_platform_status_is_not_a_fake_runtime_check():
    assert platform_status('Darwin','arm64','10.0.0')['platform']=='macos-apple-silicon'
    assert platform_status('Darwin','arm64','10.0.0')['validation']=='best-effort; not verified on this Mac'
    assert platform_status('Linux','x86_64',None)['status']=='setup-needed'
    assert platform_status('Windows','AMD64','8.0.0')['status']=='unsupported'


def test_cancel_kills_owned_group_with_stubborn_child(tmp_path):
    import os,signal,subprocess,sys,time
    from robotforge.simulator import stop_process_group
    pidfile=tmp_path/'child'
    script="import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)"
    parent="import subprocess,time,pathlib; p=subprocess.Popen("+repr([sys.executable,'-c',script])+"); pathlib.Path("+repr(str(pidfile))+").write_text(str(p.pid));time.sleep(30)"
    proc=subprocess.Popen([sys.executable,'-c',parent],start_new_session=True)
    try:
        for _ in range(100):
            if pidfile.exists():break
            time.sleep(.01)
        assert pidfile.exists()
        child=int(pidfile.read_text())
        stop_process_group(proc,grace=.1)
        assert proc.poll() is not None
        # A killed grandchild can briefly remain a zombie until reaped by init.
        out=subprocess.run(['ps','-o','stat=','-p',str(child)],capture_output=True,text=True).stdout.strip()
        assert not out or out.startswith('Z')
    finally:
        try:os.killpg(proc.pid,signal.SIGKILL)
        except ProcessLookupError:pass


def test_cancel_before_worker_spawn_never_starts_gazebo(monkeypatch):
    import json
    from pathlib import Path
    from robotforge.simulator import Jobs
    import robotforge.simulator as module
    class DelayedThread:
        def __init__(self,*args,**kwargs):pass
        def start(self):pass
    monkeypatch.setattr(module.threading,'Thread',DelayedThread)
    monkeypatch.setattr(module.subprocess,'Popen',lambda *a,**k:pytest.fail('cancelled job spawned a child'))
    data={'spec':json.loads((Path(__file__).resolve().parents[1]/'examples/pathfinder.json').read_text()),'robotId':'r','versionId':'v','scenario':'flat'}
    jobs=Jobs();job=jobs.start(data);jobs.cancel(job['id'])
    jobs._run(job['id'],normalize_job(data))
    assert jobs.runs[job['id']]['status']=='cancelled'
    assert jobs.active is None
