"""Optional same-computer Gazebo companion. No Worker, shell or arbitrary model uploads.

Start explicitly: python -m robotforge.simulator --origin http://localhost:3100
Only the configured browser Origin may send the preflighted workshop header.
"""
from __future__ import annotations
import argparse
import json
import math
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from .schema import RobotSpec

MAX_BODY = 256 * 1024

def allowed_request(host, origin, origins, client):
    return bool(re.fullmatch(r'(127\.0\.0\.1|localhost):\d+', host or '') and origin in origins and client == 'workshop')

def platform_status(system, machine, version):
    supported = system == 'Linux' or (system == 'Darwin' and machine in ('arm64', 'aarch64'))
    return {'platform': 'macos-apple-silicon' if system == 'Darwin' and machine in ('arm64','aarch64') else system.lower(),
            'status': 'unsupported' if not supported else 'available' if version else 'setup-needed',
            'version': version, 'validation': 'best-effort; not verified on this Mac' if system == 'Darwin' else 'Linux runner; validate each run',
            'protocol': 1, 'scenarios': ['flat'], 'mode': 'drive-and-turn-test'}

def normalize_job(data):
    if not isinstance(data, dict) or set(data) - {'spec','robotId','versionId','scenario'}:
        raise ValueError('Only a robot spec, identity and scenario are accepted.')
    if data.get('scenario') != 'flat':
        raise ValueError('The local Gazebo test currently supports flat ground only.')
    for key in ('robotId','versionId'):
        if not isinstance(data.get(key),str) or not 0 < len(data[key]) <= 200:
            raise ValueError('A robot and version identity are required.')
    raw = data.get('spec')
    if not isinstance(raw,dict) or raw.get('drivetrain') not in ('differential','skid_steer'):
        raise ValueError('The Gazebo drive test supports differential and skid-steer rovers only.')
    # The physical runner needs geometry, not unrelated electrical/catalogue fields.
    required = {'length_m': (.03, 3), 'width_m': (.03, 3), 'height_m': (.02, 3), 'mass_kg': (.05, 200), 'ground_clearance_m': (.001, .5)}
    for key,(lo,hi) in required.items():
        value=raw.get(key)
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not lo <= value <= hi:
            raise ValueError('Missing or out-of-range physics input: '+key)
    wheel=raw.get('wheel')
    if not isinstance(wheel,dict) or wheel.get('count') not in (2,4) or isinstance(wheel.get('count'),bool):
        raise ValueError('This runner requires two or four wheels.')
    for key,lo,hi in [('diameter_m',.01,1),('width_m',.005,.5)]:
        v=wheel.get(key)
        if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or not lo <= v <= hi:raise ValueError('Invalid wheel '+key)
    if raw['width_m'] < wheel['width_m'] or raw['length_m'] < wheel['diameter_m'] or raw['ground_clearance_m'] >= raw['height_m']:
        raise ValueError('The wheel and body geometry is inconsistent.')
    # Do not pass user XML, paths, names, sensors or component masses to the SDF generator.
    clean={**{k:raw[k] for k in required},'name':'workshop_robot','drivetrain':raw['drivetrain'],'wheel':{**wheel,'driven':True},
           'motor':{'kind':'dc_gearmotor','voltage_v':1,'count':wheel['count']},'battery':{'chemistry':'unknown','voltage_v':1,'capacity_mah':1},'sensors':[],
           'component_mass_kg':{'wheels':raw['mass_kg']*.2}}
    clean['wheel']={k:clean['wheel'][k] for k in ('diameter_m','width_m','count','driven')}
    spec=RobotSpec.from_dict(clean)
    return {'spec':spec,'robotId':data['robotId'],'versionId':data['versionId'],'scenario':'flat'}

def stop_process_group(proc, grace=2):
    """Stop the owned worker session including children that ignore SIGTERM."""
    try:os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:pass
    try:proc.wait(timeout=grace)
    except subprocess.TimeoutExpired:pass
    # The worker may already have exited while a native descendant survives.
    try:os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:pass
    try:proc.wait(timeout=2)
    except subprocess.TimeoutExpired:pass


