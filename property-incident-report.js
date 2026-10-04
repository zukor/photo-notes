'use strict';
// Uses the application's existing photo renderer, including current markup and stamps.
module.exports=function createReport({PDFDocument,Document,Packer,Paragraph,TextRun,ImageRun,localPhoto,renderForEmbedStamped,fittedWordImage}){
 return async(req,res,{incident:i,photos},evidence,views)=>{
 if(!photos.length)throw Object.assign(new Error('Upload at least one incident photograph before generating a report'),{status:400});
 const fields=[['Property',i.property_name],['Property address',i.property_address],['Area',i.area_name],['Asset',i.asset_name],['Incident type',i.incident_type==='Other'?`Other: ${i.other_type}`:i.incident_type],['Status',i.status],['Observed/Documented Time',new Date(i.observed_at).toISOString()],['Reported Incident Time (user entered)',i.reported_at&&new Date(i.reported_at).toISOString()],['Description',i.description],['Reported By',i.reported_by],['Observed By',i.observed_by],['Other Party / Company',i.other_party],['Reference Numbers',i.reference_numbers],['Immediate Actions / Notes',i.immediate_actions]].filter(([,v])=>v);
 const rendered=[];for(const p of photos){const file=localPhoto(p.photo_path);if(!file)throw Object.assign(new Error('A report photo is unavailable'),{status:409});const image=await renderForEmbedStamped(file,'standard','jpeg',p);if(!image)throw Object.assign(new Error('A report photo could not be rendered'),{status:409});rendered.push({p,image});}
 const caption=p=>[p.photo_title,p.note,p.address,p.location_description?`Exact-location description: ${p.location_description}`:null,p.subject_latitude!=null&&p.subject_longitude!=null?`Subject Location (user entered): ${p.subject_latitude}, ${p.subject_longitude}`:null,p.latitude!=null&&p.longitude!=null?`Photo GPS: ${p.latitude}, ${p.longitude}`:null,`Photo saved: ${new Date(p.created_at).toISOString()}`].filter(Boolean).join('\n');
 const skipped=views.filter(v=>i.skipped_views?.[v]).map(v=>`${v} skipped: ${i.skipped_views[v]}`);
 if(req.query.doc==='docx'){
 const para=(text,bold=false)=>new Paragraph({children:[new TextRun({text:String(text),bold,font:'Arial',color:'000000'})]});
 const children=[para('Damage & Incident Report',true),para(i.title,true),...fields.map(([k,v])=>para(`${k}: ${v}`)),para(evidence),...skipped.map(x=>para(x))];
 for(const {p,image} of rendered){children.push(para(p.view_name,true),new Paragraph({children:[new ImageRun({type:image.ext==='.png'?'png':'jpg',data:image.buffer,transformation:await fittedWordImage(image.buffer,480,320)})]}),para(caption(p)));}
 const buffer=await Packer.toBuffer(new Document({styles:{default:{document:{run:{font:'Arial',color:'000000'}}}},sections:[{children}]}));res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').attachment(`damage-incident-${i.id}.docx`).send(buffer);return;
 }
 const pdf=new PDFDocument({margin:48});res.type('application/pdf').attachment(`damage-incident-${i.id}.pdf`);pdf.pipe(res);pdf.fillColor('#000').font('Helvetica-Bold').fontSize(20).text('Damage & Incident Report').fontSize(15).text(i.title).moveDown();pdf.font('Helvetica').fontSize(11);for(const [k,v] of fields)pdf.text(`${k}: ${v}`).moveDown(.4);pdf.text(evidence).moveDown();for(const x of skipped)pdf.text(x);
 for(const {p,image} of rendered){pdf.addPage();pdf.font('Helvetica-Bold').fontSize(14).text(p.view_name).moveDown();const top=pdf.y;pdf.image(image.buffer,48,top,{fit:[480,320]});pdf.y=top+330;pdf.font('Helvetica').fontSize(11).text(caption(p));}pdf.end();
 };
};
