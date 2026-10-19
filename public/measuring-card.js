(()=>{
'use strict';
// Marker 7 of the ArUco MIP 36h12 set inside a one-cell white border (10 x 10 cells).
const PATTERN='0000000000,0111111110,0110101110,0101101110,0101110010,0111101010,0110111110,0110000010,0111111110,0000000000'.split(',');
// The black square's side. The whole card, white border included, is 1.25 times this.
const SIZES={6:{paper:'letter',label:'6-inch (Letter paper)'},8:{paper:'11in 17in',label:'8-inch (11 x 17 paper, more accurate)'},12:{paper:'18in 24in',label:'12-inch (print shop, most accurate)'}};
const requested=Number(new URLSearchParams(location.search).get('size'));
const side=SIZES[requested]?requested:6;
const card=document.getElementById('card');
card.style.width=(side*1.25)+'in';
for(const row of PATTERN)for(const bit of row){const cell=document.createElement('i');if(bit==='1')cell.className='b';card.append(cell);}
document.getElementById('sideText').textContent=side+' inches';
document.getElementById('cardLabel').textContent=`PhotoNotes Measuring Card. Black square: ${side} in (${(side*25.4).toFixed(1)} mm) per side. Print at 100%.`;
const sizes=document.getElementById('sizes');
for(const [value,info] of Object.entries(SIZES)){const a=document.createElement('a');a.href='?size='+value;a.textContent=info.label;if(Number(value)===side)a.setAttribute('aria-current','true');sizes.append(a);}
const style=document.createElement('style');style.textContent=`@page{size:${SIZES[side].paper};margin:0.4in}`;document.head.append(style);
document.getElementById('printCard').onclick=()=>window.print();
})();
