#!/usr/bin/env python3
"""Generate 3D robot models with ProjectSim (Kaedim) and convert them to GLB.

Runs on the owner's computer, not in CI and not in the Worker. The API
token is read from the PROJECTSIM_TOKEN environment variable, or typed at
a hidden prompt. It is never written to disk, logged, or put in the repo.

    python3 tools/projectsim_generate.py --list
    python3 tools/projectsim_generate.py boston-dynamics-spot vex-v5-tank-drive          # dry run: shows cost
    python3 tools/projectsim_generate.py boston-dynamics-spot vex-v5-tank-drive --yes    # spends credits
    python3 tools/projectsim_generate.py robots      # or parts, or all (dry run)

Cost (ProjectSim docs, 2026-11): 4 credits per standard asset, 6 per
articulated one. A failed job is refunded. Jobs take minutes, not seconds.

What it does per robot (subjects in tools/projectsim/subjects.json):
  1. POST /v1/assets/standard with an image we have rights to, or text
     written from the catalogue (never a copyrighted photo).
  2. Polls GET /v1/jobs/{job_id} until complete / failed.
  3. Downloads the USD package to ~/projectsim-downloads/<slug>/ (NOT the
     repo; packages are ~30-50 MB).
  4. Converts the USD to a web GLB with tools/convert_usd_to_glb.py into
     assets/robot-twins/<slug>.glb, and writes assets/robot-twins/<slug>.json
     with the asset id, inputs, credit and the "generated, not CAD" label.

Needs: pip install httpx usd-core trimesh pillow fast-simplification
"""
import argparse
import getpass
import json
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

API = 'https://api.projectsim.ai'
ROOT = Path(__file__).resolve().parent.parent
SUBJECTS = ROOT / 'tools' / 'projectsim' / 'subjects.json'
OUT = ROOT / 'assets' / 'robot-twins'
DOWNLOADS = Path.home() / 'projectsim-downloads'
CREDITS = {False: 4, True: 6}
POLL_S = 10
TIMEOUT_S = 60 * 60


def load_subjects():
    data = json.loads(SUBJECTS.read_text())
    return {k: v for k, v in data.items() if not k.startswith('_')}


def token():
    t = os.environ.get('PROJECTSIM_TOKEN') or getpass.getpass('ProjectSim API token (hidden): ')
    t = t.strip()
    if not t.startswith('kps_'):
        sys.exit('That does not look like a ProjectSim token (they start with kps_). Nothing was sent.')
    return t


def body_for(slug, s):
    inputs = {}
    if s.get('image_url'):
        inputs['images'] = [{'url': s['image_url']}]
    if s.get('text'):
        inputs['text'] = s['text']
    params = {'physics': {'simulator': 'isaac_sim_physx', 'body': 'rigid',
                          'articulated': bool(s.get('articulated'))},
              'mesh': {'quality': 'low'}, 'texture': {'resolution': 2048}}
    return {'name': slug.replace('-', ' '), 'inputs': inputs, 'params': params}


def check(r, ok):
    if r.status_code not in ok:
        sys.exit(f'ProjectSim answered {r.status_code}: {r.text[:500]}')
    return r.json()


