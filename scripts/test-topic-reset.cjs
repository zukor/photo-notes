'use strict';
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {SQL}=require('../topic-reset');
const pool=new Pool({host:'/tmp',database:'postgres'});
(async()=>{
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query('CREATE SCHEMA topic_reset_fixture');
  await c.query('SET LOCAL search_path TO topic_reset_fixture');
  await c.query(`CREATE TABLE user_areas(user_id integer,name text,created_at timestamptz default now(),user_added boolean default false,primary key(user_id,name));
    CREATE TABLE captures(id integer,area_tags text[]);
    CREATE TABLE hoa_areas(id integer,name text);
    INSERT INTO user_areas(user_id,name,user_added) VALUES(1,'Roads',false),(1,'My custom topic',true),(2,'Other account',true);
    INSERT INTO captures VALUES(1,ARRAY['Roads','My custom topic']);
    INSERT INTO hoa_areas VALUES(1,'Roof');`);
  await c.query(SQL);
  assert.equal((await c.query('SELECT * FROM user_areas')).rowCount,0);
  assert.equal((await c.query('SELECT * FROM topic_list_reset_backup')).rowCount,3);
  assert.equal((await c.query('SELECT removed_count FROM topic_list_resets')).rows[0].removed_count,3);
  assert.deepEqual((await c.query('SELECT area_tags FROM captures')).rows[0].area_tags,['Roads','My custom topic']);
  assert.equal((await c.query('SELECT name FROM hoa_areas')).rows[0].name,'Roof');
  await c.query("INSERT INTO user_areas(user_id,name,user_added) VALUES(2,'New topic',true)");
  await c.query(SQL);
  assert.equal((await c.query('SELECT * FROM user_areas')).rowCount,1);
  assert.equal((await c.query('SELECT * FROM user_areas WHERE user_id=1')).rowCount,0);
  assert.equal((await c.query('SELECT * FROM topic_list_reset_backup')).rowCount,3);
  console.log('Topic reset passed: all accounts cleared once, backup retained, saved tags and specialist areas preserved, newly added topics survive restart.');
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
