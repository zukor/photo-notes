const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../public/precision-measure-engine.js'),A=require('../scripts/precision-measure-accuracy.cjs');
const PM=require('../precision-measure.js');

test('homography maps the four card corners exactly and inverts',()=>{
  const src=[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],dst=[{x:10,y:20},{x:210,y:30},{x:205,y:220},{x:5,y:215}];
  const H=E.homography(src,dst),Hi=E.invert(H);
  src.forEach((p,i)=>{const q=E.apply(H,p.x,p.y);assert.ok(Math.hypot(q.x-dst[i].x,q.y-dst[i].y)<1e-6);const r=E.apply(Hi,q.x,q.y);assert.ok(Math.hypot(r.x-p.x,r.y-p.y)<1e-6);});
});

test('outline measurement: area, and the saw-cut rectangle around it',()=>{
  const m=E.measureOutline([{x:0,y:0},{x:600,y:0},{x:600,y:300},{x:0,y:300}]);
  assert.equal(Math.round(m.areaMm2),180000);assert.equal(Math.round(m.lengthMm),600);assert.equal(Math.round(m.widthMm),300);
  const tri=E.measureOutline([{x:0,y:0},{x:400,y:0},{x:0,y:300}]);assert.equal(Math.round(tri.areaMm2),60000);
});

test('coaching: too far, too close, off center, too steep, then ready',()=>{
  const sq=(cx,cy,s)=>[{x:cx-s,y:cy-s},{x:cx+s,y:cy-s},{x:cx+s,y:cy+s},{x:cx-s,y:cy+s}];
  const f=(o)=>E.assessFrame({width:1000,height:750,steady:true,...o});
  assert.equal(f({corners:null}).state,'no_card');
  assert.equal(f({corners:sq(500,375,20),tilt:2}).state,'too_far');
  assert.equal(f({corners:sq(500,375,200),tilt:2}).state,'too_close');
  assert.equal(f({corners:sq(60,375,60),tilt:2}).state,'near_edge');
  assert.equal(f({corners:sq(500,375,60),tilt:20}).state,'tilted');
  assert.equal(f({corners:sq(500,375,60),tilt:12}).capturable,true);
  assert.equal(f({corners:sq(500,375,60),tilt:12}).ready,false);
  assert.equal(f({corners:sq(500,375,60),tilt:4,steady:false}).state,'hold_still');
  assert.equal(f({corners:sq(500,375,60),tilt:4}).ready,true);
  assert.equal(f({corners:sq(500,375,60),tilt:4,phoneTilt:18}).state,'tilted','the phone sensor also counts');
});

test('synthetic photos: the card is found and pothole sizes are about 99% accurate',()=>{
  const S=152.4,results=[];
  for(const [tilt,height,az] of [[0,1000,30],[6,1200,120],[10,1000,250]])results.push(A.trial({W:1600,Hh:1200,hfov:69.4,height,tilt,az,S,seed:tilt+height,clickNoisePx:1}));
  for(const r of results){assert.equal(r.detected,true);assert.ok(r.length>=98.5&&r.width>=98.5&&r.area>=97.5,JSON.stringify(r));assert.ok(Math.abs(r.estTilt-r.tilt)<2,JSON.stringify(r));}
});

test('field test results are validated and summarized against the tape',()=>{
  assert.equal(PM.validationDetail({app:{length_mm:600},tape:{length_mm:600}}),null);
  const d=PM.validationDetail({app:{length_mm:606,width_mm:300},tape:{length_mm:600,width_mm:300},edges:'clean',tilt_deg:4},'UA');
  assert.equal(d.edges,'clean');
  const s=PM.summarize([{id:1,created_at:'2026-10-18',detail:d}]);
  assert.equal(s.overall.measurements,1);assert.equal(s.overall.mean,99.5);assert.equal(s.overall.within1,100);assert.equal(s.clean.measurements,1);
});
