"""Local single-node S3 configuration, stored only in a named Docker volume."""
import json
import os
from pathlib import Path

path = Path('/storage-config/garage.toml')
content = f'''metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = {json.dumps(os.environ['GARAGE_RPC_SECRET'])}
[s3_api]
s3_region = {json.dumps(os.environ['S3_REGION'])}
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"
[admin]
api_bind_addr = "[::]:3903"
metrics_token = {json.dumps(os.environ['METRICS_TOKEN'])}
'''
path.write_text(content)
path.chmod(0o600)
os.chown(path,10001,10001)
for directory in ('/storage-config','/storage-data','/storage-meta'):
    os.chown(directory,10001,10001)