def run_one(client, httpx, slug, s):
    body = body_for(slug, s)
    print(f'\n[{slug}] creating asset...')
    created = check(client.post('/v1/assets/standard', json=body,
                                headers={'Idempotency-Key': str(uuid.uuid4())}), (202,))
    asset_id, job_id = created['id'], created['job_id']
    print(f'[{slug}] asset {asset_id}, job {job_id}')
    start = time.time()
    while True:
        job = check(client.get(f'/v1/jobs/{job_id}'), (200,))
        st = job.get('status')
        if st == 'retried' and job.get('retried_by'):
            job_id = job['retried_by']
            print(f'[{slug}] retried on ProjectSim side as {job_id}')
            continue
        if st == 'complete':
            break
        if st in ('failed', 'canceled', 'partial'):
            sys.exit(f'[{slug}] job ended {st}: {job.get("error")} (failed jobs are refunded)')
        if time.time() - start > TIMEOUT_S:
            sys.exit(f'[{slug}] still {st} after an hour; check the dashboard. Asset {asset_id}.')
        print(f'[{slug}] {st} {job.get("current_stage") or ""} {job.get("progress") or ""}', flush=True)
        time.sleep(POLL_S)

    asset = check(client.get(f'/v1/assets/{asset_id}'), (200,))
    dest = (DOWNLOADS / slug).resolve()
    usd = None
    for f in asset['files']:
        target = (dest / f['path']).resolve()
        if not target.is_relative_to(dest):
            sys.exit('Unexpected download path from ProjectSim; stopped.')
        target.parent.mkdir(parents=True, exist_ok=True)
        with httpx.stream('GET', f['url'], timeout=120, follow_redirects=True) as dl:
            dl.raise_for_status()
            with target.open('wb') as fh:
                for chunk in dl.iter_bytes(1 << 20):
                    fh.write(chunk)
        if target.suffix in ('.usd', '.usdc', '.usda') and f.get('kind') == 'usd' and usd is None:
            usd = target
    if usd is None:
        sys.exit(f'[{slug}] no USD file in the download ({dest}).')

    OUT.mkdir(parents=True, exist_ok=True)
    glb = OUT / f'{slug}.glb'
    jobs = dest / 'convert-jobs.json'
    jobs.write_text(json.dumps([[str(usd), str(glb)]]))
    subprocess.run([sys.executable, str(ROOT / 'tools' / 'convert_usd_to_glb.py'), str(jobs)], check=True)

    record = {
        'robot': s['name'],
        'label': 'Generated 3D model (ProjectSim by Kaedim). Not manufacturer CAD; shape, scale and physics are estimates.',
        'generator': 'ProjectSim by Kaedim, POST /v1/assets/standard',
        'asset_id': asset_id,
        'job_id': job_id,
        'generated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'inputs': {'image_url': s.get('image_url'), 'image_credit': s.get('image_credit'),
                   'image_license': s.get('image_license'), 'text': s.get('text')},
        'effective_params': asset.get('effective_params'),
        'dimensions': asset.get('dimensions'),
        'glb': f'assets/robot-twins/{slug}.glb',
        'glb_bytes': glb.stat().st_size,
    }
    (OUT / f'{slug}.json').write_text(json.dumps(record, indent=2) + '\n')
    print(f'[{slug}] done: {glb.relative_to(ROOT)} ({glb.stat().st_size / 1e6:.1f} MB)')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('slugs', nargs='*')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--yes', action='store_true', help='actually create assets and spend credits')
    a = ap.parse_args()
    subjects = load_subjects()
    if a.list or not a.slugs:
        for k, v in subjects.items():
            print(f'{k:28} {v["name"]}  ({CREDITS[bool(v.get("articulated"))]} credits)')
        return
    groups = {'all': list(subjects), 'robots': [k for k, v in subjects.items() if v.get('kind') == 'robot'],
              'parts': [k for k, v in subjects.items() if v.get('kind') == 'part']}
    a.slugs = [x for s in a.slugs for x in groups.get(s, [s])]
    unknown = [s for s in a.slugs if s not in subjects]
    if unknown:
        sys.exit(f'Unknown robot(s): {", ".join(unknown)}. See --list.')
    total = sum(CREDITS[bool(subjects[s].get('articulated'))] for s in a.slugs)
    print(f'{len(a.slugs)} model(s), about {total} ProjectSim credits.')
    if not a.yes:
        print('Dry run. Add --yes to generate.')
        return
    import httpx
    with httpx.Client(base_url=API, headers={'Authorization': f'Bearer {token()}'}, timeout=30) as client:
        for slug in a.slugs:
            run_one(client, httpx, slug, subjects[slug])


if __name__ == '__main__':
    main()
