"""Synthetic HTTP disconnect through the real restricted API role. No Instagram requests."""
import http.cookiejar
import json
import os
import secrets
import urllib.request
from datetime import UTC,datetime
from pathlib import Path
from sqlalchemy import create_engine,select,delete
from sqlalchemy.orm import Session
from app.core.security import hasher
from app.models import User,Profile,SessionSecret,SessionRevocation,Outbox

engine=create_engine(os.environ.get('MIGRATION_DATABASE_URL') or os.environ['DATABASE_URL'])
identity=None
password=secrets.token_urlsafe(24)
jar=http.cookiejar.CookieJar()
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
base='http://backend:8000/api/v1'

def command(path,method,value=None):
    with opener.open(base+'/auth/csrf',timeout=5) as response:
        csrf=json.load(response)['csrf_token']
    request=urllib.request.Request(base+path,method=method,data=json.dumps(value).encode() if value is not None else None,headers={'Origin':os.environ['APP_BASE_URL'],'X-CSRF-Token':csrf,'Content-Type':'application/json'})
    with opener.open(request,timeout=10) as response:
        return response.status,response.headers,json.load(response)

try:
    with Session(engine) as db:
        user=User(email='disconnect-'+secrets.token_hex(8)+'@example.org',password_hash=hasher.hash(password),verified=True)
        db.add(user);db.flush()
        identity=user.id
        profile=Profile(user_id=identity,username='synthetic_disconnect',status='active',paused=False)
        db.add(profile);db.flush()
        db.add(SessionSecret(profile_id=profile.id,encrypted_settings='SYNTHETIC-NON-DECRYPTABLE-CAPABILITY',key_version='1'))
        db.commit()
        pid,email=profile.id,user.email
    assert command('/auth/login','POST',{'email':email,'password':password})[0]==200
    status,headers,result=command('/profiles/'+pid+'/connection','DELETE')
    assert status==202 and result['status']=='disconnected' and headers['Location'].endswith('/connection')
    with Session(engine) as db:
        assert db.get(SessionSecret,pid) is None
        assert db.get(Profile,pid).status=='disconnected'
        assert db.scalar(select(Outbox.id).where(Outbox.kind=='revoke',Outbox.reference.in_(select(SessionRevocation.id).where(SessionRevocation.profile_id==pid)))) is not None
    report={'timestamp':datetime.now(UTC).isoformat(),'real_api_role_http':True,'secret_deleted':True,'opaque_worker_capability_created':True,'instagram_requests':False}
    if path:=os.environ.get('DISCONNECT_REPORT_PATH'):
        Path(path).write_text(json.dumps(report,indent=2)+'\n')
    print('Restricted API disconnect + opaque logout capability: PASS')
finally:
    if identity:
        with Session(engine) as db:
            refs=list(db.scalars(select(SessionRevocation.id).join(Profile).where(Profile.user_id==identity)))
            db.execute(delete(Outbox).where(Outbox.kind=='revoke',Outbox.reference.in_(refs)))
            db.execute(delete(User).where(User.id==identity));db.commit()
    engine.dispose()
