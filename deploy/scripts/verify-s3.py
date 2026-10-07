"""Synthetic private S3 compatibility drill, run inside the development backend image."""
import io
import json
import os
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4
from botocore.exceptions import ClientError
from app.core.config import get_settings
from app.integrations import storage

settings=get_settings()
assert settings.storage_backend=='s3'
key='checks/'+uuid4().hex
content=b'synthetic-data-'*(700000)
try:
    storage.client(probe=True).head_bucket(Bucket=settings.s3_bucket)
    storage.put_stream(key,io.BytesIO(content),len(content))
    with storage.open_spooled(key,len(content)) as stream:
        assert stream.read()==content
    try:
        urllib.request.urlopen(settings.s3_endpoint+'/'+settings.s3_bucket+'/'+key,timeout=5)
        raise AssertionError('Anonymous access unexpectedly succeeded')
    except urllib.error.HTTPError as error:
        assert error.code in (401,403)
    storage.remove(key)
    try:
        storage.client().head_object(Bucket=settings.s3_bucket,Key=key)
        raise AssertionError('Deleted object remains available')
    except ClientError as error:
        assert error.response['Error']['Code'] in ('404','NoSuchKey','NotFound')
    report={'timestamp':datetime.now(UTC).isoformat(),'provider':'Garage v2.4.1, isolated Docker network','bytes':len(content),'multipart':True,'read_back_equal':True,'anonymous_denied':True,'delete_confirmed':True,'production_sse_tls_checked':False}
    if output:=os.environ.get('S3_REPORT_PATH'):
        Path(output).write_text(json.dumps(report,indent=2)+'\n')
    print('Private S3 multipart/read/delete/anonymous denial: PASS')
finally:
    storage.remove(key)
