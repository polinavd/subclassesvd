import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { extractPack } from '@foundryvtt/foundryvtt-cli';

const root = new URL('../', import.meta.url).pathname;
const manifest = JSON.parse(await fs.readFile(path.join(root, 'module.json'), 'utf8'));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'subclassesvd-packs-'));
const source = new Map();
let subclasses = 0, features = 0, actions = 0, spells = 0, grants = 0;
async function readDocs(folder) {
  const docs = new Map();
  for (const file of await fs.readdir(folder)) {
    if (!file.endsWith('.json')) continue;
    const doc = JSON.parse(await fs.readFile(path.join(folder, file), 'utf8'));
    assert.match(doc._id, /^[a-zA-Z0-9]{16}$/);
    assert.ok(doc._key, `Missing LevelDB key: ${file}`);
    assert.ok(!docs.has(doc._id), `Duplicate ID: ${doc._id}`);
    docs.set(doc._id, doc);
  }
  return docs;
}
try {
  for (const pack of manifest.packs) {
    const original = await readDocs(path.join(root, 'source', pack.name));
    const target = path.join(temp, pack.name);
    // Opening LevelDB changes its journals; read a copy to leave the release archive intact.
    const copy = path.join(temp, `${pack.name}-db`);
    await fs.cp(path.join(root, pack.path), copy, { recursive: true });
    await extractPack(copy, target, { folders: false, log: false });
    const extracted = await readDocs(target);
    assert.deepEqual(extracted, original, `${pack.name}: packed documents differ from source`);
    for (const doc of original.values()) {
      source.set(`Compendium.${manifest.id}.${pack.name}.${pack.type}.${doc._id}`, doc);
      if (doc.type === 'subclass') subclasses++;
      if (doc.type === 'feat' && doc.flags?.[manifest.id]?.feature) features++;
      if (doc.flags?.[manifest.id]?.parentFeature && doc.type !== 'spell') actions++;
      if (doc.type === 'spell') spells++;
      for (const i of [doc,...(doc.items??[])]) if (['feat','subclass','spell','weapon','npc','script'].includes(i.type)) {
        assert.ok(i.img?.startsWith(`modules/${manifest.id}/assets/icons/`),`Missing local icon: ${i.name}`);
        await fs.access(path.join(root,i.img.slice(`modules/${manifest.id}/`.length)));
        assert.ok(!/<br\s*\/?|<hr|Автоматизация|Configured by companion macro/i.test(i.system?.description?.value??''),`Dirty description: ${i.name}`);
        for (const activity of Object.values(i.system?.activities??{})) assert.equal(activity.img,i.img);
      }
      for (const activity of Object.values(doc.system?.activities ?? {})) {
        for (const effect of activity.effects ?? []) {
          assert.ok(doc.effects?.some(e => e._id === effect._id), `Unresolved effect: ${doc.name}`);
        }
      }
    }
  }
  for (const doc of source.values()) {
    const advancements = doc.system?.advancement ?? [];
    assert.equal(new Set(advancements.map(a => a._id)).size, advancements.length);
    for (const a of advancements.filter(a => a.type === 'ItemGrant')) {
      for (const item of a.configuration.items) {
        grants++;
        if (item.uuid.startsWith(`Compendium.${manifest.id}.`)) {
          assert.ok(source.has(item.uuid), `Unresolved grant: ${item.uuid}`);
        } else {
          // External IDs were verified against the exact D&D5e 5.2.3 source at initial conversion.
          assert.match(item.uuid, /^Compendium\.dnd5e\.(spells|spells24|equipment24)\.Item\.[a-zA-Z0-9]{16}$/);
        }
      }
    }
  }
  assert.equal(subclasses, 24);
  assert.equal(features, 125);
  assert.ok(actions >= 130);
  assert.ok(spells >= 100);
  assert.equal(manifest.packs.length,5);
  for(const doc of source.values()){
    for(const child of doc.flags?.[manifest.id]?.children??[]) assert.ok(source.has(child.uuid),`Unresolved action/spell: ${child.uuid}`);
    for(const activity of Object.values(doc.system?.activities??{}))for(const profile of activity.profiles??[])if(profile.uuid?.startsWith(`Compendium.${manifest.id}.`))assert.ok(source.has(profile.uuid),`Unresolved summon: ${profile.uuid}`);
    if(doc.type==='feat' && doc.flags?.[manifest.id]?.feature){
      const uuids=doc.system.advancement.filter(a=>a.type==='ItemGrant').flatMap(a=>a.configuration.items.map(i=>i.uuid));
      assert.equal(new Set(uuids).size,uuids.length,`Duplicate grant: ${doc.name}`);
      for(const child of doc.flags[manifest.id].children??[])assert.ok(uuids.includes(child.uuid),`Missing native grant: ${doc.name}`);
    }
  }
  const natural=[...source.values()].filter(d=>d.type==='weapon'&&d.flags?.[manifest.id]?.requiresForm==='primal-arm');
  assert.equal(natural.length,3);for(const w of natural){const attacks=Object.values(w.system.activities);assert.ok(attacks.some(a=>a.type==='attack'&&a.attack.ability==='wis'&&a.damage.parts.length));}
  const primeval=[...source.values()].find(d=>d.name==='Summon Beast — Primeval Call');assert.ok(Object.values(primeval.system.activities).some(a=>a.type==='summon'&&a.profiles.length===3&&!a.consumption.spellSlot));
  console.log(`Five packs match source: ${subclasses} subclasses, ${features} features, ${actions} action cards, ${spells} spell cards, ${grants} grants`);
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
