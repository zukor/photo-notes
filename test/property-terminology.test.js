const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const vocabulary=require('../public/maintenance-terminology');
const {PassThrough}=require('node:stream');
const {execFileSync}=require('node:child_process');
const PizZip=require('pizzip');
const server=fs.readFileSync('server.js','utf8');
test('generated PDF and Word use edition labels while preserving saved values',async()=>{
 const handlerSource=server.slice(server.indexOf("app.get('/api/hoa/report'"),server.indexOf("function hoaEvidenceChecklist"));
 for(const edition of ['property','hoa'])for(const format of ['pdf','docx']){
 let handler,output,headers={},texts=[];
 class Node{constructor(o){this.options=o;}}class Pdf extends require('pdfkit'){text(value,...args){texts.push(value);return super.text(value,...args);}}
 const item={id:1,title:'Equipment repair',community_name:'Customer site',priority:'high',status:'board_decision',budget_source:'reserve',board_approval:'agenda',area:'Equipment'};
 const context={require:name=>name.startsWith('./')?require('../'+name.slice(2)):require(name),app:{get(path,...args){handler=args.at(-1)}},requireAuth(){},requireHoa(){},pool:{query:async sql=>({rows:sql.includes('SELECT i.*')?[{...item}]:[{id:2,photo_path:'/fixture.jpg',photo_stage:'initial'}]})},HOA_BUDGETS:['reserve'],currentProduct:async()=>edition,maintenanceTerminology:vocabulary,logEvent(){},PDFDocument:Pdf,localPhoto:()=>null,Paragraph:Node,TextRun:Node,Table:Node,TableRow:Node,TableCell:Node,Document:Node,HeadingLevel:{HEADING_2:2},WidthType:{PERCENTAGE:100},Packer:{toBuffer:async o=>JSON.stringify(o)},console};
 Object.assign(context,require('docx'),{PDFDocument:Pdf});
 const response=new PassThrough(),chunks=[];response.on('data',chunk=>chunks.push(chunk));const finished=new Promise(resolve=>response.on('finish',resolve));
 response.setHeader=(k,v)=>{headers[k]=v};response.send=v=>response.end(v);response.status=()=>{throw Error('Report handler failed')};
 vm.runInNewContext(handlerSource,context);await handler({query:{doc:format,budget:'reserve'},hoaCompany:{id:1,name:'Management Company'},user:{id:1}},response);await finished;const buffer=Buffer.concat(chunks);if(format==='pdf'){try{output=execFileSync('pdftotext',['-','-'],{input:buffer}).toString();}catch(e){if(e.code!=='ENOENT')throw e;output=texts.join('\n');}assert(buffer.subarray(0,4).toString()==='%PDF');}else output=new PizZip(buffer).file('word/document.xml').asText();
 assert(output.includes(edition==='property'?'Property Maintenance Report':'Board Photo Maintenance Report'));
 assert(output.includes(edition==='property'?'Approval Needed':'Board Decision Needed'));
 assert(output.includes(edition==='property'?'Capital':'Reserve Budget'));
 assert(output.includes(edition==='property'?'Approval Requested':'On Meeting Agenda'));
 assert(headers['Content-Disposition'].includes(edition==='property'?'property-maintenance-report':'hoa-board-photo-maintenance-report'));
 if(edition==='property')assert(!/Board|Reserve|Community/.test(output));
 assert.equal(item.status,'board_decision');assert.equal(item.budget_source,'reserve');assert.equal(item.board_approval,'agenda');
 }
});
