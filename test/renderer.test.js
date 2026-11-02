const assert=require('node:assert/strict');
const test=require('node:test');
const {setup,TIP,DEFAULT_INTENSITY}=require('./renderer-harness');
async function ready(bridge={}){const h=setup(bridge);h.unlocked.add('Alice');h.unlocked.add('Bob');await h.app.refreshWallets('Alice');await h.app.poll();return h;}

test('startup lists encrypted wallets without opening or mining them',async()=>{
  const {app,calls}=setup();await app.openMain();
  assert.equal(app.state.selected,'Alice');assert.equal(app.state.unlocked.Alice,false);
  assert.equal(calls.length,0);
});
test('slow saved-chain startup connects on a later poll without unlocking or mining',async()=>{
  let online=false;
  const h=setup({
    startup:async()=>({running:true,ready:online,startedAt:Date.now()-360000,error:null}),
    status:async()=>{if(!online)throw new Error('RPC unavailable');return {height:44467};}
  });
  await h.app.poll();
  assert.equal(h.app.renderVals().banner.label,'Node starting');
  assert.doesNotMatch(h.app.renderVals().banner.text,/restart|Close other Laser/);
  online=true;await h.app.poll();
  assert.equal(h.app.state.node.online,true);
  assert.equal(h.app.state.node.startup.ready,true);
  assert.equal(h.app.renderVals().banner.show,false);
  assert.ok(!h.calls.some(c=>c[0]==='walletOpen'||c[0]==='mineStart'));
});

test('a child failure after the splash remains visible on the next poll',async()=>{
  let failed=false;
  const h=setup({status:async()=>{throw new Error('RPC unavailable');},
    startup:async()=>({running:!failed,ready:false,error:failed?'Node exited: fixture':null})});
  await h.app.poll();assert.equal(h.app.renderVals().banner.label,'Node starting');
  failed=true;await h.app.poll();
  assert.equal(h.app.renderVals().banner.label,'Node failed to start');
  assert.equal(h.app.renderVals().banner.text,'Node exited: fixture');
});

