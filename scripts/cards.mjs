const ID='grimnir-lyonesse',VERSION='0.3.0';
const actorLocks=new Map(),timers=new Map(),attackOptions=new Map();
const clone=x=>foundry.utils.deepClone(x);
const flag=(i,k)=>i.getFlag?.(ID,k)??i.flags?.[ID]?.[k];
const list=x=>x?.values?Array.from(x.values()):Array.isArray(x)?x:Object.values(x??{});
const owner=a=>a?.isOwner&&(game.users.activeGM?game.users.activeGM.id===game.user.id:true);
const classLevel=(a,c)=>Number(a.classes?.[c]?.system.levels??0);
const sourceId=i=>i.getFlag?.('dnd5e','sourceId')??i.flags?.dnd5e?.sourceId;
async function choose(title,options){if(!options.length)throw Error('Нет подходящих карточек.');return foundry.applications.api.DialogV2.wait({window:{title},content:`<select name="choice">${options.map(([v,n])=>`<option value="${String(v).replace(/"/g,'&quot;')}">${String(n).replace(/[<>]/g,'')}</option>`).join('')}</select>`,buttons:[{action:'ok',label:'Выбрать',default:true,callback:(_e,b)=>b.form.elements.choice.value},{action:'cancel',label:'Отмена',callback:()=>null}],rejectClose:false});}
async function spend(i,n=1){if(!i)throw Error('Не найден ресурс.');const uses=i.system.uses;const available=game.modules.get(ID).api.usesFor?.(i).value??Number(uses.value??Number(uses.max??0)-Number(uses.spent??0));if(available<n)throw Error(`Недостаточно использований: ${i.name}`);await i.update({'system.uses.spent':Number(uses.spent??0)+n});}
function parent(a,item){return list(a.items).find(i=>i.system.identifier===flag(item,'parentIdentifier'));}
function templateUuid(i){return `Compendium.${ID}.${flag(i,'setting')}.Item.${i._id??i.id}`;}
async function patchCard(item,template){
 const s=template.system??{};const updates={img:template.img,'system.description':clone(s.description),...('activities' in s?{'system.activities':clone(s.activities)}:{}),[`flags.${ID}`]:{...clone(item.flags?.[ID]??{}),...clone(template.flags[ID])}};
 const existingEffects=list(item.effects);
 const supplied=template.effects??[];
 updates.effects=supplied.map(e=>{const old=existingEffects.find(x=>(x.id??x._id)===e._id||flag(x,'key')&&flag(x,'key')===e.flags?.[ID]?.key);return {...clone(e),...(old?{_id:old.id??old._id,disabled:old.disabled,duration:clone(old.duration??{}),flags:{...clone(e.flags),[ID]:{...clone(e.flags?.[ID]),...clone(old.flags?.[ID])}}}:{})};});
 updates.effects.push(...existingEffects.filter(e=>!e.flags?.[ID]&&!supplied.some(s=>s._id===(e.id??e._id))).map(e=>e.toObject?.()??clone(e)));
 if(item.type==='spell')for(const k of ['ability','sourceClass','method','prepared','properties','activation','duration','materials'])if(k in s)updates[`system.${k}`]=clone(s[k]);
 if(item.type==='weapon')for(const k of ['damage','range','type','proficient','properties'])if(k in s)updates[`system.${k}`]=clone(s[k]);
 if(s.uses?.max!==undefined){updates['system.uses.max']=s.uses.max;updates['system.uses.recovery']=clone(s.uses.recovery??[]);}
 if(flag(item,'feature')==='Core Intention'&&flag(item.actor,'intention')){updates['system.uses.max']=flag(item.actor,'intention')==='dreamer'?'max(1,@abilities.int.mod)':'1';updates['system.uses.recovery']=[{period:'lr',type:'recoverAll'}];}
 if(['feat','subclass'].includes(item.type)&&s.advancement){
  const values=new Map(list(item.system.advancement).map(x=>[x._id??x.id,x.value]));
  updates['system.advancement']=s.advancement.map(x=>({...clone(x),value:clone(values.get(x._id)??x.value??{})}));
 }
 await item.update(updates);
}
async function syncActor(a){
 if(!owner(a)||Object.values(ui.windows??{}).some(w=>w.constructor.name==='AdvancementManager'&&w.actor?.uuid===a.uuid))return;
 if(actorLocks.has(a.uuid))return actorLocks.get(a.uuid);
 const promise=(async()=>{
  let added=0;
  const features=list(a.items).filter(i=>i.type==='feat'&&flag(i,'feature'));
  for(const sub of list(a.items).filter(i=>i.type==='subclass'&&flag(i,'setting')&&flag(i,'version')!==VERSION)){const pack=game.packs.get(`${ID}.${flag(sub,'setting')}`);const idx=list(await pack.getIndex({fields:['system.identifier']}));const entry=idx.find(i=>i.system?.identifier===sub.system.identifier);if(entry){const t=(await pack.getDocument(entry._id??entry.id)).toObject();await patchCard(sub,t);}}
  for(const f of features){
   const setting=flag(f,'setting');const pack=game.packs.get(`${ID}.${setting}`);if(!pack)continue;
   // Original embedded IDs differ from their compendium IDs; use the immutable identifier.
   const index=await pack.getIndex({fields:['system.identifier']});
   const entry=list(index).find(d=>d.system?.identifier===f.system.identifier);if(!entry)continue;
   const template=(await pack.getDocument(entry._id??entry.id)).toObject();
   if(flag(f,'version')!==VERSION)await patchCard(f,template);
   const lv=classLevel(a,flag(f,'class'));const pending=[];
   for(const grant of template.flags[ID].children??[]){
    if(lv<grant.level)continue;
    const source=await fromUuid(grant.uuid);if(!source)throw Error(`Не найдена карточка ${grant.uuid}`);
    const data=source.toObject();
    const existing=list(a.items).find(i=>sourceId(i)===grant.uuid||i.system.identifier===data.system.identifier&&flag(i,'parentIdentifier')===f.system.identifier||data.type==='spell'&&i.name===data.name&&i.system.sourceClass===data.system.sourceClass);
    if(existing){if(flag(existing,'version')!==VERSION)await patchCard(existing,data);if(sourceId(existing)===grant.uuid&&!flag(existing,'grantedBy'))await existing.setFlag(ID,'grantedBy',f.id);continue;}
    delete data._id;delete data._key;delete data.folder;delete data.ownership;
    data.flags??={};data.flags.dnd5e={...data.flags.dnd5e,sourceId:grant.uuid};data.flags[ID]={...data.flags[ID],grantedBy:f.id};
    pending.push(data);
   }
   // Sequential creation lets a simultaneous native Advancement grant win without duplicates.
   for(const data of pending){
    if(list(a.items).some(i=>sourceId(i)===data.flags.dnd5e.sourceId))continue;
    await a.createEmbeddedDocuments('Item',[data]);added++;
   }
   const grants=list(f.system.advancement).filter(ad=>ad.type==='ItemGrant'&&Number(ad.level)<=lv);const updates={};
   for(const ad of grants){const value={...clone(ad.value??{}),added:{...clone(ad.value?.added??{})}};let changed=false;for(const g of ad.configuration.items??[]){const i=list(a.items).find(i=>sourceId(i)===g.uuid&&flag(i,'grantedBy')===f.id);if(i&&value.added[i.id]!==g.uuid){value.added[i.id]=g.uuid;changed=true;}}if(changed)updates[`system.advancement.${ad.id??ad._id}.value`]=value;}
   if(Object.keys(updates).length){const advancement=list(f.system.advancement).map(ad=>{const id=ad.id??ad._id,v=updates[`system.advancement.${id}.value`];return {...(ad.toObject?.()??clone(ad)),...(v?{value:v}:{})};});await f.update({'system.advancement':advancement},{grimnirCards:true});}
  }
  const cleric=features.find(i=>flag(i,'feature')==='Spellcasting'&&flag(i,'subclass')==='True Believer');
  if(cleric)for(const i of list(a.items).filter(i=>i.type==='spell'&&String(i.getFlag?.('dnd5e','advancementOrigin')??'').startsWith(cleric.id+'.')))if(i.system.sourceClass!=='rogue')await i.update({'system.sourceClass':'rogue','system.prepared':2});
  if(features.some(i=>flag(i,'feature')==='Master of Chains'))for(const spell of list(a.items).filter(i=>i.type==='spell'&&/^Summon /.test(i.name)&&i.system.sourceClass==='wizard')){
   for(const ac of list(spell.system.activities).filter(x=>x.type==='summon')){
    const profiles=list(ac.profiles).map(clone);let changed=false;
    for(const [id,name,uuid] of [['glBoneDevil00001','Bone Devil','95ec9155dff31431'],['glChainDevil0001','Chain Devil','c0d4a893e0505a76']]){
     const target=`Compendium.${ID}.companions.Actor.${uuid}`;if(profiles.some(x=>x.uuid===target))continue;
     profiles.push({_id:id,name,uuid:target,count:'1',level:{min:7,max:null}});changed=true;
    }if(changed)await spell.update({[`system.activities.${ac.id??ac._id}.profiles`]:profiles});
   }
  }
  await game.modules.get(ID).api.syncResources?.(a);
  await game.modules.get(ID).api.syncEffects?.(a);
  return added;
 })();actorLocks.set(a.uuid,promise);try{return await promise;}finally{actorLocks.delete(a.uuid);}
}
function queue(item,options={}){if(options.grimnirCards||!item.actor||!owner(item.actor))return;if(!['class','subclass','feat'].includes(item.type))return;const a=item.actor;clearTimeout(timers.get(a.uuid));timers.set(a.uuid,setTimeout(()=>{timers.delete(a.uuid);syncActor(a).catch(e=>{console.error(ID,e);ui.notifications.error(e.message);});},1500));}
Hooks.on('createItem',queue);Hooks.on('updateItem',queue);
Hooks.on('dnd5e.preAdvancementManagerRender',manager=>{const a=manager.actor;if(a){clearTimeout(timers.get(a.uuid));timers.delete(a.uuid);}});
Hooks.on('dnd5e.advancementManagerComplete',manager=>{if(manager.actor)syncActor(manager.actor).catch(e=>console.error(ID,e));});
Hooks.on('deleteItem',async item=>{
 if(!item.actor||!owner(item.actor)||!flag(item,'feature'))return;
 const ids=list(item.actor.items).filter(i=>flag(i,'grantedBy')===item.id).map(i=>i.id);
 if(ids.length)await item.actor.deleteEmbeddedDocuments('Item',ids);
});
Hooks.once('ready',async()=>{for(const a of game.actors)if(owner(a))await syncActor(a).catch(e=>console.error(ID,e));});
async function ownEffect(a,key,name,changes,seconds){
 if(game.modules.get(ID).api.setEffect)return game.modules.get(ID).api.setEffect(a,key,name,changes,seconds);
 const old=list(a.effects).filter(e=>flag(e,'key')===key).map(e=>e.id);if(old.length)await a.deleteEmbeddedDocuments('ActiveEffect',old);
 return a.createEmbeddedDocuments('ActiveEffect',[{name,img:`modules/${ID}/assets/icons/lorc-rune-stone.svg`,transfer:false,changes,flags:{[ID]:{key,managed:true}},duration:seconds?{seconds,startTime:game.time.worldTime}:{}}]);
}
async function weaponAttack(a,item){
 const names=flag(item,'weaponNames'),kind=flag(item,'weaponKind');
 const items=list(a.items).filter(i=>i.type==='weapon'||i.type==='feat'&&list(i.system.activities).some(x=>x.type==='attack'&&x.attack?.type?.classification==='unarmed'));
 const options=[];
 for(const i of items)for(const ac of list(i.system.activities)){
  if(ac.type!=='attack')continue;if(names&&!names.includes(i.name))continue;
  if(flag(i,'requiresForm')==='primal-arm'&&(!hasEffect(a,'primal-arm')||flag(a,'primalArm')!==i.name))continue;
  if(kind&&kind!=='any'&&ac.attack?.type?.value!==kind)continue;
  options.push([ac.uuid,`${i.name}${ac.name&&ac.name!==i.name?' — '+ac.name:''}`]);
 }
 const selected=await choose(item.name,options);if(!selected)return;
 const ac=await fromUuid(selected);if(!ac)throw Error('Атака недоступна.');
 const p=parent(a,item);if(flag(item,'spendParent'))await spend(p);
 const used=await rollOwnedAttack(a,ac,{advantage:Boolean(flag(item,'advantage')),maximize:Boolean(flag(item,'maximize'))});
 if(!used&&flag(item,'spendParent'))await p.update({'system.uses.spent':Math.max(0,p.system.uses.spent-1)});
 return used;
}
async function rollOwnedAttack(a,ac,options={}){
 const key=`${a.uuid}.${ac.item?.id}`;attackOptions.set(key,options);
 try{
  if(game.modules.get('midi-qol')?.active&&globalThis.MidiQOL?.completeActivityUse){
   const workflow=await MidiQOL.completeActivityUse(ac.uuid,{grimnirCards:true,midiOptions:{advantage:options.advantage,workflowOptions:{autoRollAttack:true,autoRollDamage:'onHit'}}});
   return Boolean(workflow&&!workflow.aborted&&(workflow.attackRoll||workflow.attackRolls?.length));
  }
  const rolls=await ac.rollAttack({rolls:[{options:{...(options.advantage?{advantage:true}:{})}}]});
  if(!rolls?.length)return false;if(rolls.some(r=>r.isSuccess!==false))await ac.rollDamage({isCritical:rolls.some(r=>r.isCritical)});return true;
 }finally{attackOptions.delete(key);}
}
Hooks.on('dnd5e.preRollAttackV2',config=>{
 const ac=config.subject,o=ac?.actor&&attackOptions.get(`${ac.actor.uuid}.${ac.item.id}`);
 if(o?.advantage)for(const r of config.rolls??[]){r.options??={};r.options.advantage=true;}
});
Hooks.on('dnd5e.postDamageRollConfiguration',(rolls,config)=>{
 const ac=config.subject,o=ac?.actor&&attackOptions.get(`${ac.actor.uuid}.${ac.item.id}`);
 if(o?.maximize)for(const r of rolls){const evaluate=r.evaluate.bind(r);r.evaluate=options=>evaluate({...options,maximize:true});}
});
async function primalArm(a,item){
 const name=await choose('Primal Arm',[['Bone Club','Bone Club'],['Bladed Claw','Bladed Claw'],['Poisonous Barbs','Poisonous Barbs'],['off','Завершить']]);if(!name)return;
 if(name==='off'){if(game.modules.get(ID).api.endEffect)await game.modules.get(ID).api.endEffect(a,'primal-arm');else{const ids=list(a.effects).filter(e=>flag(e,'key')==='primal-arm').map(e=>e.id);if(ids.length)await a.deleteEmbeddedDocuments('ActiveEffect',ids);}return;}
 const ws=list(a.items).find(i=>i.system.identifier==='wild-shape');await spend(ws);await a.setFlag(ID,'primalArm',name);await ownEffect(a,'primal-arm','Primal Arm — '+name,[],3600);
 await a.updateEmbeddedDocuments('Item',list(a.items).filter(i=>flag(i,'requiresForm')==='primal-arm').map(i=>({_id:i.id,'system.equipped':i.name===name})));
}
async function vitality(a,item){const p=parent(a,item);await spend(p);const hp=Math.max(2,classLevel(a,'warlock')+Number(a.system.abilities.cha.mod));await a.update({'system.attributes.hp.temp':Math.max(hp,Number(a.system.attributes.hp.temp??0))});await ownEffect(a,'iron-vitality','Vitality',[{key:'system.attributes.movement.walk',mode:2,value:'5',priority:20}],600);}
async function shove(a,item){const targets=Array.from(game.user.targets??[]);const mode=await choose('Shove',[['prone','Prone'],['push','Push 10 feet']]);if(!mode)return;
 if(!targets.length)throw Error('Выберите цель.');
 const shield=list(a.items).some(i=>i.system.type?.value==='shield'&&i.system.equipped);
 const dc=8+Number(a.system.attributes.prof)+Number(a.system.abilities.str.mod);
 for(const token of targets){const target=token.actor;const ability=await choose(`${target.name} — Saving Throw`,[['str','Strength'],['dex','Dexterity']]);if(!ability)return;const rolls=await target.rollSavingThrow({ability,target:dc,disadvantage:shield||target.statuses.has('prone')});const r=Array.isArray(rolls)?rolls[0]:rolls;if(r&&r.total<dc&&mode==='prone'&&target.isOwner)await target.toggleStatusEffect('prone',{active:true});}
}
async function geyser(a,item){
 if(!hasEffect(a,'selkie-release'))throw Error('Сначала используйте Selkie’s Release.');
 const data={name:item.name,type:'feat',system:{activities:{glGeyserTemplate:{_id:'glGeyserTemplate',type:'utility',target:{template:{type:'line',size:'50',width:'5',units:'ft'}}}}}};
 const faux=new CONFIG.Item.documentClass(data,{parent:a});const cls=game.dnd5e?.canvas?.AbilityTemplate??dnd5e.canvas.AbilityTemplate;const activity=list(faux.system.activities)[0];const t=cls.fromActivity(activity);if(!t)return;
 t.document.updateSource({flags:{[ID]:{geyser:true,master:a.uuid}}});const placed=await t.drawPreview();
 if(placed?.length){const old=list(canvas.scene.templates).filter(x=>flag(x,'geyser')&&flag(x,'master')===a.uuid&&!placed.some(y=>y.id===x.id));if(old.length)await canvas.scene.deleteEmbeddedDocuments('MeasuredTemplate',old.map(x=>x.id));}
}
async function searchSpells(a,max){const found=[];for(const pack of game.packs){if(pack.documentName!=='Item'||pack.visible===false)continue;for(const i of list(await pack.getIndex({fields:['type','system.level','system.identifier']}))){if(i.type==='spell'&&/^Summon (Beast|Fey|Undead|Construct|Elemental|Aberration|Dragon|Draconic Spirit|Fiend|Shadowspawn)(?:$| —)/i.test(i.name)&&Number(i.system.level)<=max)found.push([`Compendium.${pack.collection}.Item.${i._id}`,i.name]);}}return found;}
async function chooseSummonSpell(a,item){const lv=classLevel(a,'wizard'),max=Math.ceil(lv/2);const limit=1+2*Math.max(0,max-2);if(list(a.items).filter(i=>flag(i,'savant')).length>=limit)throw Error('Все доступные заклинания Binding Savant уже выбраны.');const choices=await searchSpells(a,Math.min(max,lv===3?2:9));const uuid=await choose('Binding Savant',choices);if(!uuid)return;const source=await fromUuid(uuid);const data=source.toObject();delete data._id;delete data._key;delete data.folder;
 data.system.method='spell';data.system.sourceClass='wizard';data.system.ability='int';data.system.prepared=0;data.flags??={};data.flags[ID]={...data.flags[ID],savant:true};data.system.properties=Array.from(new Set([...data.system.properties,'concentration']));delete data.flags[ID].execute;delete data.flags[ID].parentFeature;delete data.flags[ID].parentIdentifier;data.system.activation.type='action';data.system.uses={max:'',spent:0,recovery:[]};
 for(const ac of Object.values(data.system.activities))ac.consumption={spellSlot:true,targets:[]};
 if(data.name.startsWith('Summon Beast')){data.name='Summon Beast';data.system.materials={value:'Gilded acorn with feather, fur and fish tail',cost:200,consumed:false,supply:0};data.system.properties=Array.from(new Set([...data.system.properties,'material']));}
 if(!list(a.items).some(i=>i.name===data.name))await a.createEmbeddedDocuments('Item',[data]);
}
async function vassalSpells(a,item){
 const vassals=list(game.actors).filter(v=>v.isOwner&&v.uuid!==a.uuid);const uuid=await choose('Spellbinding — Vassal',vassals.map(v=>[v.uuid,v.name]));if(!uuid)return;const v=await fromUuid(uuid);const type=String(v.system.details?.type?.value??'').toLowerCase();
 const names=['Augury','Clairvoyance','Divination','Dream',...({aberration:['Hallucinatory Terrain'],dragon:['Circle of Power'],fiend:['Teleportation Circle'],undead:['Speak with Dead']}[type]??[])];const max=Math.ceil(classLevel(a,'wizard')/2);const pack=game.packs.get(`${ID}.spells`);const index=list(await pack.getIndex({fields:['system.level']}));
 for(const name of names){const entry=index.find(x=>x.name===name);if(!entry||Number(entry.system.level)>max||list(v.items).some(x=>x.name===name&&flag(x,'vassalCaster')===a.uuid))continue;const d=(await pack.getDocument(entry._id)).toObject();delete d._id;delete d._key;delete d.folder;d.system.method='innate';d.system.prepared=2;d.system.ability='int';d.system.properties=list(d.system.properties).filter(x=>x!=='material');d.system.materials={value:'',cost:0,consumed:false,supply:0};d.flags[ID]={...d.flags[ID],vassalCaster:a.uuid,vassalCost:5+5*d.system.level};for(const ac of Object.values(d.system.activities)){ac.consumption.spellSlot=false;ac.consumption.targets=[{type:'attribute',target:'attributes.hp.max',value:String(5+5*d.system.level)}];}await v.createEmbeddedDocuments('Item',[d]);}
}
async function masterChains(a,item){
 await syncActor(a);
 const choices=[];for(const i of list(a.items))if(i.type==='spell'&&/^Summon /.test(i.name)&&i.system.sourceClass==='wizard')for(const ac of list(i.system.activities))if(ac.type==='summon')choices.push([ac.uuid,i.name]);
 const uuid=await choose('Master of Chains — Summon Spell',choices);if(!uuid)return;const ac=await fromUuid(uuid);
 const profile=await choose('Master of Chains',[['glBoneDevil00001','Bone Devil'],['glChainDevil0001','Chain Devil']]);if(!profile)return;
 return ac.use({spell:{slot:'spell7'},scaling:7-ac.item.system.level,summons:{profile}});
}
async function companionCommand(a,item){
 const soul=list(game.actors).filter(c=>c.isOwner&&flag(c,'master')===a.uuid&&flag(c,'template')==='soul').at(-1);if(!soul)throw Error('Сначала призовите Misplaced Soul.');
 const wanted=flag(item,'companionActivity');const actions=[];for(const i of list(soul.items))if(!wanted||i.name===wanted)for(const ac of list(i.system.activities))actions.push([ac.uuid,i.name+' — '+ac.name]);
 const uuid=await choose(item.name,actions);if(!uuid)return;const ac=await fromUuid(uuid);if(!ac)throw Error('Не найдена способность души.');
 const cost=Number(flag(item,'companionCost')??0),r=list(a.items).find(i=>i.system.identifier==='font-of-magic');if(cost)await spend(r,cost);
 try{const result=await ac.use();if(!result&&cost)await r.update({'system.uses.spent':Math.max(0,r.system.uses.spent-cost)});return result;}catch(e){if(cost)await r.update({'system.uses.spent':Math.max(0,r.system.uses.spent-cost)});throw e;}
}
async function primevalCall(a,item){
 const lv=await choose('Primeval Call — Lost Spell Level',Array.from({length:9},(_,i)=>[String(i+1),String(i+1)]));if(!lv)return;
 const ac=list(item.system.activities).find(x=>x.type==='summon');if(!ac)throw Error('Не найдена карточка призыва.');
 return ac.use({grimnirCards:true,scaling:Number(lv)-2,consume:{spellSlot:false}},{configure:true});
}
async function release(a,item){await spend(parent(a,item));return game.modules.get(ID).api.useAction(a,'release');}
const special={weaponAttack,primalArm,vitality,shove,geyser,chooseSummonSpell,vassalSpells,masterChains,primevalCall,release,companionCommand};
function hasEffect(a,key){return Boolean(game.modules.get(ID).api.effect?.(a,key)??list(a.effects).find(e=>!e.disabled&&!e.isSuppressed&&flag(e,'key')===key));}
async function attackAction(a,item){
 const kind=flag(item,'extraAttack');
 if(kind==='Primal Arm'&&!hasEffect(a,'primal-arm'))throw Error('Сначала выберите форму Primal Arm.');
 if(kind==='Woodland Ambusher'&&(!a.statuses.has('invisible')||game.combat?.round!==1))throw Error('Woodland Ambusher доступен в первом раунде при Invisible.');
 const weapons=list(a.items).filter(i=>i.type==='weapon'&&flag(i,'requiresForm')!=='primal-arm');
 const options=[];for(const w of weapons)for(const ac of list(w.system.activities))if(ac.type==='attack'&&(kind!=='Woodland Ambusher'||ac.attack?.type?.value==='ranged'))options.push([ac.uuid,w.name]);
 const uuid=await choose(item.name,options);if(!uuid)return;const ac=await fromUuid(uuid);if(!ac)throw Error('Атака недоступна.');
 const count=kind==='Woodland Ambusher'?2:list(a.items).some(i=>i.system.identifier==='extra-attack'||/^extra-attack-/.test(i.system.identifier))?(classLevel(a,'fighter')>=20?4:classLevel(a,'fighter')>=11?3:2):1;
 for(let n=0;n<count;n++)if(!await rollOwnedAttack(a,ac))return;
 if(kind==='Primal Arm'){
  const weapon=list(a.items).find(i=>flag(i,'requiresForm')==='primal-arm'&&i.name===flag(a,'primalArm'));
  const extra=list(weapon?.system.activities).find(x=>x.type==='attack');if(!extra)throw Error('Не найдено оружие Primal Arm.');await rollOwnedAttack(a,extra);
 }
}
special.attackAction=attackAction;
const useLocks=new Set();
async function execute(a,item,command){if(useLocks.has(a.uuid))return;useLocks.add(a.uuid);try{return await(special[command]?special[command](a,item):game.modules.get(ID).api.useAction(a,command));}finally{useLocks.delete(a.uuid);}}
Hooks.on('dnd5e.preUseActivity',(activity,usage={})=>{if(usage.grimnirCards)return;
 const i=activity.item,a=i.actor,command=flag(i,'execute');
 if(flag(i,'requiresForm')==='primal-arm'&&(!hasEffect(a,'primal-arm')||flag(a,'primalArm')!==i.name)){ui.notifications.warn('Выберите это оружие через Primal Arm.');return false;}
 if(flag(i,'vassalCost')&&Number(a.system.attributes.hp.max)<=flag(i,'vassalCost')){ui.notifications.warn('Недостаточно максимума HP.');return false;}
 if(!command)return;
 if(!a?.isOwner)return false;
 execute(a,i,command).catch(e=>{console.error(ID,e);ui.notifications.error(e.message);});return false;
});
Hooks.once('init',()=>{game.modules.get(ID).api.syncCards=syncActor;game.modules.get(ID).api.executeCard=execute;});
