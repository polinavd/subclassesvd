const ID = 'grimnir-lyonesse';
const list = x => x?.values ? Array.from(x.values()) : Array.isArray(x) ? x : Object.values(x ?? {});
const flag = (x, k) => x?.getFlag?.(ID, k) ?? x?.flags?.[ID]?.[k];
const clone = x => foundry.utils.deepClone(x);
const owner = a => a?.isOwner && (!game.users.activeGM || game.users.activeGM.id === game.user.id);
const effects = a => [...list(a?.effects), ...list(a?.items).flatMap(i => list(i.effects))];
const active = e => !e.disabled && !e.isSuppressed;
const effect = (a, key) => effects(a).find(e => flag(e, 'key') === key && active(e));
const feature = (a, name) => list(a.items).find(i => flag(i, 'feature') === name);
const lv = (a, c) => Number(a.classes?.[c]?.system.levels ?? 0);
const change = (key, value, mode = 2) => ({ key, value: String(value), mode, priority: 20 });

function usesFor(item) {
  const uses = item?.system?.uses ?? {};
  let max = Number(uses.max);
  if (!Number.isFinite(max)) {
    try {
      const formula = item._source?.system?.uses?.max ?? uses.max;
      max = new Roll(formula, item.getRollData?.() ?? item.actor?.getRollData?.() ?? {}).evaluateSync().total;
    } catch { max = 0; }
  }
  return { max: Math.max(0, max || 0), spent: Number(uses.spent ?? 0),
    value: Math.max(0, Number.isFinite(Number(uses.value)) ? Number(uses.value) : max - Number(uses.spent ?? 0)) };
}

const resourceLocks = new Map();
async function syncResources(a) {
  if (!owner(a)) return;
  if (resourceLocks.has(a.uuid)) return resourceLocks.get(a.uuid);
  const work = (async () => {
    for (const i of list(a.items)) {
      if(flag(i,'pointPool')){
        const max=usesFor(i).max,points=Math.max(0,Math.min(max,Number(flag(a,'provokedPoints')??0)));
        if(i.system.uses.spent!==max-points)await i.update({'system.uses.spent':max-points},{grimnirResources:true,grimnirCards:true});
      }
      const identifier = flag(i, 'resourceIdentifier');
      const p = identifier && list(a.items).find(x => x.system.identifier === identifier);
      if (!p || p === i) continue;
      const formula = p._source?.system?.uses?.max ?? p.system.uses?.max ?? '';
      const spent = Number(p.system.uses?.spent ?? 0);
      const updates = {};
      if (String(i._source?.system?.uses?.max ?? i.system.uses?.max ?? '') !== String(formula)) updates['system.uses.max'] = String(formula);
      if (Number(i.system.uses?.spent ?? 0) !== spent) updates['system.uses.spent'] = spent;
      if (i.system.uses?.recovery?.length) updates['system.uses.recovery'] = [];
      for (const ac of list(i.system.activities)) {
        const targets = list(ac.consumption?.targets).map(t => t.toObject?.() ?? clone(t));
        let changed = false;
        for (const t of targets) if (t.type === 'itemUses' && t.target &&
          (t.target === `feat:${identifier}` || t.target === identifier || t.target === p.id || !list(a.items).some(x => x.id === t.target))) {
          if (t.target !== p.id) { t.target = p.id; changed = true; }
        }
        if (changed) updates[`system.activities.${ac.id ?? ac._id}.consumption.targets`] = targets;
      }
      if (Object.keys(updates).length) await i.update(updates, { grimnirResources: true, grimnirCards: true });
    }
  })();
  resourceLocks.set(a.uuid, work);
  try { return await work; } finally { resourceLocks.delete(a.uuid); }
}

Hooks.on('updateItem', async (i, updates, options = {}) => {
  const a = i.actor;
  if (!owner(a) || options.grimnirResources) return;
  const identifier = flag(i, 'resourceIdentifier');
  const p = identifier && list(a.items).find(x => x.system.identifier === identifier);
  const spent = updates['system.uses.spent'] ?? updates.system?.uses?.spent;
  if(flag(i,'pointPool')&&spent!==undefined&&Number(flag(a,'provokedPoints')??0)!==usesFor(i).value)await a.setFlag(ID,'provokedPoints',usesFor(i).value);
  if (p && p !== i && spent !== undefined && !options.grimnirCards) {
    await p.update({ 'system.uses.spent': Number(spent) }, { grimnirResources: true, grimnirCards: true });
  }
  await syncResources(a);
});

