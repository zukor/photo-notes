const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('missing close-zoom tiles retry lower-resolution imagery without moving the map',()=>{
 const source=fs.readFileSync('public/app.js','utf8'),context={setTimeout:fn=>fn()};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function installMapTileFallback'),source.indexOf('function loadLeaflet')),context);
 let handler,redraws=0;const layer={options:{maxNativeZoom:19},on:(type,fn)=>handler=fn,redraw:()=>redraws++},map={hasLayer:()=>true};context.installMapTileFallback(layer,map);
 handler({coords:{z:19}});assert.equal(layer.options.maxNativeZoom,18);assert.equal(redraws,1);handler({coords:{z:19}});assert.equal(redraws,1,'stale tile failures do not lower resolution again');handler({coords:{z:18}});assert.equal(layer.options.maxNativeZoom,17);handler({coords:{z:13}});assert.equal(layer.options.maxNativeZoom,17,'bounded fallback');
});
