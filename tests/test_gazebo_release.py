from types import SimpleNamespace
from robotforge import gazebo, twin


def test_detection_and_matched_binding_families(monkeypatch):
    for version,release in [('8.15.0',gazebo.HARMONIC),('10.0.0\n8.15.0',gazebo.JETTY)]:
        gazebo.detect_release.cache_clear()
        monkeypatch.setattr(gazebo.subprocess,'run',lambda *a,**kw: SimpleNamespace(stdout=version))
        assert gazebo.detect_release() == release
        calls=[]
        def fake_import(name):
            calls.append(name)
            return SimpleNamespace(Node=object,Twist=object,Odometry=object,Pose_V=object,Server=object,ServerConfig=object)
        monkeypatch.setattr(twin.importlib,'import_module',fake_import)
        assert twin._import_sim_bindings() is not None
        assert twin._import_bindings() is not None
        assert calls == [f'gz.sim{release.sim}',f'gz.transport{release.transport}',f'gz.msgs{release.msgs}.odometry_pb2',f'gz.msgs{release.msgs}.pose_v_pb2',f'gz.msgs{release.msgs}.twist_pb2']
    gazebo.detect_release.cache_clear()


def test_unknown_version_uses_cli(monkeypatch):
    gazebo.detect_release.cache_clear()
    monkeypatch.setattr(gazebo.subprocess,'run',lambda *a,**kw: SimpleNamespace(stdout='11.0.0'))
    assert gazebo.detect_release() is None
    assert twin._import_bindings() is None
    assert twin._import_sim_bindings() is None
    gazebo.detect_release.cache_clear()
