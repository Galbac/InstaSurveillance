import fs from 'node:fs';
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
const records=Object.entries(lock.packages).filter(([path])=>path.startsWith('node_modules/')).map(([path,entry])=>({name:path.split('node_modules/').at(-1),version:entry.version,license:entry.license||'UNKNOWN',development:entry.dev===true}));
fs.writeFileSync(process.argv[2],JSON.stringify(records,null,2)+'\n');
console.log(`Inventoried ${records.length} dependencies; review unknown and reciprocal licenses before release`);
