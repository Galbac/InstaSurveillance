"""Read-only checks of actual PostgreSQL runtime role privileges."""
import os
import psycopg
from sqlalchemy.engine import make_url


def connect(value):
    url=make_url(value)
    return psycopg.connect(host=url.host,port=url.port or 5432,user=url.username,password=url.password,dbname=url.database)

with connect(os.environ['DATABASE_URL']) as api:
    assert not api.execute("SELECT has_table_privilege(current_user,'instagram_session_revocations','SELECT')").fetchone()[0]
    assert api.execute("SELECT has_function_privilege(current_user,'prepare_instagram_logout(text,text,text)','EXECUTE')").fetchone()[0]
    api.execute('DELETE FROM instagram_session_secrets WHERE profile_id IS NULL')
    api.rollback()
    assert not api.execute("SELECT has_column_privilege(current_user,'instagram_session_secrets','encrypted_settings','SELECT')").fetchone()[0]
    assert not api.execute("SELECT has_table_privilege(current_user,'instagram_session_secrets','SELECT')").fetchone()[0]
    assert not api.execute("SELECT has_column_privilege(current_user,'users','role','INSERT')").fetchone()[0]
    assert not api.execute("SELECT has_column_privilege(current_user,'users','role','UPDATE')").fetchone()[0]
    assert api.execute("SELECT has_column_privilege(current_user,'users','email','UPDATE')").fetchone()[0]
with connect(os.environ['WORKER_DATABASE_URL']) as worker:
    worker.execute('SELECT id FROM users WHERE false FOR UPDATE')
    assert not worker.execute("SELECT rolsuper OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname=current_user").fetchone()[0]
    assert not worker.execute("SELECT has_schema_privilege(current_user,'public','CREATE')").fetchone()[0]
    assert worker.execute("SELECT has_table_privilege(current_user,'instagram_session_secrets','SELECT')").fetchone()[0]
    assert not worker.execute("SELECT has_column_privilege(current_user,'users','role','UPDATE')").fetchone()[0]
print('API cannot read Instagram secrets or assign roles; worker cannot own/migrate schema or assign roles')
