/** Read-only character metadata renderer; no select/login capability. */
const RACES = Object.freeze({1:'Human',2:'Orc',3:'Dwarf',4:'Night Elf',5:'Undead',6:'Tauren',7:'Gnome',8:'Troll',10:'Blood Elf',11:'Draenei'});
const CLASSES = Object.freeze({1:'Warrior',2:'Paladin',3:'Hunter',4:'Rogue',5:'Priest',6:'Death Knight',7:'Shaman',8:'Mage',9:'Warlock',11:'Druid'});
export const SAMPLE_CHARACTERS = Object.freeze([
  {name:'Demo Sentinel',race:1,classId:1,gender:0,level:17,zone:12,mapId:0},
  {name:'Demo Ranger',race:4,classId:3,gender:1,level:24,zone:14,mapId:1},
]);
export function rosterViewModel(characters, {source = 'demo'} = {}) {
  if (!Array.isArray(characters) || characters.length > 12 ||
      !['demo','verified-local-protocol'].includes(source)) throw new Error('Invalid character roster');
  return characters.map(c => {
    if (!c || typeof c.name !== 'string' || c.name.length < 1 || c.name.length > 48 ||
        !Number.isInteger(c.level) || c.level < 1 || c.level > 80 ||
        !Number.isInteger(c.race) || !Number.isInteger(c.classId)) {
      throw new Error('Invalid character metadata');
    }
    return Object.freeze({name:c.name,level:c.level,
      race:RACES[c.race] || 'Unknown race',characterClass:CLASSES[c.classId] || 'Unknown class',
      source,readOnly:true});
  });
}
export function renderCharacterRoster({container,characters,source='demo',documentRef=globalThis.document}) {
  if (!container || !documentRef?.createElement) throw new Error('Missing roster container');
  const models = rosterViewModel(characters,{source});
  const fragment = documentRef.createDocumentFragment();
  for (const character of models) {
    const li = documentRef.createElement('li');
    li.className = 'lab-character';
    const name = documentRef.createElement('strong');
    name.textContent = character.name;
    const detail = documentRef.createElement('span');
    detail.textContent = `Level ${character.level} · ${character.race} ${character.characterClass}`;
    const tag = documentRef.createElement('small');
    tag.textContent = source === 'demo' ? 'SYNTHETIC DEMO · NOT REAL' : 'LOCAL PROTOCOL · READ-ONLY';
    li.append(name,detail,tag);
    fragment.appendChild(li);
  }
  container.replaceChildren(fragment);
  return models;
}
