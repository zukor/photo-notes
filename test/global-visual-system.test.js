const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('shared stylesheet contains the approved global visual tokens and roles',()=>{
 const css=fs.readFileSync('public/styles.css','utf8');
 for(const declaration of [
  '--pn-capture-blue:#1d4ed8',
  '--pn-azure:#77c5ff',
  '--pn-ice:#e5f5ff',
  '--pn-control-radius:6px',
  '--pn-control-border:1.5px solid #000'
 ])assert.ok(css.includes(declaration),declaration);
 assert.match(css,/input::placeholder,textarea::placeholder\s*\{[^}]*color:#666[^}]*font-weight:400/s);
 assert.match(css,/\.delete-text,[\s\S]*?color:#b42318;[\s\S]*?border:0;/);
 assert.match(css,/\.workflow-organize #cards \{ grid-template-columns:repeat\(5/);
});
