// Existing light-mode layout assertions use the fallback when a theme variable is unset.
module.exports=css=>css.replace(/var\(--pn-[a-z0-9-]+,(#[0-9a-f]+)\)/g,'$1');