async function setEffect(a, key, name, changes = [], seconds = null, flags = {}, statuses = []) {
  const matches = effects(a).filter(e => flag(e, 'key') === key);
  const preset = matches.find(e => flag(e, 'preset'));
  const data = { name, changes, statuses, disabled: false, duration: seconds ? { seconds, startTime: game.time.worldTime } : {},
    flags: { [ID]: { ...clone(preset?.flags?.[ID] ?? {}), managed: true, key, ...flags, ...(preset ? { preset: true } : {}) } } };
  if (preset) {
    for (const e of matches.filter(e => e !== preset)) await e.delete();
    await preset.update(data);
    return preset;
  }
  if (matches[0]) { await matches[0].update(data); return matches[0]; }
  return (await a.createEmbeddedDocuments('ActiveEffect', [{ ...data, transfer: false, origin: a.uuid,
    img: list(a.items).find(i => flag(i, 'feature') === flags.feature)?.img ?? `modules/${ID}/assets/icons/lorc-rune-stone.svg` }]))[0];
}
async function endEffect(a, key) {
  for (const e of effects(a).filter(e => flag(e, 'key') === key)) {
    if (flag(e, 'preset')) { if (!e.disabled) await e.update({ disabled: true }); }
    else await e.delete();
  }
}

function nativeChanges(changes) {
  return changes.flatMap(c => {
    const key = c.key.replace('flags.midi-qol.','');
    if (c.key.startsWith('flags.midi-qol.advantage.skill.')) return [change(`system.skills.${key.split('.').at(-1)}.roll.mode`,1)];
    if (c.key.startsWith('flags.midi-qol.advantage.ability.save.')) {
      const ability = key.split('.').at(-1);
      return (ability === 'all' ? ['str','dex','con','int','wis','cha'] : [ability]).map(k => change(`system.abilities.${k}.save.roll.mode`,1));
    }
    if (key === 'advantage.concentration') return [change('system.attributes.concentration.roll.mode',1)];
    if (key === 'grants.disadvantage.attack.all') return [change(`flags.${ID}.grantsAttackDisadvantage`,1,5)];
    if (key === 'grants.fail.critical.all') return [change(`flags.${ID}.noCritical`,1,5)];
    return [clone(c)];
  });
}
async function prepareEffects(a) {
  if (!owner(a)) return;
  for (const old of [...list(a.effects)]) {
    let key = flag(old,'key');
    if (!key || !flag(old,'managed') || flag(old,'auto')) continue;
    if (key === 'iron-armor') key += old.name.includes('leaves') ? '-leaves' : '-branches';
    const preset = list(a.items).flatMap(i => list(i.effects)).find(e => flag(e,'preset') && flag(e,'key') === key);
    if (!preset) continue;
    await preset.update({ disabled: old.disabled, changes: nativeChanges(old.changes ?? []), duration: clone(old.duration ?? {}), statuses: list(old.statuses),
      flags: { [ID]: { ...clone(preset.flags?.[ID]), ...clone(old.flags?.[ID]), key, preset:true } } }, { grimnirEffects:true });
    await old.delete();
  }
  for (const e of effects(a)) {
    const key = flag(e,'key');
    if (key === 'saint-plate') {
      const armor = flag(e,'armorId') && list(a.items).find(i => i.id === flag(e,'armorId'));
      if (armor && flag(e,'wanted')) {
        const disabled = !armor.system.equipped;
        if (e.disabled !== disabled) await e.update({ disabled }, { grimnirEffects:true });
      }
      const changes = (e.changes ?? []).filter(c => c.key !== 'system.attributes.ac.bonus');
      if (feature(a,'Saints that Came Before')) changes.push(change('system.attributes.ac.bonus',2));
      if (JSON.stringify(changes) !== JSON.stringify(e.changes)) await e.update({ changes }, { grimnirEffects:true });
    }
    if (key === 'avatar') {
      const changes = ['mwak','rwak','msak','rsak'].map(x=>change(`system.bonuses.${x}.damage`,'1d8[radiant]'));
      if (lv(a,'warlock')>=10) { changes.push(change('system.traits.dr.value','psychic')); for(const status of ['charmed','frightened'])changes.push(change('system.traits.ci.value',status)); }
      if (lv(a,'warlock')>=14)for(const type of Object.keys(CONFIG.DND5E.damageTypes).filter(x=>x!=='force'))if(type!=='psychic')changes.push(change('system.traits.dr.value',type));
      if (JSON.stringify(changes)!==JSON.stringify(e.changes))await e.update({ changes }, { grimnirEffects:true });
    }
  }
}
const effectLocks = new Map();
async function syncEffects(a) {
  if (effectLocks.has(a.uuid)) return effectLocks.get(a.uuid);
  const work = prepareEffects(a);effectLocks.set(a.uuid,work);
  try {return await work;} finally {effectLocks.delete(a.uuid);}
}

