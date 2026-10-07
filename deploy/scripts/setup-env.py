"""Create development credentials once. Values never go to stdout."""
import base64
import os
import secrets
from pathlib import Path

root=Path(__file__).resolve().parents[2]
path=root/".env.dev"
if path.exists():
    content=path.read_text()
    if "GARAGE_RPC_SECRET=" not in content:
        content+="\nGARAGE_RPC_SECRET="+secrets.token_hex(32)+"\n"
    if "S3_ACCESS_KEY_ID=insta-dev" in content:
        content=content.replace("S3_ACCESS_KEY_ID=insta-dev","S3_ACCESS_KEY_ID=GK"+secrets.token_hex(16))
    path.write_text(content)
    path.chmod(0o600)
    print("Local environment already exists")
else:
    secret_names={"POSTGRES_PASSWORD","API_DB_PASSWORD","WORKER_DB_PASSWORD","CSRF_SECRET","METRICS_TOKEN","S3_SECRET_ACCESS_KEY","GARAGE_RPC_SECRET"}
    key_names={"ENCRYPTION_KEY","INSTAGRAM_PENDING_ENCRYPTION_KEY","INSTAGRAM_SESSION_ENCRYPTION_KEY","BACKUP_ENCRYPTION_KEY"}
    values={name:secrets.token_hex(32) for name in secret_names}
    values["S3_ACCESS_KEY_ID"]="GK"+secrets.token_hex(16)
    values.update({name:base64.urlsafe_b64encode(secrets.token_bytes(32)).decode() for name in key_names})
    values.update({"DATABASE_URL":f"postgresql+psycopg://insta_api:{values['API_DB_PASSWORD']}@db:5432/insta",
                   "WORKER_DATABASE_URL":f"postgresql+psycopg://insta_worker:{values['WORKER_DB_PASSWORD']}@db:5432/insta",
                   "MIGRATION_DATABASE_URL":f"postgresql+psycopg://insta:{values['POSTGRES_PASSWORD']}@db:5432/insta"})
    lines=[]
    for line in (root/".env.dev.example").read_text().splitlines():
        key,separator,value=line.partition("=")
        lines.append(key+"="+values.get(key,value) if separator else line)
    descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(descriptor,"w") as stream:stream.write("\n".join(lines)+"\n")
    print("Created private local environment")
