import crypto from 'node:crypto';import fs from 'node:fs';import {git,verifyLive} from './core.mjs';
const files={};for(const f of ['app.js','styles.css','i18n.js','send.js','sw.js'])files[f]=crypto.createHash('sha256').update(fs.readFileSync('public/'+f)).digest('hex');
const result=await verifyLive(git(['rev-parse','HEAD']),files);console.log('Live deployment identity, database health and five asset hashes verified:',result.deployment);
