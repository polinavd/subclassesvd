const ID = 'grimnir-lyonesse';
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = x => foundry.utils.deepClone(x);
const level = (a,c) => Number(a.classes?.[c]?.system.levels ?? 0);
const mod = (a,k) => Number(a.system.abilities[k]?.mod ?? 0);
const feature = (a,n) => a.items.find(i => i.getFlag(ID,'feature') === n);
const has = (a,n) => Boolean(feature(a,n));
const change = (key,mode,value) => ({key,mode,value:String(value),priority:20});
const stat = (a,k) => a.getFlag(ID,k);
const primary = () => !game.users.activeGM || game.users.activeGM.id === game.user.id;
const allEffects = a => game.modules.get(ID).api?.effects?.(a) ?? [...a.effects,...Array.from(a.items).flatMap(i=>Array.from(i.effects??[]))];
const activeEffect = (a,key) => allEffects(a).find(e=>!e.disabled&&!e.isSuppressed&&e.getFlag(ID,'key')===key);
function actor() { const a = canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character; if (!a?.isOwner) throw Error('Выделите свой токен или назначьте персонажа пользователю.'); return a; }
async function choose(title,options,help='') {
 if (!options.length) return null;
 return foundry.applications.api.DialogV2.wait({window:{title},content:`<p>${help}</p><select name="choice" style="width:100%">${options.map(([v,t])=>`<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select>`,buttons:[{action:'ok',label:'Выбрать',default:true,callback:(_e,b)=>b.form.elements.choice.value},{action:'cancel',label:'Отмена',callback:()=>null}],rejectClose:false});
}
async function number(title,min,max,initial=min) {
 const r=await foundry.applications.api.DialogV2.wait({window:{title},content:`<input name="amount" type="number" min="${min}" max="${max}" value="${initial}">`,buttons:[{action:'ok',label:'Применить',default:true,callback:(_e,b)=>b.form.elements.amount.value},{action:'cancel',label:'Отмена',callback:()=>null}],rejectClose:false});
 if(r===null || r===undefined) return null; const n=Number(r);if(!Number.isInteger(n)||n<min||n>max)throw Error(`Нужно целое число от ${min} до ${max}.`);return n;
}
async function chat(a,title,text) { if(/вручную|макрос|Midi|карточк|кнопк|флаг|не выда|систем|Штатн|штатн/.test(text))text=''; return ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:a}),content:`<h3>${esc(title)}</h3><p>${text}</p>`}); }
function resource(a,ident) { return a.items.find(i=>i.type==='feat' && i.system.identifier===ident); }
function available(i) { return game.modules.get(ID).api?.usesFor?.(i).value ?? Number(i?.system.uses?.value ?? (Number(i?.system.uses?.max ?? 0)-Number(i?.system.uses?.spent??0))); }
async function spend(i,n=1) {
 if(!i)throw Error('Не найден ресурс способности.');
 if(available(i)<n)throw Error(`Недостаточно использований: ${i.name}.`);
 await i.update({'system.uses.spent':Number(i.system.uses.spent??0)+n});
}
async function remove(a,key) { if(game.modules.get(ID).api?.endEffect)return game.modules.get(ID).api.endEffect(a,key);const ids=a.effects.filter(e=>e.getFlag(ID,'key')===key).map(e=>e.id);if(ids.length)await a.deleteEmbeddedDocuments('ActiveEffect',ids); }
async function apply(a,key,name,changes=[],seconds=null,flags={},statuses=[]) {
 if(game.modules.get(ID).api?.setEffect)return game.modules.get(ID).api.setEffect(a,key,name,changes,seconds,flags,statuses);
 await remove(a,key);
 const e={name,img:feature(a,name)?.img??'modules/grimnir-lyonesse/assets/icons/lorc-rune-stone.svg',origin:feature(a,flags.feature)?.uuid??a.uuid,transfer:false,disabled:false,changes,statuses,flags:{[ID]:{managed:true,key,...flags}},duration:{}};
 if(seconds)e.duration={seconds,startTime:game.time.worldTime};
 return (await a.createEmbeddedDocuments('ActiveEffect',[e]))[0];
}
async function tempHP(a,n) {if(n>Number(a.system.attributes.hp.temp??0))await a.update({'system.attributes.hp.temp':n});}
async function roll(a,formula,label) {const r=await new Roll(formula,a.getRollData()).evaluate();await r.toMessage({speaker:ChatMessage.getSpeaker({actor:a}),flavor:label});return r;}
function midi(a,key,value=1){
 if(key.startsWith('advantage.skill.'))return change('system.skills.'+key.split('.').at(-1)+'.roll.mode',2,1);
 if(key.startsWith('advantage.ability.save.'))return change('system.abilities.'+key.split('.').at(-1)+'.save.roll.mode',2,1);
 if(key==='advantage.concentration')return change('system.attributes.concentration.roll.mode',2,1);
 return change('flags.'+ID+'.'+({'grants.disadvantage.attack.all':'grantsAttackDisadvantage','grants.fail.critical.all':'noCritical'}[key]??key),5,value);
}
function skillOptions(){return Object.entries(CONFIG.DND5E.skills).map(([k,v])=>[k,game.i18n.localize(v.label)]);}
async function temporarySkill(a,expert=false) {
 const sk=await choose(expert?'Ancient Memory — Expertise':'Hymnal Memory — Proficiency',skillOptions());if(!sk)return;
 await apply(a,expert?'ancient-memory':'hymnal-memory',expert?'Ancient Memory':'Hymnal Memory',[change(`system.skills.${sk}.value`,4,expert?2:1)],null,{rest:'lr'});
}
async function purify(a,kind) {
 const conditions=kind==='resonant'?['paralyzed','stunned']:kind==='archimandrite'?['incapacitated','paralyzed','stunned']:['charmed','frightened','poisoned'];
 const valid=conditions.filter(s=>a.statuses.has(s));
 const s=await choose('Purifying Breath / Voice Beyond Flesh',valid.map(x=>[x,game.i18n.localize(CONFIG.statusEffects.find(e=>e.id===x)?.name??x)]),'Применяйте только в момент, разрешённый текстом способности.');if(!s)return;
 await spend(resource(a,kind==='resonant'?'monks-focus':'bardic-inspiration'));
 await a.toggleStatusEffect(s,{active:false});
}
async function senses(a) {
 const k=await choose('Enhanced Senses',[['darkvision','Darkvision 120 ft'],['blindsight','Blindsight 10 ft'],['tremorsense','Tremorsense 30 ft'],['off','Снять']]);if(!k)return;
 if(k==='off')return remove(a,'enhanced-senses');
 await apply(a,'enhanced-senses','Enhanced Senses',[change(`system.attributes.senses.${k}`,4,{darkvision:120,blindsight:10,tremorsense:30}[k])],null,{endUnconscious:true});
}
async function ironArmor(a) {
 const form=await choose('Ironwood Armor',[['leaves','Mantle of Leaves'],['branches','Unbreakable Branches'],['off','Снять броню']]);if(!form)return;
 if(form==='off'){await remove(a,'iron-armor-leaves');await remove(a,'iron-armor-branches');return remove(a,'iron-armor');}
 await remove(a,'iron-armor');await remove(a,form==='leaves'?'iron-armor-branches':'iron-armor-leaves');
 const ch=[change('system.attributes.ac.calc',5,'custom'),change('system.attributes.ac.formula',5,'10 + @abilities.dex.mod + @abilities.cha.mod'),change('system.traits.dr.value',2,'bludgeoning'),change('system.traits.armorProf.value',2,'shl')];
 if(form==='leaves')ch.push(midi(a,'advantage.skill.ste'),change('system.attributes.movement.walk',2,5));
 else ch.push(midi(a,'grants.fail.critical.all'));
 await apply(a,'iron-armor-'+form,'Ironwood Armor: '+form,ch);
}
async function colossus(a) {
 if(!activeEffect(a,'iron-armor')&&!activeEffect(a,'iron-armor-leaves')&&!activeEffect(a,'iron-armor-branches'))throw Error('Сначала используйте Ironwood Armor.');
 await spend(feature(a,'Colossus of the Ironwood'));
 await apply(a,'colossus','Colossus of the Ironwood',[change('system.traits.size',5,'lg')],600);
 await tempHP(a,5*level(a,'warlock'));
 await chat(a,'Colossus','Форма включена на 10 минут. Добавляйте 3d6 Force отдельной кнопкой способности не чаще одного раза за ход.');
}
async function slip(a) {
 await spend(feature(a,'Slip the Skin'));
 const ch=[midi(a,'advantage.ability.save.dex')];
 if(activeEffect(a,'selkie-release'))for(const s of ['grappled','prone','restrained'])ch.push(change('system.traits.ci.value',2,s));
 await apply(a,'slip-skin','Slip the Skin',ch,60);
 await chat(a,'Slip the Skin','Преимущество Dex saves включено (Midi-QOL). Помеха opportunity attacks и особенности перемещения — по тексту.');
}
async function avatar(a) {
 await spend(feature(a,'Avatar of the Archangel'));const lv=level(a,'warlock');
 const ch=['mwak','rwak','msak','rsak'].map(t=>change(`system.bonuses.${t}.damage`,2,'1d8[radiant]'));
 if(lv>=10){ch.push(change('system.traits.dr.value',2,'psychic'));for(const s of ['charmed','frightened'])ch.push(change('system.traits.ci.value',2,s));}
 if(lv>=14)for(const t of Object.keys(CONFIG.DND5E.damageTypes).filter(x=>x!=='force'))ch.push(change('system.traits.dr.value',2,t));
 await tempHP(a,2*lv);await apply(a,'avatar','Avatar of the Archangel',ch,null,{endNoTemp:true});
 await chat(a,'Avatar of the Archangel','Форма включена; урон Divine Fire — отдельной кнопкой. Свет токена и видимость в магической тьме выставьте вручную. При потере всех временных HP эффект снимается. Если заменяете их другим источником, завершите форму вручную.');
}
async function wyrd(a) {
 const f=feature(a,'Wyrd Time');
 if(available(f)>0)await spend(f);else await spend(resource(a,'font-of-magic'),5);
 const ch=[change('system.attributes.movement.walk',1,2),change('system.attributes.movement.fly',1,2),change('system.attributes.movement.swim',1,2),change('system.attributes.movement.climb',1,2),change('system.attributes.movement.burrow',1,2),midi(a,'grants.disadvantage.attack.all'),...['str','dex','con','int','wis','cha'].map(k=>change('system.abilities.'+k+'.save.roll.mode',2,1))];
 await apply(a,'wyrd-time','Wyrd Time',ch,Math.max(0,mod(a,'cha'))*6,{endConditions:['grappled','incapacitated','prone','paralyzed','petrified','restrained','stunned','unconscious']});
 await chat(a,'Wyrd Time','Скорость и защиты включены. Завершите форму через макрос сразу после воздействия на другого. Возможные Help/Hide/Utilize не выдаются как дополнительная отдельная Action.');
}
async function extendWyrd(a){const e=activeEffect(a,'wyrd-time');if(!e)throw Error('Wyrd Time не активно.');await spend(resource(a,'font-of-magic'),1);await e.update({'duration.seconds':Number(e.duration.seconds??0)+6});}
async function plate(a){
 const type=await choose('Consecrated Plate — physical resistance',[['bludgeoning','Bludgeoning'],['piercing','Piercing'],['slashing','Slashing'],['off','Снять']],'Только при надетой освящённой Half Plate / Plate.');if(!type)return;if(type==='off')return remove(a,'saint-plate');
 const armors=Array.from(a.items).filter(i=>i.type==='equipment'&&['halfplate','plate'].includes(i.system.type?.baseItem));if(!armors.length)throw Error('Добавьте Half Plate или Plate Armor в снаряжение.');
 const armorId=await choose('Consecrated Plate',armors.map(i=>[i.id,i.name]));if(!armorId)return;
 const ch=[change('system.traits.dr.value',2,'necrotic'),change('system.traits.dr.value',2,type)];if(has(a,'Saints that Came Before'))ch.push(change('system.attributes.ac.bonus',2,2));
 await apply(a,'saint-plate','Consecrated Plate',ch,null,{armorId,wanted:true});await game.modules.get(ID).api.syncEffects?.(a);
}
async function virtues(a){
 const opts=[['charity','Charity'],['faith','Faith'],['honor','Honor'],['hope','Hope'],['humility','Humility'],['prudence','Prudence']];const selected=[];
 for(let i=0;i<3;i++){const x=await choose(`Добродетель ${i+1}/3`,opts.filter(([k])=>!selected.includes(k)));if(!x)return;selected.push(x);}
 const e=await apply(a,'virtues','Shield of Seven Virtues: '+selected.join(', '),[],null,{virtues:selected});
 await game.modules.get(ID).api.syncScene?.();
 await chat(a,'Seven Virtues','Выбраны добродетели: '+selected.join(', ')+'.');
}
async function auraFlags(e,a){
 if(!game.modules.get('ActiveAuras')?.active){ui.notifications.warn('Аура применена к владельцу.');return;}
 await e.update({'flags.ActiveAuras':{isAura:true,aura:'Allies',radius:level(a,'paladin')>=18?'30':'10',alignment:'',type:'',ignoreSelf:false,height:false,hidden:false,displayTemp:false,hostile:false,onlyOnce:false}});
}
async function executionAura(a){const e=await apply(a,'execution-aura','Aura of the Executioner',['mwak','rwak','msak','rsak'].map(t=>change(`system.bonuses.${t}.attack`,2,1)));await game.modules.get(ID).api.syncScene?.();}
async function fate(a){
 const prev=stat(a,'fateStyle');let opts=['order','balance','mayhem'];
 if(prev==='balance')opts=['order','mayhem'];else if(prev)opts=[prev,'balance'];
 if(level(a,'monk')>=17 && prev==='balance')opts=['order','mayhem'];
 const style=await choose('Path of Fate — выбор при Initiative',opts.map(x=>[x,x]));if(!style)return;
 await a.setFlag(ID,'fateStyle',style);await remove(a,'fate-style');await remove(a,'chosen-motion');
 await apply(a,'fate-style','Path of Fate: '+style,[],null,{fateStyle:style,endCombat:true});
 if(level(a,'monk')>=11 && style!=='balance'){
  const types=style==='order'?['cold','radiant']:['lightning','thunder'];const ch=types.map(t=>change('system.traits.dr.value',2,t));
  if(style==='order')ch.push(change('system.attributes.movement.walk',2,10));else ch.push(change('system.attributes.movement.fly',4,a.system.attributes.movement.walk));
  await apply(a,'chosen-motion','Chosen in Motion: '+style,ch,60);
 }
 await chat(a,'Path of Fate',`Выбран ${style}. Применено собственное сопротивление/движение с 11 уровня. Аура критов союзников, погода, альтернативный тип урона и условные бонусы Mayhem — вручную. Смена через World-Thread Mastery требует отдельно потратить 1 Focus.`);
}
async function rage(a,presetPhase){
 const phase=presetPhase??await choose('Path of the Provoked',[['start','Начать Rage и выбрать эффекты'],['nearby','Указать число врагов в пределах 5 ft'],['end','Завершить: снять эффекты/сбросить очки']]);if(!phase)return;
 if(phase==='nearby'){const n=await number('Враги в пределах 5 ft',0,30);if(n!==null)await a.setFlag(ID,'nearbyEnemies',n);return;}
 if(phase==='end'){await remove(a,'provoked');const r=resource(a,'rage');for(const e of r?.effects??[])if(e.transfer&&!e.disabled)await e.update({disabled:true},{grimnirCards:true});await a.setFlag(ID,'provokedPoints',0);return;}
 const chosen={};for(const [lv,key] of [[3,'strength'],[6,'dominance'],[14,'reckoning']])if(level(a,'barbarian')>=lv){chosen[key]=await choose(key,[['stoic','Stoic'],['wrathful','Wrathful'],['wild','Wild']]);if(!chosen[key])return;}
 const base=resource(a,'rage');if(!base)throw Error('Добавьте Rage базового класса варвара.');
 if(!Array.from(base.effects??[]).some(e=>e.transfer&&!e.disabled&&!e.isSuppressed)){
  const ac=Array.from(base.system.activities??[]).find(x=>x.type==='utility');if(!ac)throw Error('У Rage отсутствует действие.');
  const used=await ac.use({grimnirCards:true});if(!used)return;
  for(const e of base.effects??[])if(e.transfer)await e.update({disabled:false,'duration.startTime':game.time.worldTime},{grimnirCards:true});
 }
 const ch=[];if(chosen.dominance==='wrathful')ch.push(change('system.skills.itm.value',4,2));
 if(chosen.dominance==='stoic')await chat(a,'Stoic Dominance','Преимущество только против Charmed/Frightened: включайте в соответствующем спасброске.');
 await apply(a,'provoked','Provoked Rage: '+Object.values(chosen).join(' / '),ch,600,{choices:chosen});await a.setFlag(ID,'provokedPoints',0);for(const i of a.items.filter(i=>i.getFlag(ID,'pointPool')))await i.update({'system.uses.spent':level(a,'barbarian')>=16?4:level(a,'barbarian')>=9?3:2},{grimnirCards:true});
 await chat(a,'Provoked Rage','Rage активируйте штатной способностью класса. Условные реакции и Reckoning — по тексту. После раннего окончания Rage снимите эффект этим макросом.');
}
async function provokedPoints(a){
 const current=Number(stat(a,'provokedPoints')??0);const max=level(a,'barbarian')>=16?4:level(a,'barbarian')>=9?3:2;
 const pool=a.items.find(i=>i.getFlag(ID,'pointPool'));const n=await number('Provoked Points — реакция +1 / расход при попадании',0,max,pool?available(pool):current);if(n!==null){await a.setFlag(ID,'provokedPoints',n);for(const i of a.items.filter(i=>i.getFlag(ID,'pointPool')))await i.update({'system.uses.spent':max-n},{grimnirCards:true});}
}
async function glimpse(a){const r=await roll(a,'3d20','Glimpse the Future');const values=r.dice[0].results.map(x=>x.result);await a.setFlag(ID,'glimpse',values);await chat(a,'Glimpse',values.join(', ')+'. Результаты заменяют инициативу по правилам способности; при выходе из боя очистите запись.');}
async function bestow(a){const opts=['clumsy','feeble','slow'];if(level(a,'bard')>=6)opts.push('bold','sturdy');const fate=await choose('Bestow Fate — после расхода Inspiration и провала Charisma save',opts.map(x=>[x,x]));if(!fate)return;
 const r=await roll(a,'@scale.bard.inspiration','Bestow Fate: '+fate);if(fate==='slow'){const t=[...game.user.targets][0]?.actor;if(!t?.isOwner)throw Error('Выберите цель, которую можете редактировать. Ведущая может выполнить макрос от лица барда.');await apply(t,'bestow-slow-'+a.id,'Bestow Fate: Slow',Object.entries(t.system.attributes.movement).filter(([k,v])=>['walk','fly','swim','climb','burrow'].includes(k)&&Number(v)>0).map(([k,v])=>change(`system.attributes.movement.${k}`,5,Math.max(5,v-5*r.total))),60);}
 else await chat(a,'Bestow Fate',`${fate}: примените ${r.total} к соответствующему броску по тексту способности.`);
}
async function intention(a){
 const pick=await choose('Arcane Intentions',[['dreamer','Dreamer'],['seeker','Seeker']],'Выбор на 3 уровне; смена разрешена на 6, 10 и 14.');if(!pick)return;await a.setFlag(ID,'intention',pick);
 if(pick==='seeker')await apply(a,'seeker-expertise','Seeker: Investigation Expertise',[change('system.skills.inv.value',4,2)]);else await remove(a,'seeker-expertise');
 const f=feature(a,'Core Intention');await f.update({'system.uses.max':pick==='dreamer'?'max(1,@abilities.int.mod)':'1','system.uses.recovery':[{period:'lr',type:'recoverAll'}]});
 await chat(a,'Arcane Intentions',`Выбрано ${pick}. Счётчик Core Intention настроен. При использовании нажмите «Потратить Core Intention»; Seeker дополнительно тратит слот.`);
}
async function pushLuck(a){
 const f=feature(a,'Push Your Luck');if(available(f)<1)throw Error('Push Your Luck уже использовано.');
 const adv=Boolean(stat(a,'pushLuckAdv'));const rolls=await a.rollAbilityCheck({ability:'wis',rolls:[{options:{advantage:adv}}]},{},{data:{flavor:'Push Your Luck: DC 15'}});if(!rolls?.length)return;const r=rolls[0];await spend(f);
 if(r.total>=15){const updates={};for(const [k,v]of Object.entries(a.system.spells))if(/^spell\d+$/.test(k))updates[`system.spells.${k}.value`]=v.max;
 await a.update(updates);const w=feature(a,'Wrath of Divinity');if(w)await w.update({'system.uses.spent':0});await a.unsetFlag(ID,'pushLuckAdv');}
 else {await a.update({'system.attributes.exhaustion':Number(a.system.attributes.exhaustion??0)+1});await a.setFlag(ID,'pushLuckAdv',true);}
}
async function bind(a){
 const target=[...game.user.targets][0]?.actor;if(!target?.isOwner)throw Error('Выберите токен вассала с правом редактирования.');
 const n=await number('Уровень потраченного Summon spell slot',1,9);if(n===null)return;
 await apply(a,'blood-binding','Blood Binding — HP maximum',[change('system.attributes.hp.max',2,-2*n)],null,{vassal:target.uuid});
 await apply(target,'vassal-bonus-'+a.id,'Vassal: Intelligence bonus',['mwak','rwak','msak','rsak'].map(t=>change(`system.bonuses.${t}.damage`,2,mod(a,'int'))),null,{master:a.uuid});
 await a.setFlag(ID,'vassal',target.uuid);if(a.system.attributes.hp.value>a.system.attributes.hp.max)await a.update({'system.attributes.hp.value':a.system.attributes.hp.max});
 await chat(a,'Blood Binding','Максимум HP снижен, бонус к урону вассала добавлен. Слот расходуется при Summon. При завершении концентрации нажмите «Завершить Blood Binding». При Planar Binding сначала сверьте текст исключения.');
}
async function unbind(a){const u=stat(a,'vassal');if(u){const v=await fromUuid(u);if(v?.isOwner)await remove(v,'vassal-bonus-'+a.id);}await remove(a,'blood-binding');await a.unsetFlag(ID,'vassal');}
async function endEffect(a){const opts=allEffects(a).filter(e=>!e.disabled&&e.getFlag(ID,'managed')).map(e=>[e.id,e.name]);const x=await choose('Завершить эффект',opts);if(x){const e=allEffects(a).find(e=>e.id===x);if(e?.getFlag(ID,'key'))await remove(a,e.getFlag(ID,'key'));}}
async function companion(a,kind){
 if(!game.user.can('ACTOR_CREATE'))throw Error('Создание спутника требует права Create Actor; выполните от ведущей.');
 const pack=game.packs.get(`${ID}.companions`);const docs=await pack.getDocuments();let template;
 if(kind==='wolf')template=docs.find(x=>x.getFlag(ID,'template')==='wolf');
 if(kind==='soul')template=docs.find(x=>x.getFlag(ID,'template')==='soul');
 if(kind==='dragon')template=docs.find(x=>x.getFlag(ID,'template')===(level(a,'druid')>=10?'juvenile':'hatchling'));
 if(!template)throw Error('Нет карточки спутника.');
 const d=template.toObject();delete d._id;d.name=`${template.name} — ${a.name}`;d.ownership=clone(a.ownership);d.flags[ID]={...d.flags[ID],master:a.uuid};
 d.prototypeToken={...d.prototypeToken,actorLink:true,name:d.name};
 let sp=0;
 if(kind==='wolf'){
  d.system.attributes.hp={value:15+5*level(a,'ranger'),max:15+5*level(a,'ranger')};d.system.attributes.ac={calc:'flat',flat:14+mod(a,'wis')};
  d.system.bonuses={abilities:{check:String(a.system.attributes.prof),save:String(a.system.attributes.prof),skill:''}};
  const bite=d.items.find(x=>x.name==='Bite');const at=Object.values(bite.system.activities)[0];at.attack.flat=true;at.attack.bonus=String(2+a.system.attributes.prof);at.damage.parts[0].custom.formula=`1d6 + ${3+mod(a,'wis')}`;
  if(level(a,'ranger')>=11){const aspect=await choose('Wolf Aspect',[['frost','Frost Wolf'],['forest','Forest Wolf']]);if(!aspect)return;if(aspect==='frost')at.damage.parts.push({custom:{enabled:true,formula:'1d4'},types:['cold']});else d.system.attributes.init={bonus:'',ability:'',roll:{mode:1}};}
 }
 if(kind==='soul'){
  const f=feature(a,'Companions from the Before');if(available(f)<1)throw Error('Нет использований призыва.');
  sp=await number('Sorcery Points на дополнительные HP',0,Math.max(0,available(resource(a,'font-of-magic'))));if(sp===null)return;
  const hp=10+5*sp;d.system.attributes.hp={value:hp,max:hp};
  for(const i of d.items)for(const at of Object.values(i.system.activities??{}))if(at.type==='attack'){
   at.attack.flat=true;at.attack.bonus=String(mod(a,'cha')+a.system.attributes.prof);
   at.damage.parts[0].custom.formula=(i.name==='Interfere'?'1d4':level(a,'sorcerer')>=14?'2d12':'2d8')+` + ${mod(a,'cha')}`;
  }
  if(level(a,'sorcerer')<6)d.items=d.items.filter(i=>!['Thrash','Reduce Harm'].includes(i.name));
  d.flags[ID].escapeDC=8+mod(a,'cha')+a.system.attributes.prof;
  // Payment follows all prompts and precedes creation. Errors are refunded below.
  await spend(f);if(sp)try{await spend(resource(a,'font-of-magic'),sp);}catch(e){await f.update({'system.uses.spent':f.system.uses.spent-1});throw e;}
 }
 if(kind==='dragon'){
  const lv=level(a,'druid');if(lv<6){d.system.attributes.movement.fly=0;d.items=d.items.filter(x=>x.name!=='Multiattack');}
  for(const i of d.items)for(const ac of Object.values(i.system.activities??{})){
   if(lv>=10 && ac.attack){ac.attack.flat=true;ac.attack.bonus=String(mod(a,'wis')+a.system.attributes.prof);}
   if(lv>=10 && ac.save){ac.save.dc={calculation:'',formula:String(8+mod(a,'wis')+a.system.attributes.prof)};}
   if(lv>=14 && i.name==='Acid Breath')ac.damage.parts[0].custom.formula+=` + ${lv}`;
  }
 }
 try{
  const prior=game.actors.find(x=>x.getFlag(ID,'master')===a.uuid&&x.getFlag(ID,'template')===d.flags[ID].template);
  if(prior && kind!=='soul'){
   // Preserve damage and existing embedded IDs; replace only known template items.
   const deficit=Math.max(0,prior.system.attributes.hp.max-prior.system.attributes.hp.value);d.system.attributes.hp.value=Math.max(0,d.system.attributes.hp.max-deficit);
   const oldItems=prior.items.filter(i=>i.getFlag(ID,'templateItem')).map(i=>i.id);
   await prior.update({system:d.system,name:d.name});if(oldItems.length)await prior.deleteEmbeddedDocuments('Item',oldItems);await prior.createEmbeddedDocuments('Item',d.items);prior.sheet.render(true);
  }else{
   if(kind==='soul'&&prior)await chat(a,'Misplaced Soul','Предыдущую душу уберите со сцены: одновременно может существовать только одна.');
   const c=await Actor.create(d);c.sheet.render(true);
  }
 }catch(e){if(kind==='soul'){const f=feature(a,'Companions from the Before');await f.update({'system.uses.spent':Math.max(0,f.system.uses.spent-1)});if(sp){const r=resource(a,'font-of-magic');await r.update({'system.uses.spent':Math.max(0,r.system.uses.spent-sp)});}}throw e;}
 if(kind==='dragon')await chat(a,'Dragon form','Создана карточка формы. Перетащите её на лист персонажа и выберите штатный Wild Shape: так сохраняются правила Wild Shape 2024. Расход Wild Shape — штатной кнопкой класса.');
 else await chat(a,'Спутник','Карточка готова в Actors. Перетащите на сцену. Срок призыва, команды, условные черты и совместные эффекты проверяйте по описанию.');
}
function actionHandlers(){return {end:endEffect,rage,rageStart:x=>rage(x,'start'),points:provokedPoints,senses,armor:ironArmor,colossus,slip,avatar,wyrd,extend:extendWyrd,plate,virtues,execution:executionAura,fate,glimpse,bestow,intention,luck:pushLuck,bind,unbind,skill:x=>temporarySkill(x),expert:x=>temporarySkill(x,true),purify:x=>purify(x,'eparch'),voice:x=>purify(x,'archimandrite'),resonant:x=>purify(x,'resonant'),wolf:x=>companion(x,'wolf'),soul:x=>companion(x,'soul'),dragon:x=>companion(x,'dragon'),core:x=>spend(feature(x,'Core Intention')),release:x=>apply(x,'selkie-release','Selkie’s Release',[],null,{endConcentration:true}),ability:async x=>{const v=await choose('True Believer — spellcasting ability',[['int','Intelligence'],['wis','Wisdom']]);if(v){const i=x.items.find(i=>i.type==='subclass'&&i.getFlag(ID,'subclass')==='True Believer');await i.update({'system.spellcasting.ability':v});for(const spell of x.items.filter(s=>s.type==='spell'&&s.system.sourceClass==='rogue'))await spell.update({'system.ability':v});const wrath=feature(x,'Wrath of Divinity');if(wrath)for(const card of x.items.filter(s=>s.id===wrath.id||s.getFlag(ID,'parentIdentifier')===wrath.system.identifier)){const u={};for(const ac of card.system.activities??[])if(ac.type==='save')u[`system.activities.${ac.id}.save.dc.calculation`]=v;if(Object.keys(u).length)await card.update(u);}}}};}
const busy = new Set();
async function manage(){let a,locked=false;try{
 a=actor();if(busy.has(a.uuid))return;busy.add(a.uuid);locked=true;
 const options=[['sync','Обновить карточки персонажа'],['end','Завершить эффект']];
 const add=(n,id,label)=>{if(has(a,n))options.push([id,label]);};
 add('Strength of One','rage','Provoked: ярость / соседние враги');add('Strength of One','points','Provoked Points');add('Enhanced Senses','senses','Enhanced Senses');add('Armor of the Ironwood','armor','Ironwood Armor');add('Colossus of the Ironwood','colossus','Colossus');add('Slip the Skin','slip','Slip the Skin');add('Avatar of the Archangel','avatar','Avatar of the Archangel');add('Wyrd Time','wyrd','Начать Wyrd Time');add('Wyrd Time','extend','Продлить Wyrd Time за 1 SP');add('Sevenfold Path','plate','Consecrated Plate');add('Sevenfold Path','virtues','Три добродетели');add('Aura of the Executioner','execution','Aura of the Executioner');add('Path of Fate','fate','Path of Fate');add('Glimpse the Future','glimpse','Glimpse: бросить 3d20');add('Bestow Fate','bestow','Bestow Fate: результат судьбы');add('Arcane Intentions','intention','Выбрать Dreamer / Seeker');add('Core Intention','core','Потратить Core Intention');add('Push Your Luck','luck','Push Your Luck');add('Wolf Companion','wolf','Создать / обновить волка');add('Companions from the Before','soul','Призвать Misplaced Soul');add('Dragon Soul','dragon','Подготовить форму дракона');add('Blood Binding','bind','Blood Binding: связать вассала');add('Blood Binding','unbind','Завершить Blood Binding');add('Eparch','skill','Hymnal Memory');add('Eparch','purify','Purifying Breath (bard)');add('Archimandrite','expert','Ancient Memory');add('Archimandrite','voice','Voice Beyond Flesh');add('Resonant Body','resonant','Purifying Breath (monk)');add('Spellcasting','ability','True Believer: Int / Wis');add('Selkie’s Release','release','Selkie’s Release');

 const action=await choose(a.name+' — подкласс',options,'');if(!action)return;
 const handlers={...actionHandlers(),sync:x=>game.modules.get(ID).api.syncCards(x)};
 await handlers[action](a);
}catch(e){console.error(ID,e);ui.notifications.error(e.message);}finally{if(a&&locked)busy.delete(a.uuid);}}
async function audit(){
 const errors=[],counts={};
 for(const name of ['grimnir','lyonesse','companions','macros','spells']){
  const p=game.packs.get(`${ID}.${name}`);if(!p){errors.push('Отсутствует pack '+name);continue;}
  const docs=await p.getDocuments();counts[name]=docs.length;
  for(const d of docs){try{d.validate({strict:true});}catch(e){errors.push(`${d.name}: ${e.message}`);}
   if(['subclass','feat'].includes(d.type))for(const ad of d.system.advancement??[])if(ad.type==='ItemGrant')for(const e of ad.configuration.items??[])if(!await fromUuid(e.uuid))errors.push(`${d.name}: broken UUID ${e.uuid}`);
  }
 }
 return foundry.applications.api.DialogV2.wait({window:{title:'Grimnir / Lyonesse — проверка'},content:`<p>${esc(JSON.stringify(counts))}</p><pre style="white-space:pre-wrap">${esc(errors.join('\n')||'Ошибок схем и UUID не обнаружено.')}</pre>`,buttons:[{action:'ok',label:'Закрыть'}],rejectClose:false});
}
Hooks.once('init',()=>{
 game.modules.get(ID).api={manage,audit,useAction:async(a,name)=>{const handler=actionHandlers()[name];if(!handler)throw Error('Действие недоступно: '+name);return handler(a);}};
});
// A custom mode is limited to our explicit prefix; no global movement hooks.
Hooks.on('applyActiveEffect',(a,c,current,delta,changes)=>{
 if(!String(c.value).startsWith('gl-swim:'))return;
 const result=Math.max(Number(current)||0,Number(a.system.attributes.movement.walk||0)*Number(c.value.split(':')[1]));changes[c.key]=result;
});
Hooks.on('dnd5e.preRollAttackV2',config=>{
 const ac=config.subject,a=ac?.actor;if(!a)return;
 let threshold=20;
 if(has(a,'Strength of One') && ac.attack?.type.value==='melee' && ac.attack?.type.classification!=='spell'){
  const n=Number(stat(a,'nearbyEnemies')??0);threshold=level(a,'barbarian')>=10 && n>=3?17:n>=2?18:19;
 }
 const fate=activeEffect(a,'fate-style')?.getFlag(ID,'fateStyle');
 if(fate==='order' && (ac.item?.system.properties?.has('fin')||ac.attack?.type.classification==='unarmed'))threshold=Math.min(threshold,18);
 for(const r of config.rolls??[]) {r.options??={};if(activeEffect(a,'colossus') && ['simpleM','simpleR','martialM','martialR'].includes(ac.item?.system.type?.value))r.options.advantage=true;r.options.criticalSuccess=Math.min(r.options.criticalSuccess??20,threshold);}
});
async function cleanup(a){
 if(!primary())return;
 const gone=allEffects(a).filter(e=>{const f=e.flags[ID];if(!f?.managed||e.disabled||e.isSuppressed)return false;
  return (f.endNoTemp && !a.system.attributes.hp.temp)||(f.endUnconscious&&a.statuses.has('unconscious'))||(f.endConditions?.some(x=>a.statuses.has(x)))||(e.duration.seconds!==undefined && e.duration.remaining<=0);
 });for(const e of gone){if(e.getFlag(ID,'preset'))await e.update({disabled:true});else await e.delete();}
}
Hooks.on('updateActor',(a)=>{cleanup(a).catch(console.error);});
Hooks.on('createActiveEffect',e=>{if(e.parent?.documentName==='Actor')cleanup(e.parent).catch(console.error);});
Hooks.on('updateWorldTime',()=>{if(primary())for(const a of game.actors)cleanup(a).catch(console.error);});
Hooks.on('updateCombat',()=>{if(primary())for(const c of game.combat?.combatants??[])if(c.actor)cleanup(c.actor).catch(console.error);});
Hooks.on('dnd5e.restCompleted',async(a,data)=>{if(!a.isOwner)return;const ids=a.effects.filter(e=>e.getFlag(ID,'rest')==='lr'&&data.longRest).map(e=>e.id);if(ids.length)await a.deleteEmbeddedDocuments('ActiveEffect',ids);});
Hooks.on('dnd5e.endConcentration',async(a)=>{if(primary()&&activeEffect(a,'selkie-release')){await remove(a,'selkie-release');await remove(a,'slip-skin');}});
