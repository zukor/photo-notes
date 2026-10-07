const sharp=require('sharp');
const prompt="Read the photograph as physical dial artwork, not as a calibrated conversion chart. For each printed scale independently, find where the LONG thin pointer intersects that scale's tick marks. Ignore the short broad counterweight. Identify the printed labels on either side of that intersection and count the minor ticks. The artwork can have inconsistent or incorrect scales. Do not use Celsius/Fahrenheit conversion knowledge or force equivalent temperatures. Read the actual red Celsius ticks and black Fahrenheit ticks separately even when their values disagree. Explain the visible tick brackets for each reading in notes. Respond ONLY JSON: {\"instrument_type\":string|null,\"reading\":string|null,\"unit\":string|null,\"equipment_name\":string|null,\"observed_at\":string|null,\"notes\":string|null,\"confidence\":\"high\"|\"medium\"|\"low\"}. Put each independently observed reading and its unit in reading. Mark analog values approximate, digital values exact. If a scale cannot be visually read, say unreadable, never substitute a converted value. Ignore ambient weather/taskbar readings outside the instrument.";
async function readGauge(photo,vision){
 const first=await vision(photo,prompt,{maxTokens:1400});if(!first.data)return first;
 const units=String(first.data.unit||'')+' '+String(first.data.reading||'');
 if(!(/°C|\bC\b|celsius/i.test(units)&&/°F|\bF\b|fahrenheit/i.test(units)))return first;
 const upright=await sharp(photo).rotate().toBuffer();
 const rotated=await sharp(upright).rotate(90).toBuffer();
 const focus=unit=>`Read ONLY the ${unit==='C'?'Celsius scale, using its RED inner tick arc when present':'Fahrenheit scale, using its BLACK outer tick arc when present'} directly from the image. Ignore every number on the other scale and all temperature conversions. Follow the LONG thin pointer from its round center to the printed tick arc. Ignore the short broad counterweight. Determine the two adjacent PRINTED numbered marks and visually estimate between them. The artwork may be mathematically inconsistent with other scales. Do not use conventional temperature relationships. Respond ONLY JSON {"reading":string|null,"unit":"°${unit}","notes":string,"confidence":"high"|"medium"|"low"}. Explain the printed numbers bracketing the pointer. If unclear, return null rather than a converted value.`;
 const checks=await Promise.all(['F','C'].map(unit=>vision(rotated,focus(unit),{maxTokens:900})));
 const readings=checks.map((r,i)=>`${r.data?.reading||'unreadable'} °${['F','C'][i]}`);
 const data={...first.data,reading:readings.join(' | '),confidence:'low'};
 data.notes=[...checks.map(r=>r.data?.notes), 'Independent scale check: original view '+(first.data.reading||'unreadable')+'. Separately checked printed scales '+readings.join(' | ')+'. Readings are unverified AI estimates. Compare each printed scale with the source photograph and correct the fields before saving; inconsistent scales must never be converted into agreement.'].filter(Boolean).join('\n');
 return {...first,data};
}
module.exports={prompt,readGauge};
