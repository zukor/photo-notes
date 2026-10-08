'use strict';
// Run existing real-output fixtures with an internal-comment sentinel, in a fresh local database.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const url=new URL(process.env.DATABASE_URL||'');
assert(['127.0.0.1','localhost'].includes(url.hostname));
assert.equal(url.pathname,'/pn_export_presets_output_test');
const filename=path.join(__dirname,'test-export-presets-output.cjs');
let source=fs.readFileSync(filename,'utf8');
source=source.replace('postgresql://localhost/pn_export_presets_output_test',url.href);
const marker=' const req=async';assert(source.includes(marker));
source=source.replace(marker," await pool.query('INSERT INTO photo_comments(capture_id,author_id,author_name,text) VALUES($1,$2,$3,$4)',[ids[0],user.id,'Fixture','PRIVATE_COMMENT_SENTINEL_78465']);\n"+marker);
const checkpoint=" if(format==='pdf'){assert.equal";assert(source.includes(checkpoint));
source=source.replace(checkpoint," const contents=format==='pdf'?require('node:child_process').execFileSync('pdftotext',['-','-'],{input:b}).toString():Object.values(new Zip(b).files).filter(f=>!f.dir&&/\\.(xml|md|txt|html)$/.test(f.name)).map(f=>f.asText()).join('\\n');assert(!contents.includes('PRIVATE_COMMENT_SENTINEL_78465'),format+' must exclude internal discussion');\n"+checkpoint);
const fixture=new Module(filename,module);fixture.filename=filename;fixture.paths=module.paths;fixture._compile(source,filename);
