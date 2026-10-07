"""Local HTTP/SMTP/broker/worker smoke with synthetic data; no Instagram calls."""
import http.cookiejar
import io
import json
import os
import re
import secrets
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

BASE=os.environ.get('SMOKE_BASE_URL', 'http://localhost:3100').rstrip('/')
MAIL=os.environ.get('SMOKE_MAIL_URL', 'http://localhost:8026').rstrip('/')
jar=http.cookiejar.CookieJar()
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
email='smoke-'+secrets.token_hex(6)+'@example.org'
password=secrets.token_urlsafe(24)

def raw(path,method='GET',data=None,headers=None):
    request=urllib.request.Request(BASE+'/api/v1'+path,data=data,method=method,headers=headers or {})
    with opener.open(request,timeout=20) as response:
        return response.status,response.read()

def call(path,method='GET',value=None,binary=None,content_type=None):
    headers={}
    if method!='GET':
        csrf=json.loads(raw('/auth/csrf')[1])['csrf_token']
        headers={'Origin':BASE,'X-CSRF-Token':csrf,'Idempotency-Key':secrets.token_hex(16)}
    data=binary
    if value is not None:data=json.dumps(value).encode();headers['Content-Type']='application/json'
    if content_type:headers['Content-Type']=content_type
    status,body=raw(path,method,data,headers)
    return json.loads(body) if body else None

def wait(path,status,seconds=60):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        data=call(path)
        if data['status']==status:return data
        if data['status'] in ('failed','cancelled','expired','partial'):raise RuntimeError('Job failed: '+data.get('error_code','unknown'))
        time.sleep(1)
    raise RuntimeError('Job timed out')

try:
    started=time.monotonic()
    call('/auth/register','POST',{'email':email,'password':password,'accepted_terms':True,'timezone':'Europe/Moscow'})
    call('/auth/login','POST',{'email':email,'password':password})
    # Mailpit belongs to this dev stack; read only this synthetic recipient's message.
    deadline=time.monotonic()+60
    message_id=None
    while time.monotonic()<deadline:
        with urllib.request.urlopen(MAIL+'/api/v1/search?query='+urllib.parse.quote('to:'+email),timeout=10) as response:
            messages=json.load(response).get('messages',[])
        if messages:message_id=messages[0]['ID'];break
        time.sleep(1)
    if not message_id:raise RuntimeError('Verification email not delivered')
    with urllib.request.urlopen(MAIL+'/api/v1/message/'+message_id,timeout=10) as response:
        text=json.load(response)['Text']
    verification=re.search(r'#token=([A-Za-z0-9_-]+)',text)
    assert verification
    call('/auth/verify-email','POST',{'token':verification.group(1)})
    profile=call('/profiles','POST',{'username':'synthetic_smoke','label':'Synthetic smoke'})
    pid=profile['id']
    for offset,names in [(2,['Alpha','Beta']),(1,['Beta','Gamma'])]:
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,'w') as archive:
            archive.writestr('followers_1.json',json.dumps([{'string_list_data':[{'value':name}]} for name in names]))
            archive.writestr('following.json',json.dumps({'relationships_following':[{'string_list_data':[{'value':'Beta'}]}]}))
        boundary='insta'+secrets.token_hex(10)
        payload=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.zip"\r\nContent-Type: application/zip\r\n\r\n'.encode()+buffer.getvalue()+f'\r\n--{boundary}--\r\n'.encode())
        job=call(f'/profiles/{pid}/imports','POST',binary=payload,content_type='multipart/form-data; boundary='+boundary)
        wait('/imports/'+job['id'],'awaiting_confirmation')
        call('/imports/'+job['id']+'/confirm','POST',{'observed_at':(datetime.now(UTC)-timedelta(days=offset)).isoformat(),'full_period':True,'followers_complete':True,'following_complete':True,'owns_data':True})
        wait('/imports/'+job['id'],'completed')
    history=call(f'/profiles/{pid}/snapshots')['items']
    assert len(history)==2
    pair=call(f'/profiles/{pid}/comparisons','POST',{'before_snapshot_id':history[1]['id'],'after_snapshot_id':history[0]['id']})
    wait('/comparisons/'+pair['id'],'completed')
    assert len(call('/comparisons/'+pair['id']+'/events')['items'])==2
    assert call(f'/profiles/{pid}/people?category=followers')['total']==2
    export=call('/exports','POST',{'scope':'account','format':'json'})
    wait('/exports/'+export['id'],'completed')
    exported=json.loads(raw('/exports/'+export['id']+'/download')[1])
    assert exported
    receipt=call('/privacy/delete-account','POST',{'password':password,'confirmation':'УДАЛИТЬ'})
    end=time.monotonic()+90
    while time.monotonic()<end:
        value=json.loads(raw('/privacy/requests/'+receipt['id'],headers={'Authorization':'Receipt '+receipt['receipt_token']})[1])
        if value['status']=='completed':break
        time.sleep(1)
    else:raise RuntimeError('Cleanup timed out')
    # Delete only the synthetic verification email; never all Mailpit messages.
    request=urllib.request.Request(MAIL+'/api/v1/messages',data=json.dumps({'IDs':[message_id]}).encode(),method='DELETE',headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=10):pass
    report={'stand':'local Docker stack over HTTP; Mailpit + Redis + Celery + PostgreSQL','registration_email_verification':True,'two_archives_and_comparison':True,'private_export_download':True,'account_deletion':True,'real_instagram_requests':False,'browser_qa':False,'seconds':round(time.monotonic()-started,3)}
    Path('docs/reports/dev-stack-smoke.json').write_text(json.dumps(report,indent=2)+'\n')
    print('Synthetic local stack workflow passed; temporary account deleted')
finally:
    try:
        call("/privacy/delete-account", "POST", {"password": password, "confirmation": "УДАЛИТЬ"})
    except Exception:
        pass  # Already deleted/revoked after a successful smoke.
