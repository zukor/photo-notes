const crypto = require('node:crypto');
const express = require('express');

const MAX_FILE = 20 * 1024 * 1024;
const TYPES = {
  pdf: ['pdf', 'application/pdf'],
  docx: ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  bundle: ['zip', 'application/zip'],
};
function validFile(data, format) {
  return Object.hasOwn(TYPES,format) && Buffer.isBuffer(data) && data.length > 4 && data.length <= MAX_FILE &&
    (format === 'pdf' ? data.subarray(0, 5).toString() === '%PDF-' :
      !!TYPES[format] && data.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])));
}
function safeName(value, format) {
  const ext = TYPES[format][0];
  const base = String(value || 'Document').replace(/\.[^.]+$/, '').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '').trim().slice(0, 120);
  return (base || 'Document') + '.' + ext;
}
function registerDocumentLinks(app, {pool, requireAuth}) {
  const noCache = (req, res, next) => {
    res.set({'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer', 'X-Robots-Tag':'noindex, nofollow'});
    next();
  };
  app.use('/api/document-links', noCache);
  app.use('/shared-document', noCache);
  // A custom header and a non-simple content type prevent cross-site form posts.
  const writeGuard = (req, res, next) => req.get('X-Photo-Notes-Share') === '1'
    ? next() : res.status(403).json({error:'Please create or revoke links from Photo Notes.'});
  const parser = express.raw({type:'application/octet-stream', limit:MAX_FILE});
  app.post('/api/document-links', requireAuth, writeGuard, (req,res,next) =>
    parser(req,res,error => error ? res.status(error.status === 413 ? 413 : 400).json({error:'The file could not be uploaded. Links support files up to 20 MB.'}) : next()),
  async (req,res) => {
    const format = String(req.query.format || '');
    if (!validFile(req.body,format)) return res.status(400).json({error:'Choose a PDF, Word, or ZIP document up to 20 MB.'});
    const filename = safeName(req.query.name,format);
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      // Serialize quota checks for the owner, including concurrent requests.
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
      await client.query('DELETE FROM document_share_links WHERE user_id=$1 AND expires_at<=now()',[req.user.id]);
      const usage = (await client.query('SELECT count(*)::int count,COALESCE(sum(octet_length(content)),0)::bigint bytes FROM document_share_links WHERE user_id=$1',[req.user.id])).rows[0];
      if (usage.count >= 20 || Number(usage.bytes) + req.body.length > 100 * 1024 * 1024) {
        await client.query('ROLLBACK');
        return res.status(409).json({error:'Revoke an existing shared link before creating another. The limit is 20 links or 100 MB.'});
      }
      const token = crypto.randomBytes(32).toString('base64url');
      const row = (await client.query(`INSERT INTO document_share_links(user_id,token,filename,mime_type,content,expires_at)
        VALUES($1,$2,$3,$4,$5,now()+interval '7 days') RETURNING id,filename,expires_at`,
        [req.user.id,token,filename,TYPES[format][1],req.body])).rows[0];
      await client.query('COMMIT');
      res.status(201).json({...row,path:'/shared-document/'+token});
    } catch {
      if(client) await client.query('ROLLBACK').catch(()=>{});
      res.status(500).json({error:'Could not create the link. Please try again.'});
    } finally {client?.release();}
  });
  app.get('/api/document-links', requireAuth, async(req,res)=>{
    try {
      const rows = (await pool.query(`SELECT id,token,filename,expires_at FROM document_share_links
        WHERE user_id=$1 AND expires_at>now() ORDER BY id DESC`,[req.user.id])).rows;
      res.json(rows.map(({token,...row})=>({...row,path:'/shared-document/'+token})));
    } catch {res.status(500).json({error:'Could not load shared links.'});}
  });
  app.delete('/api/document-links/:id', requireAuth, writeGuard, async(req,res)=>{
    if(!/^[1-9]\d*$/.test(req.params.id))return res.status(400).json({error:'Invalid link.'});
    try {
      const result = await pool.query('DELETE FROM document_share_links WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);
      res.status(result.rowCount ? 200 : 404).json(result.rowCount ? {ok:true} : {error:'Link not found.'});
    } catch {res.status(500).json({error:'Could not revoke the link.'});}
  });
  app.get('/shared-document/:token', async(req,res)=>{
    if(!/^[A-Za-z0-9_-]{43}$/.test(req.params.token)) return res.status(404).send('This document link is unavailable or has expired.');
    try {
      // Snapshot bytes never depend on subsequent edits to the original document.
      const row = (await pool.query(`SELECT d.filename,d.mime_type,d.content FROM document_share_links d
        JOIN users u ON u.id=d.user_id WHERE d.token=$1 AND d.expires_at>now() AND u.active=true`,[req.params.token])).rows[0];
      if(!row)return res.status(404).send('This document link is unavailable or has expired.');
      res.set('Content-Security-Policy',"default-src 'none'; sandbox");
      res.type(row.mime_type).attachment(row.filename).send(row.content);
    } catch {res.status(503).send('The document is temporarily unavailable. Please try again.');}
  });
  // Snapshots expire even if the owner never returns. Revoking deletes immediately.
  const cleanup = setInterval(()=>pool.query('DELETE FROM document_share_links WHERE expires_at<=now()').catch(()=>{}),3600000);
  cleanup.unref();
  return ()=>clearInterval(cleanup);
}
module.exports = {registerDocumentLinks, validFile, safeName};