test('new design renders all five views with unavailable and exact monetary values',async()=>{
  const {app}=await ready();
  for(const view of ['overview','send','receive','mining','network']){app.state.view=view;assert.ok(app.render());}
  assert.equal(app.renderVals().bal.avail.full,'9007199.254740993 LASER · 9007199254740993 photons');
  app.state.node.online=false;assert.equal(app.renderVals().bal.stale,true);
  app.state.node.lastOk=null;assert.equal(app.renderVals().bal.stale,false);
});
test('contacts migrate from the existing address book without secret storage',()=>{
  const address='ab'.repeat(32);const h=setup({}, {'laser-core.contacts.v1':JSON.stringify({[address]:'Savings'})});
  assert.equal(h.app.state.contacts[0].label,'Savings');h.app.saveContacts(h.app.state.contacts);
  assert.equal(JSON.parse(h.storage.get('laser-core.contacts.v1'))[address],'Savings');
});
test('create and unlock remain explicit and do not start mining',async()=>{
  const {app,calls}=setup();app.state.dlg={type:'pass',mode:'create',name:'NewWallet',p1:'dummy',p2:'dummy'};
  await app.passSubmit({preventDefault(){}});assert.equal(app.state.dlg.type,'created');assert.equal(app.state.unlocked.NewWallet,true);
  assert.ok(calls.some(c=>c[0]==='walletCreate'));assert.ok(!calls.some(c=>c[0]==='mineStart'));
  assert.equal(app.state.dlg.p1,undefined);
});
test('restoring preserves the locked state and cancel does not create a wallet',async()=>{
  const h=setup();h.app.state.dlg={type:'name',mode:'restore',value:'Restored'};await h.app.nameSubmit({preventDefault(){}});
  assert.equal(h.app.state.unlocked.Restored,false);assert.ok(!h.calls.some(c=>c[0]==='walletOpen'));
  const cancelled=setup({walletRestore:async()=>null});cancelled.app.state.dlg={type:'name',mode:'restore',value:'Cancelled'};
  await cancelled.app.nameSubmit({preventDefault(){}});assert.equal(cancelled.wallets.has('Cancelled'),false);
});
test('wallet locking clears balances and stops the visible mining session',async()=>{
  const h=await ready();h.app.state.mining=await h.laser.mineStart('Alice',10000);
  await h.app.lockWallet('Alice');assert.equal(h.app.state.unlocked.Alice,false);assert.equal(h.app.state.records.Alice,undefined);
  assert.equal(h.app.state.metrics,null);assert.equal(h.app.state.metricsByWallet.Alice,undefined);assert.equal(h.app.state.mining.mining,false);
});
test('late wallet responses cannot restore data after a lock',async()=>{
  let release;const h=await ready();h.laser.walletOpen=()=>new Promise(resolve=>{release=resolve;});h.app.state.unlocked.Bob=false;
  const pending=h.app.refreshSelected();await h.app.lockWallet('Alice');release(h.wallets.get('Alice'));await pending;
  assert.equal(h.app.state.records.Alice,undefined);assert.equal(h.app.state.metrics,null);
});
test('expired native secrets are reconciled while polling',async()=>{
  const h=await ready();h.unlocked.delete('Alice');await h.app.poll();
  assert.equal(h.app.state.unlocked.Alice,false);assert.equal(h.app.state.records.Alice,undefined);
});
test('send uses the selected sender pending debits and blocks unknown balances',async()=>{
  const {app}=await ready();app.state.metricsByWallet.Bob.pending_spent_photons='19000000000';
  app.setSend({from:'Bob',to:'cd'.repeat(32),amount:'2'});assert.match(app.sendCalc().blocker,/more than/);
  delete app.state.metricsByWallet.Bob;assert.match(app.sendCalc().blocker,/Waiting for current balance/);
});
test('send validates address, precision, subtract fee, zero fee and uint64 total',async()=>{
  const {app,parseLaser}=await ready();app.setSend({to:'0x'+'cd'.repeat(32),amount:'1'});assert.match(app.sendCalc().toErr,/0x/);
  assert.equal(parseLaser('0.0000000001'),null);assert.equal(parseLaser('0.000000001'),1n);
  app.setSend({to:'cd'.repeat(32),amount:'0.01',subtract:true});assert.match(app.sendCalc().amtErr,/larger than the fee/);
  app.setSend({amount:'1',subtract:false,fee:'custom',feeCustom:'0'});assert.equal(app.sendCalc().feeErr,null);
  app.setSend({amount:'18446744073.709551615',fee:'0.01'});assert.match(app.sendCalc().fundsErr,/supported range/);
});
test('review cancel does not sign and duplicate confirmation submits once',async()=>{
  let release;const h=await ready({send:async(...args)=>{h.calls.push(['send',...args]);await new Promise(r=>{release=r;});return 'Accepted';}});
  h.app.setSend({to:'cd'.repeat(32),amount:'0.000000001'});h.app.renderVals().review();h.app.closeDlg();assert.ok(!h.calls.some(c=>c[0]==='send'));
  h.app.renderVals().review();const submitting=h.app.confirmSend();await new Promise(r=>setImmediate(r));await h.app.confirmSend();
  assert.equal(h.calls.filter(c=>c[0]==='send').length,1);assert.equal(h.calls.find(c=>c[0]==='send')[3],'0.000000001');release();await submitting;assert.equal(h.app.state.dlg.ok,true);
});
test('confirmation rechecks funds and fails without signing when balance changed',async()=>{
  const h=await ready();h.app.setSend({to:'cd'.repeat(32),amount:'1'});h.app.renderVals().review();
  h.laser.minerMetrics=async()=>({...h.metrics('Alice'),pending_spent_photons:h.wallets.get('Alice').balance_photons});
  await h.app.confirmSend();assert.equal(h.app.state.dlg.ok,false);assert.ok(!h.calls.some(c=>c[0]==='send'));
});
test('continuous and one-shot mining require explicit actions and cannot overlap',async()=>{
  const h=await ready();await h.app.mineToggle();assert.equal(h.calls.filter(c=>c[0]==='mineStart').length,1);
  await h.app.mineOnce();assert.ok(!h.calls.some(c=>c[0]==='mine'));
  await h.app.mineToggle();h.app.state.onceStr='101';await h.app.mineOnce();assert.match(h.app.state.onceMsg.text,/1 to 100/);
  h.app.state.onceStr='2';await h.app.mineOnce();assert.deepEqual(h.calls.find(c=>c[0]==='mine'),['mine','Alice',2,DEFAULT_INTENSITY,false]);
});
test('copy failures and unavailable metrics are visible',async()=>{
  const h=await ready({copyAddress:async()=>{throw new Error('Clipboard unavailable');}});await h.app.copyAddr();assert.match(h.app.renderVals().rc.copyMsg,/Clipboard unavailable/);
  h.laser.minerMetrics=async()=>{throw new Error('Metrics unavailable');};await h.app.refreshSelected();assert.equal(h.app.state.metrics,null);assert.equal(h.app.renderVals().bal.pendKnown,false);
});