async function syncCompanions(a) {
  if (!owner(a)) return;
  const pb = Number(a.system.attributes.prof), wis = Number(a.system.abilities.wis?.mod ?? 0), cha = Number(a.system.abilities.cha?.mod ?? 0);
  for (const w of list(game.actors).filter(w=>owner(w)&&flag(w,'master')===a.uuid)) {
    if (flag(w,'template')==='wolf') {
      const max=15+5*lv(a,'ranger');const updates={};
      if(w._source?.system?.attributes?.ac?.flat!==14+wis)updates['system.attributes.ac.flat']=14+wis;
      if(w.system.attributes.hp.max!==max){updates['system.attributes.hp.max']=max;updates['system.attributes.hp.value']=Math.min(w.system.attributes.hp.value,max);}
      for(const type of ['check','save'])if(w.system.bonuses?.abilities?.[type]!==String(pb))updates[`system.bonuses.abilities.${type}`]=String(pb);
      if(Object.keys(updates).length)await w.update(updates,{grimnirCompanion:true});
      const bite=list(w.items).find(i=>i.name==='Bite');if(bite)for(const ac of list(bite.system.activities).filter(ac=>ac.type==='attack')){
        const u={};if(ac.attack.bonus!==String(2+pb))u[`system.activities.${ac.id??ac._id}.attack.bonus`]=String(2+pb);
        if(ac.damage.parts[0]?.custom?.formula!==`1d6 + ${3+wis}`){const parts=list(ac.damage.parts).map(p=>p.toObject?.()??clone(p));parts[0].custom.formula=`1d6 + ${3+wis}`;u[`system.activities.${ac.id??ac._id}.damage.parts`]=parts;}
        if(Object.keys(u).length)await bite.update(u,{grimnirCards:true});
      }
    }
    if(flag(w,'template')==='soul')for(const i of list(w.items))for(const ac of list(i.system.activities).filter(ac=>ac.type==='attack')){
      if(ac.attack.bonus!==String(pb+cha))await i.update({[`system.activities.${ac.id??ac._id}.attack.bonus`]:String(pb+cha)},{grimnirCards:true});
    }
  }
}

Hooks.on('dnd5e.postUseActivity', async (ac) => {
  const a = ac.actor ?? ac.item.actor;
  if (!a?.isOwner || ac.target?.affects?.type !== 'self') return;
  const owned = list(a.items).find(i=>i.id===ac.item.id) ?? ac.item;
  for (const reference of ac.effects ?? []) {
    const e = list(owned.effects).find(e => e.id === reference._id);
    if (!e || !flag(e, 'activateOnUse')) continue;
    await e.update({ disabled: false, 'duration.startTime': game.time.worldTime,
      [`flags.${ID}.startedRound`]: game.combat?.round, [`flags.${ID}.startedTurn`]: game.combat?.turn });
  }
});

// Native attack rolls do not read Midi-QOL flags. Apply only target-aware rules here.
Hooks.on('dnd5e.preRollAttackV2', config => {
  const ac = config.subject, a = ac?.actor;
  if (!a) return;
  const target = Array.from(game.user.targets ?? [])[0]?.actor;
  for (const r of config.rolls ?? []) {
    r.options ??= {};
    if (effects(a).some(e => active(e) && e.changes?.some(c => c.key === `flags.${ID}.disadvantageAttack`))) r.options.disadvantage = true;
    if (target && (effect(target, 'wyrd-time') || effects(target).some(e => active(e) && flag(e, 'charity')) && !allies(a,target))) r.options.disadvantage = true;
    if (target && effects(target).some(e => active(e) && e.changes?.some(c => c.key === `flags.${ID}.noCritical`))) r.options.criticalSuccess = 100;
  }
});

