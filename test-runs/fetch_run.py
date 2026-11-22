"""Saves a platform run's input, battlecard item and reports into test-runs/results/<name>/.

Usage (from battlecard-actor/): python test-runs/fetch_run.py <name> <runId>
Uses the Apify CLI's stored login (`apify api`), so no token is passed on the command line.
"""
import json
import pathlib
import subprocess
import sys

UA = ['--user-agent', 'apify-agent-skills/apify-actor-development']


def api(path: str) -> str:
    out = subprocess.run(['apify', 'api', path, *UA], capture_output=True, text=True, encoding='utf-8', shell=True)
    return out.stdout


def main() -> None:
    name, run_id = sys.argv[1], sys.argv[2]
    folder = pathlib.Path(__file__).parent / 'results' / name
    folder.mkdir(parents=True, exist_ok=True)
    run = json.loads(api(f'actor-runs/{run_id}'))
    run = run.get('data', run)
    kv, ds = run['defaultKeyValueStoreId'], run['defaultDatasetId']
    summary = {
        'name': name,
        'runId': run_id,
        'status': run['status'],
        'statusMessage': run.get('statusMessage'),
        'build': run.get('buildNumber'),
        'memoryMbytes': (run.get('options') or {}).get('memoryMbytes'),
        'runTimeSecs': (run.get('stats') or {}).get('runTimeSecs'),
        'usageTotalUsd': run.get('usageTotalUsd'),
        'consoleUrl': f'https://console.apify.com/view/runs/{run_id}',
    }
    (folder / 'input.json').write_text(api(f'key-value-stores/{kv}/records/INPUT'), encoding='utf-8')
    items = json.loads(api(f'datasets/{ds}/items?clean=1') or '[]')
    if isinstance(items, dict):
        items = items.get('data', items).get('items', [])
    if items:
        (folder / 'battlecard.json').write_text(json.dumps(items[0], ensure_ascii=False, indent=2), encoding='utf-8')
        item = items[0]
        summary.update(
            {
                'apps': [a['name'] for a in item.get('apps', [])],
                'reviews': [a['reviewsAnalyzed'] for a in item.get('apps', [])],
                'labelled': [f"{a['classified']}/{a.get('sampled', '?')}" for a in item.get('apps', [])],
                'otherShare': [a['themeShares'].get('OTHER', 0) for a in item.get('apps', [])],
                'labelCheck': item.get('labelCheck'),
                'verdict': item.get('verdict'),
                'opportunities': [f"{c['theme']} vs {c['rival']} +{c['gapPoints']} ({c.get('confidence')})" for c in item.get('opportunities', [])],
                'threats': [f"{c['theme']} vs {c['rival']} +{c['gapPoints']} ({c.get('confidence')})" for c in item.get('threats', [])],
                'issues': [i['title'] for i in item.get('yourIssues', [])],
                'switching': [f"{s['app']} -> {s['mentions']}: {s['count']}" for s in item.get('switching', [])],
                'reportUrl': item.get('reportUrl'),
                'classicReportUrl': item.get('classicReportUrl'),
                'tokensUsed': item.get('tokensUsed'),
                'aiCopy': item.get('aiCopy'),
            }
        )
        for key, ext in (('BATTLECARD', 'html'), ('BATTLECARD_CLASSIC', 'classic.html'), ('BATTLECARD_MD', 'md')):
            body = api(f'key-value-stores/{kv}/records/{key}')
            if body:
                (folder / f'battlecard.{ext}').write_text(body, encoding='utf-8')
    (folder / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