test('intensity is saved and passed to continuous and one-shot mining',async()=>{
  const h=await ready();await h.app.setMiningIntensity('25');
  assert.equal(h.app.state.intensity,25);
  assert.equal(JSON.parse(h.storage.get('laser-core.preferences.v1')).miningIntensity,25);
  assert.ok(!h.calls.some(c=>c[0]==='mineStart'||c[0]==='mine'));
  await h.app.mineToggle();assert.deepEqual(h.calls.find(c=>c[0]==='mineStart'),['mineStart','Alice',10000,25,false]);
  assert.equal(h.app.renderVals().mc.intensityDisabled,false);
  await h.app.setMiningIntensity('10');assert.equal(h.app.state.mining.mining,true);
  assert.ok(!h.calls.some(c=>c[0]==='mineStop'));
  await h.app.mineToggle();await h.app.mineOnce();assert.deepEqual(h.calls.find(c=>c[0]==='mine'),['mine','Alice',1,10,false]);
  const restored=setup({},Object.fromEntries(h.storage));assert.equal(restored.app.state.intensity,10);
});

test('intensity changes report errors without saving an unapplied choice',async()=>{
  const h=await ready({mineSetIntensity:async()=>{throw new Error('Unavailable');}});
  await h.app.setMiningIntensity('25');assert.equal(h.app.state.intensity,DEFAULT_INTENSITY);
  assert.equal(h.app.state.intensityBusy,false);assert.equal(h.app.state.mineErr,'Unavailable');
  assert.equal(h.storage.has('laser-core.preferences.v1'),false);
  assert.equal(setup({}, {'laser-core.preferences.v1':'{"miningIntensity":0}'}).app.state.intensity,DEFAULT_INTENSITY);
});

test('startup honors persisted intensity and distinguishes paused research from failure',async()=>{
 const h=setup({mineStatus:async()=>({mining:false,intensity:10,settings_saved:true,session:{}})});
 await h.app.openMain();assert.equal(h.app.state.intensity,10);
 h.app.state.node={online:true,status:{shadow:{state:'paused'}}};
 assert.equal(h.app.renderVals().obs.v,'Paused · low intensity');
 assert.match(h.app.renderVals().mc.intensityHelp,/research is paused/);
});

test('receive displays and copies the complete address without inserted separators',async()=>{
  const h=await ready();h.app.state.phase='main';h.app.state.view='receive';
  const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.children||[])]:[];
  const address=nodes(h.app.render()).find(n=>n.props?.id==='rc-address');
  assert.equal(address.children.join(''),h.wallets.get('Alice').address);
  await h.app.copyAddr();assert.equal(h.calls.find(c=>c[0]==='copyAddress')[1],h.wallets.get('Alice').address);
});

test('submission receipt preserves exact amounts and transaction ID without claiming confirmation',async()=>{
  const txid='ab'.repeat(32),h=await ready({send:async()=>`Transaction accepted: ${txid}\n`});
  h.app.setSend({to:'cd'.repeat(32),amount:'0.000000001',fee:'0.01'});h.app.renderVals().review();await h.app.confirmSend();
  const d=h.app.renderVals().d;
  assert(d.isSuccess);assert.equal(d.amount,'0.000000001');assert.equal(d.recipient,'cd'.repeat(32));
  assert.equal(d.title,'Transaction submitted');assert.equal(d.msg,'Waiting for network confirmation.');
  assert.equal(d.rows.find(r=>r.k==='Transaction ID').v,txid);
  assert.equal(d.rows.find(r=>r.k==='Fee').v,'0.010000000 LASER');
  assert.equal(d.rows.find(r=>r.k==='Total debit').v,'0.010000001 LASER');
  assert.equal(d.out,undefined);
  d.done();assert.equal(h.app.state.dlg,null);assert.equal(h.app.state.send.to,'');assert.equal(h.app.state.send.amount,'');
});
test('peer-query failure does not incorrectly mark an answering node offline',async()=>{
  const h=setup({peers:async()=>{throw new Error('Peers unavailable');}});await h.app.poll();assert.equal(h.app.state.node.online,true);assert.match(h.app.renderVals().net.kicker,/unavailable/);
});
test('the interface refuses mining on a chain its peers have moved past',async()=>{
  const h=await ready();
  h.chain.peer_best_height=58705;h.chain.peer_best_tip='cd'.repeat(32);
  await h.app.poll();
  const before=h.app.renderVals();
  assert.equal(before.mc.btnDisabled,true);
  assert.equal(before.once.btnDisabled,true);
  assert.match(before.mc.sub,/blocks behind its peers/);
  assert.match(before.banner.text,/58,705/);
  assert.equal(before.banner.label,'Mining blocked');
  await h.app.mineToggle();
  assert.ok(!h.calls.some(c=>c[0]==='mineStart'));
  assert.match(h.app.state.mineErr,/orphaned/);
  h.app.state.onceStr='1';await h.app.mineOnce();
  assert.ok(!h.calls.some(c=>c[0]==='mine'));
  assert.equal(h.app.state.onceMsg.err,true);
});

