const assert=require('node:assert/strict');
const test=require('node:test');
const {miningGate,PEER_MINIMUM}=require('../mining-gate');

const MINE='ab'.repeat(32), THEIRS='cd'.repeat(32);
const now=Date.UTC(2026,0,2)+600000;
const chain=(patch={})=>({network:'shadow',height:5000,tip:MINE,peers:2,
  target_spacing_seconds:10,median_time_past:Math.floor(now/1000)-30,
  peer_best_height:5000,peer_best_tip:MINE,...patch});

test('a node with no peers cannot mine',()=>{
  const gate=miningGate(chain({peers:0}),{now});
  assert.equal(gate.ok,false);
  assert.equal(gate.blocked_by,'peers');
  assert.equal(gate.peers_required,PEER_MINIMUM);
  assert.equal(gate.overridable,true);
  assert.equal(miningGate(chain({peers:undefined}),{now}).blocked_by,'peers');
});

test('a node behind the best height its peers report cannot mine',()=>{
  const gate=miningGate(chain({height:8961,tip:MINE,peer_best_height:58705,peer_best_tip:THEIRS}),{now});
  assert.equal(gate.ok,false);
  assert.equal(gate.blocked_by,'height');
  assert.equal(gate.blocks_behind,49744);
  assert.equal(gate.tip_matches,false);
});

test('a node level with its peers on another chain cannot mine',()=>{
  const gate=miningGate(chain({peer_best_tip:THEIRS}),{now});
  assert.equal(gate.ok,false);
  assert.equal(gate.blocked_by,'tip');
  assert.equal(gate.blocks_behind,0);
});

test('a node whose height and tip hash match its peers can mine',()=>{
  const gate=miningGate(chain(),{now});
  assert.equal(gate.ok,true);
  assert.equal(gate.blocked_by,'none');
  assert.equal(gate.tip_matches,true);
  assert.equal(gate.peer_chain_known,true);
  assert.equal(gate.solo_override,false);
});

test('the solo override mines through every agreement refusal and nothing else',()=>{
  for(const patch of [{peers:0},{height:1,peer_best_height:900,peer_best_tip:THEIRS},
      {peer_best_tip:THEIRS},{peer_best_height:undefined,peer_best_tip:undefined}]) {
    const blocked=miningGate(chain(patch),{now});
    assert.equal(blocked.ok,false);
    assert.equal(blocked.overridable,true);
    const overridden=miningGate(chain(patch),{now,soloOverride:true});
    assert.equal(overridden.ok,true);
    assert.equal(overridden.solo_override,true);
    assert.equal(overridden.blocked_by,blocked.blocked_by);
  }
  const unreadable=miningGate(chain({tip:'not-a-hash'}),{now,soloOverride:true});
  assert.equal(unreadable.blocked_by,'chain-unreadable');
  assert.equal(unreadable.overridable,false);
  assert.equal(unreadable.ok,false);
  for(const loose of [1,'true','yes',{}])
    assert.equal(miningGate(chain({peers:0}),{now,soloOverride:loose}).ok,false);
});

test('regtest is exempt from network agreement',()=>{
  const gate=miningGate(chain({network:'regtest',peers:0,
    peer_best_height:undefined,peer_best_tip:undefined}),{now});
  assert.equal(gate.ok,true);
  assert.equal(gate.regtest_exempt,true);
  assert.equal(gate.blocked_by,'none');
  assert.equal(miningGate(chain({network:'shadow',peers:0}),{now}).regtest_exempt,false);
});

test('the node reports no peer chain today, so the gate fails closed',()=>{
  // What a current node answers to `node status --json`: its own chain and an
  // established peer count, with no peer_best_height or peer_best_tip.
  const reported=miningGate({network:'shadow',height:57025,
    tip:'43b172b729df59493d6f4c6dd96177a1215e851e0f7d700ae95d28eaa6480088',
    chain_work:'00c2de'.padEnd(64,'0'),median_time_past:Math.floor(now/1000)-30,
    target_spacing_seconds:10,blocks:57032,orphans:0,mempool:0,peers:2},{now});
  assert.equal(reported.peer_chain_known,false);
  assert.equal(reported.peer_best_height,null);
  assert.equal(reported.peer_best_tip,null);
  assert.equal(reported.blocked_by,'peer-chain-unknown');
  assert.equal(reported.ok,false);
});

test('tip age is reported for the interface but never gates mining',()=>{
  const stale=miningGate(chain({median_time_past:Math.floor(now/1000)-86400}),{now});
  assert.equal(stale.tip_fresh,false);
  assert.equal(stale.tip_age_seconds,86400);
  assert.equal(stale.ok,true);
  assert.equal(miningGate(chain({median_time_past:undefined}),{now}).tip_fresh,null);
});
