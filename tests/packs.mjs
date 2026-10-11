import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { extractPack } from '@foundryvtt/foundryvtt-cli';

const root = new URL('../', import.meta.url).pathname;
const manifest = JSON.parse(await fs.readFile(path.join(root, 'module.json'), 'utf8'));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'subclassesvd-packs-'));
const source = new Map();
let subclasses = 0, features = 0, grants = 0;
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
      if (doc.type === 'feat') features++;
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
  assert.equal(grants, 218);
  console.log(`Four packs match source: ${subclasses} subclasses, ${features} features, ${grants} grants`);
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
