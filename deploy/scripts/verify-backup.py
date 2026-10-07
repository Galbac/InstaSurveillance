"""Isolated restore drill; creates and removes only randomly named test databases."""
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql
from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

url=make_url(os.environ['MIGRATION_DATABASE_URL'])
admin=psycopg.connect(host=url.host,port=url.port or 5432,user=url.username,password=url.password,dbname=url.database,autocommit=True)
source,target='insta_drill_'+uuid4().hex[:12],'insta_restore_'+uuid4().hex[:12]
for name in [source,target]:admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
source_url=url.set(database=source).render_as_string(hide_password=False);target_url=url.set(database=target).render_as_string(hide_password=False)
os.environ['DATABASE_URL']=source_url;os.environ['BACKUP_DATABASE_URL']=source_url
try:
    started=time.perf_counter()
    with tempfile.TemporaryDirectory() as directory:
        os.environ['LEDGER_DIRECTORY']=directory+'/ledger';os.environ['BACKUP_STATUS_DIRECTORY']=directory+'/status'
        # Exercise the delivered frozen migrations, not a create_all approximation.
        migrated=subprocess.run(['alembic','upgrade','head'],env=os.environ.copy(),capture_output=True)
        if migrated.returncode:raise RuntimeError('Drill migration failed')
        from app.models import User,Profile,SessionSecret,SessionRevocation,AuthSession,Snapshot
        from app.core.security import now,digest
        from app.integrations import ledger
        from app.backups import create_backup,restore_backup,decrypt_stream
        from datetime import timedelta
        engine=create_engine(source_url)
        with Session(engine) as db:
            deleted=User(email='deleted@example.com',password_hash='unusable',verified=True);survivor=User(email='survivor@example.com',password_hash='unusable',verified=True)
            db.add_all([deleted,survivor]);db.flush()
            profile=Profile(user_id=survivor.id,username='survivor',status='active',external_id='synthetic-id');db.add(profile);db.flush()
            db.add(SessionSecret(profile_id=profile.id,encrypted_settings='PRIVATE-SESSION-MUST-NOT-ENTER-BACKUP',key_version='1'))
            db.add(SessionRevocation(id=str(uuid4()),profile_id=profile.id,encrypted_settings='PRIVATE-REVOCATION-MUST-NOT-ENTER-BACKUP',key_version='1',expires_at=now()+timedelta(seconds=120)))
            db.add(Snapshot(profile_id=profile.id,source='archive',identity_mode='username',completeness='user_confirmed',checksum=uuid4().hex,observed_at=now(),counts={'followers':0,'following':0,'mutual':0,'fans':0,'not_following_back':0,'mutual_rate':None},provenance={},storage_bytes=0))
            db.add(AuthSession(user_id=survivor.id,token_hash=digest('synthetic-auth'),expires_at=now()+timedelta(days=1)))
            db.commit();deleted_id,survivor_id,profile_id=deleted.id,survivor.id,profile.id
        encrypted=Path(directory)/'database.aesgcm';create_backup(encrypted)
        # Deletion occurs after the database snapshot: the independent ledger must win on restore.
        ledger.record(str(uuid4()),'account',deleted_id)
        ledger.record(str(uuid4()),'history',profile_id,cutoff=now().isoformat())
        os.environ['DATABASE_URL']=target_url;os.environ['BACKUP_DATABASE_URL']=target_url
        restore_start=time.perf_counter();restore_backup(encrypted,target);restore_seconds=time.perf_counter()-restore_start
        restored=create_engine(target_url)
        with Session(restored) as db:
            assert db.get(User,deleted_id) is None
            assert db.get(User,survivor_id) is not None
            assert not list(db.scalars(select(SessionSecret))) and not list(db.scalars(select(AuthSession)))
            assert not list(db.scalars(select(SessionRevocation))) and not list(db.scalars(select(Snapshot)))
            result=db.get(Profile,profile_id)
            assert result.status=='reconnect_required' and result.paused and result.external_id is None
        # Inspect the decrypted custom archive through pg_restore, without printing its content.
        from app.backups import encryption_key
        with encrypted.open('rb') as incoming,tempfile.TemporaryFile() as plain:
            decrypt_stream(incoming,plain,encryption_key());plain.seek(0)
            dump=subprocess.run(['pg_restore','--data-only','--file=-'],stdin=plain,capture_output=True)
            assert dump.returncode==0 and b'PRIVATE-SESSION-MUST-NOT-ENTER-BACKUP' not in dump.stdout and b'PRIVATE-REVOCATION-MUST-NOT-ENTER-BACKUP' not in dump.stdout
        engine.dispose();restored.dispose()
        report={'drill':'isolated PostgreSQL 18 migration -> encrypted backup -> empty database restore','deletion_after_backup_replayed':True,'private_sessions_excluded':True,'logout_capabilities_excluded':True,'history_deletion_replayed':True,'service_sessions_revoked':True,'instagram_reconnect_required':True,'restore_seconds':round(restore_seconds,3),'total_seconds':round(time.perf_counter()-started,3),'production_rpo_rto_verified':False,'notes':'Local restore drill. Daily off-host uploads and RPO24h/RTO8h must be measured on the configured cloud.'}
        output=Path(os.environ.get('DRILL_REPORT_PATH','/tmp/restore-drill.json'));output.write_text(json.dumps(report,indent=2)+'\n')
        print('Isolated encrypted restore drill passed')
finally:
    for name in [source,target]:admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
    admin.close()