class Jobs:
    def __init__(self):
        self.lock=threading.Lock(); self.runs={}; self.active=None; self.process=None
    def start(self,data):
        clean=normalize_job(data)
        with self.lock:
            if self.active:raise RuntimeError('A Gazebo test is already running. Wait or cancel it first.')
            key=uuid.uuid4().hex
            self.active=key
            self.runs[key]={'id':key,'status':'running','robotId':clean['robotId'],'versionId':clean['versionId'],'scenario':'flat','startedAt':time.time()}
            while len(self.runs)>10:self.runs.pop(next(iter(self.runs)))
        threading.Thread(target=self._run,args=(key,clean),daemon=True).start()
        return self.runs[key].copy()
    def _run(self,key,clean):
        proc=None
        try:
            with tempfile.TemporaryDirectory(prefix='robotforge-sim-') as folder:
                root=Path(folder);(root/'spec.json').write_text(json.dumps(clean['spec'].to_dict()))
                env={**os.environ,'GZ_PARTITION':'rf-workshop-'+key,'ROBOTFORGE_SHARED_PROCESS_GROUP':'1'}
                with self.lock:
                    if self.active!=key or self.runs[key]['status']!='running':return
                    proc=subprocess.Popen([sys.executable,'-m','robotforge.simulator','--job',str(root)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=env,start_new_session=True)
                    self.process=proc
                try:proc.wait(timeout=100)
                except subprocess.TimeoutExpired:
                    stop_process_group(proc)
                    raise RuntimeError('Gazebo timed out. No successful result was recorded.')
                output=json.loads((root/'result.json').read_text()) if (root/'result.json').exists() else {'error':'Gazebo stopped before returning a result.'}
                with self.lock:
                    if self.runs[key]['status']=='cancelled':return
                    self.runs[key].update({'status':'failed','error':output['error']} if 'error' in output else {'status':'complete','result':output,'engine':'Gazebo','model':'estimated primitive geometry; existing DiffDrive controller defaults; not a calibrated robot','version':self.version})
        except Exception as exc:
            with self.lock:
                if self.runs[key]['status']!='cancelled':self.runs[key].update(status='failed',error=str(exc))
        finally:
            if proc:stop_process_group(proc,grace=.3)
            with self.lock:
                if self.active==key:self.active=None;self.process=None
    def cancel(self,key):
        with self.lock:
            if key not in self.runs:raise KeyError(key)
            if self.runs[key]['status']=='running':
                self.runs[key]['status']='cancelled'
                proc=self.process if self.active==key else None
            else:proc=None
            result=self.runs[key].copy()
        if proc:stop_process_group(proc)
        return result
    def close(self):
        if self.active:self.cancel(self.active)

class Handler(BaseHTTPRequestHandler):
    server_version='RobotForgeLocal/1'
    def setup(self):
        super().setup();self.connection.settimeout(5)
    def log_message(self,*args):pass
    def reply(self,status,data):
        self.send_response(status)
        if self.headers.get('Origin') in self.server.origins:
            self.send_header('Access-Control-Allow-Origin',self.headers['Origin'])
            self.send_header('Vary','Origin')
        self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.end_headers()
        self.wfile.write(json.dumps(data,allow_nan=False).encode())
    def authorized(self,preflight=False):
        header='workshop' if preflight and 'x-robotforge-client' in self.headers.get('Access-Control-Request-Headers','').lower() else self.headers.get('X-RobotForge-Client')
        return allowed_request(self.headers.get('Host'),self.headers.get('Origin'),self.server.origins,header)
    def do_OPTIONS(self):
        if not self.authorized(True):self.reply(403,{'error':'Origin or client not allowed.'});return
        self.send_response(204);self.send_header('Access-Control-Allow-Origin',self.headers['Origin']);self.send_header('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');self.send_header('Access-Control-Allow-Headers','Content-Type, X-RobotForge-Client');self.send_header('Access-Control-Allow-Private-Network','true');self.end_headers()
    def do_GET(self):
        if not self.authorized():self.reply(403,{'error':'Origin or client not allowed.'});return
        if self.path=='/health':self.reply(200,self.server.health);return
        key=self.path.removeprefix('/runs/')
        with self.server.jobs.lock:run=self.server.jobs.runs.get(key) if self.path.startswith('/runs/') else None
        self.reply(200,run) if run else self.reply(404,{'error':'No such run.'})
    def do_POST(self):
        if not self.authorized():self.reply(403,{'error':'Origin or client not allowed.'});return
        if self.path!='/runs':self.reply(404,{'error':'No such operation.'});return
        if self.server.health['status']!='available':self.reply(409,{'error':'Gazebo setup is needed on this computer.'});return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=MAX_BODY or self.headers.get('Transfer-Encoding'):raise ValueError('Invalid or oversized request.')
            if self.headers.get('Content-Type','').split(';')[0]!='application/json':raise ValueError('Use a JSON request.')
            data=json.loads(self.rfile.read(size))
            self.reply(202,self.server.jobs.start(data))
        except (ValueError,TypeError,KeyError) as exc:self.reply(400,{'error':str(exc)})
        except RuntimeError as exc:self.reply(409,{'error':str(exc)})
    def do_DELETE(self):
        if not self.authorized():self.reply(403,{'error':'Origin or client not allowed.'});return
        if not self.path.startswith('/runs/'):self.reply(404,{'error':'No such operation.'});return
        try:self.reply(200,self.server.jobs.cancel(self.path[6:]))
        except KeyError:self.reply(404,{'error':'No such run.'})

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--origin',action='append');parser.add_argument('--port',type=int,default=8766);parser.add_argument('--job',help=argparse.SUPPRESS);args=parser.parse_args()
    if args.job:
        def stop(*_):raise SystemExit(1)
        signal.signal(signal.SIGTERM,stop)
        from .twin import run_motion_check
        root=Path(args.job)
        try:
            spec=RobotSpec.from_json((root/'spec.json').read_text())
            result=run_motion_check(spec,root,drive_m=.5,speed_mps=.2,turn_deg=90)
        except Exception as exc:result={'error':str(exc)}
        (root/'result.json').write_text(json.dumps(result));return
    origins=set(args.origin or ['http://localhost:3100'])
    from urllib.parse import urlsplit
    if any(urlsplit(o).scheme not in ('http','https') or not urlsplit(o).netloc or urlsplit(o).path or urlsplit(o).query or urlsplit(o).fragment or urlsplit(o).username for o in origins):parser.error('--origin must be an exact http(s) origin, without a path.')
    version=None
    if shutil.which('gz'):
        try:
            out=subprocess.run(['gz','sim','--versions'],capture_output=True,text=True,timeout=5).stdout
            match=re.findall(r'\b(?:8|9|10)\.\d+(?:\.\d+)?\b',out)
            version=match[-1] if match else None
        except (OSError,subprocess.SubprocessError):pass
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler);server.daemon_threads=True
    server.origins=origins;server.health=platform_status(platform.system(),platform.machine(),version);server.jobs=Jobs();server.jobs.version=version
    print(f'RobotForge Gazebo companion listening on 127.0.0.1:{args.port}. Status: {server.health["status"]}. Keep this terminal open.',flush=True)
    def stop_server(*_):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,stop_server)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.jobs.close();server.shutdown();server.server_close()

if __name__=='__main__':main()
