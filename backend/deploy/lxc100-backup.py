import argparse, gzip, logging, os, shutil, subprocess, sys, urllib.request, json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
import boto3
from botocore.config import Config
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / '.env')

log = logging.getLogger('backup')
logging.basicConfig(format='%(asctime)s [%(levelname)s] %(message)s',
                    datefmt='%Y-%m-%d %H:%M:%S', level=logging.INFO)

BACKUP_DIR = Path(os.getenv('BACKUP_DIR', '/var/backups/calsight'))
KEEP_LOCAL = int(os.getenv('BACKUP_KEEP_LOCAL', '3'))
KEEP_R2    = int(os.getenv('BACKUP_KEEP_R2',    '30'))
R2_ACCESS_KEY_ID     = os.environ['R2_ACCESS_KEY_ID']
R2_SECRET_ACCESS_KEY = os.environ['R2_SECRET_ACCESS_KEY']
R2_ENDPOINT_URL      = os.environ['R2_ENDPOINT_URL']
R2_BUCKET_NAME       = os.environ['R2_BUCKET_NAME']
DATABASE_URL         = os.environ['DATABASE_URL']
DISCORD_WEBHOOK      = os.getenv('DISCORD_BACKUP_WEBHOOK', '')
TIMESTAMP = datetime.now(timezone.utc).strftime('%Y-%m-%d_%H%M%S')
DUMP_NAME = 'calsight_' + TIMESTAMP + '.dump.gz'

def discord(ok, filename='', size_mb=0.0, error=''):
    if not DISCORD_WEBHOOK:
        return
    if ok:
        desc = '**' + filename + '** - ' + str(round(size_mb, 1)) + ' MB uploaded to R2'
        payload = {'embeds': [{'title': ':white_check_mark: Backup OK', 'description': desc, 'color': 3066993}]}
    else:
        payload = {'embeds': [{'title': ':x: Backup FAILED', 'description': '```' + error[:1800] + '```', 'color': 15158332}]}
    data = json.dumps(payload).encode()
    req = urllib.request.Request(DISCORD_WEBHOOK, data=data,
                                 headers={'Content-Type': 'application/json', 'User-Agent': 'CalSightBackup/1.0'})
    try:
        urllib.request.urlopen(req, timeout=10)
        log.info('Discord notification sent')
    except Exception as e:
        log.warning('Discord notify failed: %s', e)

def r2_client():
    return boto3.client('s3', endpoint_url=R2_ENDPOINT_URL,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version='s3v4'), region_name='auto')

def parse_db_url(url):
    p = urlparse(url)
    return dict(host=p.hostname or 'localhost', port=str(p.port or 5432),
                dbname=p.path.lstrip('/'), user=p.username or '',
                password=p.password or '')

def make_dump():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    out = BACKUP_DIR / DUMP_NAME
    db = parse_db_url(DATABASE_URL)
    log.info('Starting pg_dump -> %s', out)
    env = {**os.environ, 'PGPASSWORD': db['password']}
    pg = shutil.which('pg_dump') or 'pg_dump'
    cmd = [pg, '-h', db['host'], '-p', db['port'], '-U', db['user'], '-d', db['dbname'], '-Fc']
    with gzip.open(out, 'wb') as gz:
        proc = subprocess.run(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if proc.returncode != 0:
            out.unlink(missing_ok=True)
            err = proc.stderr.decode()
            log.error('pg_dump failed: %s', err)
            discord(False, error=err)
            sys.exit(1)
        gz.write(proc.stdout)
    log.info('Dump complete: %.1f MB', out.stat().st_size / 1048576)
    return out

def latest_local_dump():
    dumps = sorted(BACKUP_DIR.glob('calsight_*.dump.gz'), reverse=True)
    if not dumps:
        msg = 'No local dumps in ' + str(BACKUP_DIR)
        log.error(msg)
        discord(False, error=msg)
        sys.exit(1)
    log.info('Using: %s', dumps[0].name)
    return dumps[0]

def upload(path):
    client = r2_client()
    key = path.name
    size_mb = path.stat().st_size / 1048576
    log.info('Uploading %s (%.1f MB) -> r2://%s/%s', key, size_mb, R2_BUCKET_NAME, key)
    client.upload_file(str(path), R2_BUCKET_NAME, key)
    log.info('Upload complete')
    return key, size_mb

def rotate_local():
    for p in sorted(BACKUP_DIR.glob('calsight_*.dump.gz'), reverse=True)[KEEP_LOCAL:]:
        log.info('Removing local: %s', p.name)
        p.unlink()

def rotate_r2():
    client = r2_client()
    objs = client.list_objects_v2(Bucket=R2_BUCKET_NAME).get('Contents', [])
    dumps = sorted([o for o in objs if o['Key'].startswith('calsight_')],
                   key=lambda o: o['Key'], reverse=True)
    for obj in dumps[KEEP_R2:]:
        log.info('Removing R2: %s', obj['Key'])
        client.delete_object(Bucket=R2_BUCKET_NAME, Key=obj['Key'])

def main():
    parser = argparse.ArgumentParser(description='Calsight R2 backup')
    parser.add_argument('--upload-only', action='store_true')
    args = parser.parse_args()
    try:
        path = latest_local_dump() if args.upload_only else make_dump()
        key, size_mb = upload(path)
        rotate_local()
        rotate_r2()
        log.info('Backup finished successfully')
        discord(True, filename=key, size_mb=size_mb)
    except SystemExit:
        raise
    except Exception as e:
        log.exception('Unexpected error')
        discord(False, error=str(e))
        sys.exit(1)

if __name__ == '__main__':
    main()
