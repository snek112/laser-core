const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const test=require('node:test');
const {loadMiningPreferences,saveMiningPreferences,researchPaused,DEFAULT_MINING_INTENSITY}=require('../mining-preferences');

test('intensity is recovered before startup and malformed settings do not become trusted preferences',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'laser-intensity-'));
 const file=path.join(folder,'mining-preferences.json');
 try {
  assert.equal(researchPaused(DEFAULT_MINING_INTENSITY),false,'the default keeps optional research running');
  assert.deepEqual(loadMiningPreferences(file),{intensity:DEFAULT_MINING_INTENSITY,saved:false});
  saveMiningPreferences(file,10);assert.deepEqual(loadMiningPreferences(file),{intensity:10,saved:true});
  assert.deepEqual(JSON.parse(fs.readFileSync(file)),{intensity:10});
  assert.equal(fs.existsSync(file+'.tmp'),false);
  assert.throws(()=>saveMiningPreferences(file,0));
  assert.equal(loadMiningPreferences(file).intensity,10);
  for(const invalid of ['{','{}','{"intensity":0}','{"intensity":"10"}']){
   fs.writeFileSync(file,invalid);assert.deepEqual(loadMiningPreferences(file),{intensity:DEFAULT_MINING_INTENSITY,saved:false});
  }
 } finally {if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(folder);}
});

test('only the low settings pause optional research',()=>{
 for(const intensity of [10,25])assert.equal(researchPaused(intensity),true);
 for(const intensity of [50,75,100])assert.equal(researchPaused(intensity),false);
 assert.throws(()=>researchPaused(0));
});
