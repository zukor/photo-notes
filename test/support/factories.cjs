'use strict';
const {randomUUID}=require('node:crypto');
const {EDITIONS}=require('../../editions');
const editionIds=['basic','pro','paving','concrete','hoa','property','contractor','roofer','issue','roads'];
function user(edition='pro',overrides={}){if(!EDITIONS[edition])throw Error('Unknown edition '+edition);return {id:1,email:randomUUID()+'@example.invalid',name:'Automated Tester',active:true,role:'user',...EDITIONS[edition],edition_access:[edition],...overrides};}
function capture(overrides={}){return {photo_title:'Synthetic field evidence',note:'Deterministic fixture',area_tags:['Equipment'],urgency:'urgent',custom_fields:[{id:randomUUID(),name:'Surface',value:'Concrete'}],concrete_element:'slab',subject_latitude:29.4,subject_longitude:-98.5,...overrides};}
module.exports={editionIds,user,capture};
