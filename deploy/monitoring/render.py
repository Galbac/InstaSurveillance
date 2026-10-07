"""Write monitor config into a private Docker volume; never print credentials."""
import json
import os
from pathlib import Path

root=Path('/monitor-config');root.mkdir(exist_ok=True)
(root/'token').write_text(os.environ['METRICS_TOKEN']);(root/'token').chmod(0o600)
config={'global':{'scrape_interval':'15s'},'rule_files':['/etc/prometheus/alerts.yml'],'scrape_configs':[{'job_name':'instasurveillance','metrics_path':'/api/v1/metrics','authorization':{'type':'Bearer','credentials_file':'/monitor-config/token'},'static_configs':[{'targets':['backend:8000']}]}],'alerting':{'alertmanagers':[{'static_configs':[{'targets':['alertmanager:9093']}]}]}}
config['scrape_configs'].append({'job_name':'volumes','metrics_path':'/metrics','authorization':{'type':'Bearer','credentials_file':'/monitor-config/token'},'static_configs':[{'targets':['volume-metrics:9101']}]})
for prefix,label in (('STORAGE','private'),('BACKUP','backup')):
 target=os.environ.get(prefix+'_METRICS_TARGET','')
 if target:
  if any(character in target for character in ('@','/')):raise ValueError('Metrics target must be host:port')
  path=root/(prefix.lower()+'-token')
  path.write_text(os.environ.get(prefix+'_METRICS_TOKEN','') or os.environ['METRICS_TOKEN'])
  config['scrape_configs'].append({'job_name':prefix.lower()+'-capacity','scheme':os.environ.get(prefix+'_METRICS_SCHEME','https'),'metrics_path':'/metrics','authorization':{'type':'Bearer','credentials_file':str(path)},'static_configs':[{'targets':[target],'labels':{'store':label}}]})
(root/'prometheus.yml').write_text(json.dumps(config))
webhook=os.environ.get('ALERT_WEBHOOK_URL','')
receiver={'name':'operations'}
if webhook:
 if not webhook.startswith('https://'):raise ValueError('Alert webhook must use HTTPS')
 receiver['webhook_configs']=[{'url':webhook,'send_resolved':True}]
(root/'alertmanager.yml').write_text(json.dumps({'route':{'receiver':'operations','group_by':['alertname'],'group_wait':'30s','group_interval':'5m','repeat_interval':'4h'},'receivers':[receiver]}))
for path in root.iterdir():os.chown(path,65534,65534);path.chmod(0o600)
os.chown(root,65534,65534);root.chmod(0o700)