test('the solo override is explicit, passed to the node and recorded in the activity log',async()=>{
  const h=await ready();
  h.chain.peers=0;h.chain.peer_best_height=undefined;h.chain.peer_best_tip=undefined;
  await h.app.poll();
  assert.equal(h.app.renderVals().solo.on,false);
  await h.app.mineToggle();assert.ok(!h.calls.some(c=>c[0]==='mineStart'));
  h.app.renderVals().solo.toggle();
  const armed=h.app.renderVals();
  assert.equal(armed.solo.on,true);
  assert.equal(armed.mc.btnDisabled,false);
  assert.match(armed.mc.title,/solo override/);
  await h.app.mineToggle();
  assert.deepEqual(h.calls.find(c=>c[0]==='mineStart'),['mineStart','Alice',10000,DEFAULT_INTENSITY,true]);
  assert.ok(h.app.state.activity.some(a=>a.kind==='warn'&&/Solo mining override/.test(a.text)));
});

test('regtest mines without network agreement and a matched tip needs no override',async()=>{
  const h=await ready();
  h.chain.network='regtest';h.chain.peers=0;
  h.chain.peer_best_height=undefined;h.chain.peer_best_tip=undefined;
  await h.app.poll();
  assert.equal(h.app.renderVals().banner.show,false);
  await h.app.mineToggle();
  assert.deepEqual(h.calls.find(c=>c[0]==='mineStart'),['mineStart','Alice',10000,DEFAULT_INTENSITY,false]);

  const matched=await ready();
  assert.equal(matched.app.state.node.status.mining_gate.tip_matches,true);
  assert.equal(matched.app.renderVals().mc.btnDisabled,false);
  await matched.app.mineToggle();
  assert.ok(matched.calls.some(c=>c[0]==='mineStart'));
});

test('a timed-out status call retains stale readings without claiming current reachability',async()=>{
  let answering=true;
  const h=await ready();
  const answer=h.laser.status;
  h.laser.status=async()=>{
    if(!answering)throw new Error('The local node at 127.0.0.1:19544 did not answer within 3 s on 2 attempts; status is unknown.');
    return answer();
  };
  h.laser.startup=async()=>({running:true,ready:true,rpc:{kind:answering?'ok':'busy'}});
  await h.app.poll();
  assert.equal(h.app.state.node.online,true);
  answering=false;await h.app.poll();
  assert.equal(h.app.state.node.waiting,true);
  assert.equal(h.app.state.node.online,true,'a busy node is never reported offline');
  const busy=h.app.renderVals();
  assert.equal(busy.banner.label,'Awaiting node');
  assert.equal(busy.sbar[0].text,'Awaiting node');
  assert.equal(busy.net.kicker,'Waiting');
  assert.doesNotMatch(busy.banner.text,/running and listening/);
  assert.equal(h.app.state.activity[0].kind,'warn');
  assert.match(h.app.state.activity[0].text,/did not answer in time; status is unknown/);
  assert.ok(!h.app.state.activity.some(a=>/Lost connection/.test(a.text)));
  // Readings stay, marked stale, instead of being cleared as unavailable.
  assert.equal(busy.bal.stale,true);
  assert.match(busy.bal.availSub,/status delayed/);
  answering=true;await h.app.poll();
  assert.equal(h.app.state.node.waiting,false);
  assert.match(h.app.state.activity[0].text,/answering again/);
});

test('an unreachable node is still reported as a lost connection',async()=>{
  const h=await ready();
  h.laser.status=async()=>{throw new Error('Cannot reach the local node at 127.0.0.1:19544.');};
  h.laser.startup=async()=>({running:false,ready:false,rpc:{kind:'unreachable'}});
  await h.app.poll();
  assert.equal(h.app.state.node.online,false);
  assert.equal(h.app.state.node.waiting,false);
  assert.match(h.app.state.activity[0].text,/Lost connection/);
  assert.equal(h.app.renderVals().sbar[0].text,'Node offline');
});

test('remote blocks are logged as chain advances, never local mining rewards',async()=>{
  const h=setup();h.app.state.node={online:true,lastOk:1,status:{height:10}};await h.app.poll();
  assert.equal(h.app.state.activity[0].kind,'chain');assert.match(h.app.state.activity[0].text,/Chain advanced/);
});