const tokenActors = () => [...new Map(list(canvas?.tokens?.placeables).filter(t => t.actor).map(t => [t.actor.uuid, t.actor])).values()];
function distance(a, b) {
  const at = list(canvas?.tokens?.placeables).filter(t => t.actor?.uuid === a.uuid);
  const bt = list(canvas?.tokens?.placeables).filter(t => t.actor?.uuid === b.uuid);
  let result = Infinity;
  for (const x of at) for (const y of bt) {
    const measured = canvas.grid?.measurePath?.([x.center, y.center])?.distance;
    if (measured === undefined) continue;
    const vertical = Math.abs(Number(x.document?.elevation ?? 0) - Number(y.document?.elevation ?? 0));
    result = Math.min(result, Math.max(measured, vertical));
  }
  return result;
}
function allies(a, b) {
  if (a.uuid === b.uuid) return true;
  const x = list(canvas?.tokens?.placeables).find(t => t.actor?.uuid === a.uuid);
  const y = list(canvas?.tokens?.placeables).find(t => t.actor?.uuid === b.uuid);
  return !!x && !!y && x.document.disposition === y.document.disposition;
}
const bloodied = a => Number(a.system.attributes.hp.value) <= Number(a.system.attributes.hp.max) / 2;
async function autoEffect(a, key, name, changes, enabled, extra = {}) {
  if (!owner(a)) return;
  const old = list(a.effects).find(e => flag(e, 'key') === key);
  if (!old && !enabled) return;
  const data = { name, disabled: !enabled, changes, flags: { [ID]: { managed: true, auto: true, key, ...extra } } };
  if (old) {
    if (old.disabled !== data.disabled || JSON.stringify(old.changes) !== JSON.stringify(changes) || Boolean(flag(old, 'charity')) !== Boolean(extra.charity)) await old.update(data);
  } else await a.createEmbeddedDocuments('ActiveEffect', [{ ...data, transfer: false, img: `modules/${ID}/assets/icons/lorc-spiked-armor.svg` }]);
}
const sceneLocks = new Set();
async function syncScene() {
  if (!game.user.isGM || sceneLocks.has('scene')) return;
  sceneLocks.add('scene');
  try {
    const actors = [...new Map([...list(game.actors), ...tokenActors()].map(a => [a.uuid, a])).values()];
    for (const a of actors) {
      const wolves = actors.filter(w => flag(w, 'master') === a.uuid && flag(w, 'template') === 'wolf');
      const defense = feature(a, 'Woodland Rider') && !a.statuses.has('incapacitated');
      for (const w of wolves) {
        const on = Boolean(defense && !w.statuses.has('incapacitated') && distance(a, w) <= 5);
        const changes = [change('system.attributes.ac.bonus', 1)];
        if (w.system.attributes.ac.calc === 'flat') changes.unshift(change('system.attributes.ac.calc', 'natural', 5));
        await autoEffect(w, 'wolf-defense', 'Wolf and Rider Defense', changes, on);
      }
      await autoEffect(a, 'rider-defense', 'Wolf and Rider Defense', [change('system.attributes.ac.bonus', 1)], Boolean(defense && wolves.some(w => !w.statuses.has('incapacitated') && distance(a, w) <= 5)));
      const cover = feature(a, 'Defend the Pack') && list(a.items).some(i => i.system.identifier === 'hunters-mark' && list(a.concentration?.effects).some(e => e.origin?.includes(i.id)));
      for (const x of [a, ...wolves]) await autoEffect(x, `pack-cover-${a.id}`, 'Pack Cover', [change('system.attributes.ac.cover', 2, 4)], Boolean(cover));
      const virtues = effect(a, 'virtues'), selections = flag(virtues, 'virtues') ?? [];
      const execution = effect(a, 'execution-aura');
      const radius = lv(a, 'paladin') >= 18 ? 30 : 10;
      for (const b of actors) {
        const inAura = allies(a, b) && (a.uuid === b.uuid || distance(a, b) <= radius) && !a.statuses.has('incapacitated');
        if (virtues || list(b.effects).some(e => flag(e, 'key') === `virtues-${a.id}`)) {
          const changes = [];
          if (selections.includes('faith')) changes.push(change('system.attributes.concentration.roll.mode', 1));
          if (selections.includes('humility')) changes.push(change('system.abilities.cha.save.roll.mode', 1));
          if (selections.includes('prudence')) changes.push(change('system.abilities.wis.save.roll.mode', 1));
          if (selections.includes('hope') && bloodied(b)) changes.push(change('system.attributes.ac.bonus', 2));
          await autoEffect(b, `virtues-${a.id}`, 'Shield of the Seven Virtues', changes, Boolean(virtues && inAura), { charity: selections.includes('charity') && bloodied(b) });
        }
        if (b.uuid !== a.uuid && (execution || list(b.effects).some(e => flag(e, 'key') === `execution-${a.id}`))) {
          const bonus = effect(a, 'justice') ? Math.max(1, a.system.abilities.cha.mod) : 1;
          await autoEffect(b, `execution-${a.id}`, 'Aura of the Executioner', ['mwak','rwak','msak','rsak'].map(x => change(`system.bonuses.${x}.attack`, bonus)), Boolean(execution && inAura));
        }
      }
    }
  } finally { sceneLocks.delete('scene'); }
}
let sceneTimer;
function queueScene() { clearTimeout(sceneTimer); sceneTimer = setTimeout(() => syncScene().catch(console.error), 100); }
for (const event of ['updateActor','createToken','updateToken','deleteToken','createActiveEffect','updateActiveEffect','deleteActiveEffect','canvasReady']) Hooks.on(event, queueScene);
Hooks.on('updateActor', (a, updates, options={}) => { syncResources(a).catch(console.error);syncEffects(a).catch(console.error);if(!options.grimnirCompanion)syncCompanions(a).catch(console.error); });
Hooks.on('updateItem', i => { if(i.actor&&i.type==='equipment')syncEffects(i.actor).catch(console.error);if(i.actor&&i.type==='class')syncCompanions(i.actor).catch(console.error); });
Hooks.on('dnd5e.restCompleted', a => { syncResources(a).catch(console.error); });
Hooks.on('updateActiveEffect', async (e, updates, options = {}, userId) => {
  const a = e.parent?.actor ?? (e.parent?.documentName === 'Actor' ? e.parent : null);
  const rage = e.parent?.system?.identifier === 'rage' || e.name === 'Rage';
  if(a?.isOwner&&userId===game.user.id&&active(e)&&rage&&updates.disabled===false&&!options.grimnirCards&&feature(a,'Strength of One'))await game.modules.get(ID).api.useAction(a,'rageStart');
  if (!owner(a)) return;
  if(active(e)&&updates.disabled===false&&flag(e,'preset')&&!options.grimnirEffects){
    const seconds=flag(e,'seconds')??(flag(e,'key')==='wyrd-time'?Math.max(0,a.system.abilities.cha.mod)*6:e.duration.seconds);
    if(seconds)await e.update({'duration.seconds':seconds,'duration.startTime':game.time.worldTime},{grimnirEffects:true});
    if(flag(e,'endNextTurn'))await e.update({[`flags.${ID}.startedRound`]:game.combat?.round,[`flags.${ID}.startedTurn`]:game.combat?.turn},{grimnirEffects:true});
  }
  if (flag(e,'key')==='saint-plate' && updates.disabled !== undefined && !options.grimnirEffects) await e.update({ [`flags.${ID}.wanted`]:!updates.disabled }, { grimnirEffects:true });
  if (active(e) && updates.disabled === false && flag(e, 'group')) {
    for (const other of effects(a)) if (other !== e && active(other) && flag(other,'group') === flag(e,'group')) await other.update({ disabled: true });
  }
  if (!active(e) && (rage || flag(e, 'key') === 'provoked')) {
    await endEffect(a, 'provoked');
    for (const i of list(a.items).filter(i => flag(i, 'pointPool'))) await i.update({ 'system.uses.spent': usesFor(i).max }, { grimnirCards: true });
    if (Number(flag(a, 'provokedPoints') ?? 0)) await a.setFlag(ID, 'provokedPoints', 0);
  }
});
Hooks.on('preUpdateCombat', (combat, updates) => {
  if (updates.turn !== undefined || updates.round !== undefined) combat._grimnirPreviousTurn = { actor: combat.combatant?.actor, round: combat.round, turn: combat.turn };
});
Hooks.on('updateCombat', async combat => {
  const previous = combat._grimnirPreviousTurn;
  if (!previous?.actor || !owner(previous.actor)) return;
  for (const e of effects(previous.actor)) if (active(e) && flag(e,'endNextTurn') && flag(e,'startedRound') !== undefined &&
    (previous.round > flag(e,'startedRound') || previous.round === flag(e,'startedRound') && previous.turn > flag(e,'startedTurn'))) await e.update({ disabled: true });
});
Hooks.on('deleteCombat', async () => {
  for (const a of game.actors) if (owner(a)) for (const e of effects(a)) if (active(e) && flag(e,'endCombat')) await endEffect(a,flag(e,'key'));
});
Hooks.once('init', () => { Object.assign(game.modules.get(ID).api, { usesFor, effects, effect, setEffect, endEffect, syncResources, syncScene, syncEffects, syncCompanions }); });
Hooks.once('ready', async () => { for (const a of game.actors) {await syncResources(a);await syncEffects(a);await syncCompanions(a);} await syncScene(); });
