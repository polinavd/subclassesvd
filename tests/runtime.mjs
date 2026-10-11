import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const hooks={};const once={};const results=[];const id='grimnir-lyonesse';
const context={console,setTimeout,clearTimeout,structuredClone,fetch:async()=>({json:async()=>[]}),Hooks:{on:(k,v)=>hooks[k]=v,once:(k,v)=>once[k]=v},foundry:{utils:{deepClone:structuredClone},applications:{api:{DialogV2:{wait:async()=>null}}}},game:{modules:new Map([[id,{}]]),settings:{register(){},get(){return{};}},user:{id:'gm',isGM:true},users:{activeGM:{id:'gm'}},release:{generation:13},time:{worldTime:0},actors:[],i18n:{localize:s=>s}},ui:{notifications:{error:e=>{throw Error(e)},warn(){},info(){}}},CONFIG:{DND5E:{skills:{},damageTypes:{acid:1,force:1,psychic:1}},statusEffects:[]},ChatMessage:{getSpeaker:()=>({}),create:async()=>{}},canvas:{tokens:{controlled:[]}},Roll:class{},Actor:{},fromUuid:async()=>null};
vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../scripts/main.mjs', import.meta.url),'utf8'),context);once.init();
assert.equal(typeof context.game.modules.get(id).api.manage,'function');results.push('API registration');
function actor(lv,n){return{system:{attributes:{movement:{walk:30}}},classes:{barbarian:{system:{levels:lv}}},getFlag:(_id,k)=>k==='nearbyEnemies'?n:null,items:[{getFlag:(_id,k)=>k==='feature'?'Strength of One':null}],effects:[]};}
for(const [lv,n,expected]of[[3,0,19],[3,2,18],[9,3,18],[10,3,17]]){
 const a=actor(lv,n),config={subject:{actor:a,attack:{type:{value:'melee',classification:'weapon'}}},rolls:[{options:{criticalSuccess:20}}]};hooks['dnd5e.preRollAttackV2'](config);assert.equal(config.rolls[0].options.criticalSuccess,expected);
 config.subject.attack.type.value='ranged';config.rolls[0].options.criticalSuccess=20;hooks['dnd5e.preRollAttackV2'](config);assert.equal(config.rolls[0].options.criticalSuccess,20);
}results.push('Provoked thresholds by level and enemy count; ranged unaffected');
const already={subject:{actor:actor(10,3),attack:{type:{value:'melee',classification:'weapon'}}},rolls:[{options:{criticalSuccess:16}}]};hooks['dnd5e.preRollAttackV2'](already);assert.equal(already.rolls[0].options.criticalSuccess,16);results.push('Better existing critical threshold preserved');
const changes={};hooks.applyActiveEffect(actor(3,0),{key:'system.attributes.movement.swim',value:'gl-swim:2'},10,null,changes);assert.equal(changes['system.attributes.movement.swim'],60);results.push('Swim scaling');
const ignore={};hooks.applyActiveEffect(actor(3,0),{key:'system.attributes.movement.swim',value:'30'},10,null,ignore);assert.deepEqual(ignore,{});results.push('Foreign custom effects left unchanged');
// Test actual menu -> resource spending -> effect creation with cancellation and insufficient resource.
let chosen='slip';context.foundry.applications.api.DialogV2.wait=async()=>chosen;
let created=[],spent=0;
const slip={system:{uses:{value:2,spent:0}},getFlag:(_id,k)=>k==='feature'?'Slip the Skin':null,update:async u=>{spent=u['system.uses.spent'];slip.system.uses.spent=spent;slip.system.uses.value=2-spent;}};
const a={uuid:'Actor.test',name:'Test',isOwner:true,items:[slip],effects:[],system:{abilities:{wis:{mod:2}}},getFlag:()=>null,deleteEmbeddedDocuments:async()=>{},createEmbeddedDocuments:async(_t,ds)=>{created.push(...ds);return ds.map(x=>({...x,id:'new'}));}};
context.canvas.tokens.controlled=[{actor:a}];await context.game.modules.get(id).api.manage();assert.equal(spent,1);assert.equal(created.length,1);assert.equal(created[0].duration.seconds,60);results.push('Slip the Skin consumes exactly once and creates timed effect');
chosen=null;await context.game.modules.get(id).api.manage();assert.equal(spent,1);assert.equal(created.length,1);results.push('Cancelled dialog is read-only');
// Insufficient resource should not create effects.
chosen='slip';slip.system.uses.value=0;let errors=[];context.ui.notifications.error=e=>errors.push(e);await context.game.modules.get(id).api.manage();assert.equal(created.length,1);assert.equal(errors.length,1);results.push('Insufficient resource blocks activation');
console.log(JSON.stringify({passed:results.length,tests:results},null,2));