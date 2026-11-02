'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { miningIntensity, blockCount, soloMiningOverride } = require('../ipc-validation');
const { researchPaused, DEFAULT_MINING_INTENSITY } = require('../mining-preferences');

function harness(channel = 'v3', savedIntensity = 100, chainReady = true) {
  const handlers = new Map(), jobs = [], timers = [], controls = [];
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const miningSource = source.slice(source.indexOf('function miningIntensityArgs('), source.indexOf("registerMainHandler('laser:send'"));
  const context = {
    runtime: { channel }, miningIntensity, blockCount, walletName: n => n,
    path, app: {getPath: () => 'isolated'},
    loadMiningPreferences: () => ({intensity:savedIntensity,saved:true}),
    saveMiningPreferences: (_file, intensity) => controls.push(['save-intensity',intensity]),
    researchPaused, DEFAULT_MINING_INTENSITY, soloMiningOverride,
    requireCurrentChain: async solo => {
      controls.push(['require-current-chain', solo]);
      if (typeof chainReady === 'function') await chainReady();
      else if (!chainReady) throw new Error('Mining is refused: the local chain is behind the best height its peers report.');
    },
    nodeReady:true, shadowError:null,
    stopShadow: async () => {controls.push(['pause-research']);return true;},
    startShadow: () => {controls.push(['resume-research']);return true;},
    registerMainHandler: (name, fn) => handlers.set(name, fn),
    walletCommand: (args, wallet, timeout) => new Promise((resolve, reject) => jobs.push({args, wallet, timeout, resolve, reject})),
    queryMinerMetrics: async () => ({ total_mined_photons: '0' }),
    lockWalletSecret() {}, laserCmd: async args => controls.push(args),
    setTimeout: fn => {timers.push(fn);return timers.length;}, clearTimeout() {},
    LASER_RPC: 'test', LASER_DATADIR: 'isolated', LASER_NETWORK: 'regtest',
    miningBackend: 'cuda', cudaAvailable: true, powProfile: 'v02', mainWindow: null,
    Date, console
  };
  vm.runInNewContext(miningSource, context);
  return { jobs, timers, controls, setChainReady: value => { chainReady = value; },
    call: (name, ...args) => {
      const result = handlers.get('laser:' + name)(null, ...args);
      // Model the IPC round trip while the first cycle checks readiness.
      return name === 'mine-start' ? result.then(async value => {
        await new Promise(resolve => setImmediate(resolve));
        return value;
      }) : result;
    } };
}

test('the main process re-checks the chain before mining and carries the override', async () => {
  const armed = harness();
  await armed.call('mine-start', 'Example', 10000, 25, true);
  assert.deepEqual(armed.controls.filter(c => c[0] === 'require-current-chain'),
    [['require-current-chain', true], ['require-current-chain', true]]);
  armed.jobs[0].resolve('Mined');await new Promise(r => setImmediate(r));

  const plain = harness();
  await plain.call('mine-start', 'Example', 10000, 25);
  assert.deepEqual(plain.controls.filter(c => c[0] === 'require-current-chain'),
    [['require-current-chain', false], ['require-current-chain', false]]);
  plain.jobs[0].resolve('Mined');await new Promise(r => setImmediate(r));
  await assert.rejects(plain.call('mine', 'Example', 1, 25, 'yes'), /true or false/);

  const behind = harness('v3', 100, false);
  await assert.rejects(behind.call('mine-start', 'Example', 10000, 25), /behind the best height/);
  await assert.rejects(behind.call('mine', 'Example', 1, 25), /behind the best height/);
  assert.equal(behind.jobs.length, 0);
  assert.equal(behind.call('mine-status').mining, false);
});

test('an intensity change preserves the active job and reaches the next cycle', async () => {
  const h = harness();
  await h.call('mine-start', 'Example', 10000, 25);
  assert.ok(h.jobs[0].args.includes('--intensity'));
  assert.equal(h.jobs[0].args[h.jobs[0].args.indexOf('--intensity') + 1], '25');
  assert.equal(h.jobs[0].timeout, 480000);
  const controlCount = h.controls.length;
  const changed = await h.call('mine-intensity', 10);
  assert.equal(changed.mining, true);assert.equal(changed.active_intensity, 25);assert.equal(changed.intensity, 10);
  assert.equal(h.jobs.length, 1);assert.equal(h.controls.length, controlCount+2);
  assert.ok(!h.controls.some(args=>args.includes('mine-stop')));
  h.jobs[0].resolve('Mined');await new Promise(r => setImmediate(r));
  assert.equal(h.call('mine-status').active_intensity, null);
  h.timers.shift()();await new Promise(r => setImmediate(r));assert.equal(h.jobs.length, 2);
  assert.equal(h.jobs[1].args[h.jobs[1].args.indexOf('--intensity') + 1], '10');
  assert.equal(h.jobs[1].timeout, 1200000);
  await h.call('mine-stop');assert.ok(h.controls.some(args=>args.includes('mine-stop')));
  h.jobs[1].reject(new Error('Cancelled'));await new Promise(r => setImmediate(r));
  assert.equal(h.timers.length, 0);assert.equal(h.call('mine-status').mining, false);
});

test('auto mining stops before the next job when chain agreement is lost', async () => {
  const h = harness();
  await h.call('mine-start', 'Example', 10000, 25);
  h.jobs[0].resolve('Mined');await new Promise(r => setImmediate(r));
  h.setChainReady(false);
  await h.timers.shift()();
  assert.equal(h.jobs.length, 1);
  assert.equal(h.call('mine-status').mining, false);
  assert.equal(h.call('mine-status').session.errors, 1);
  assert.equal(h.timers.length, 0);
});

test('stop while a cycle is awaiting chain status cannot submit a late job', async () => {
  const h = harness();
  await h.call('mine-start', 'Example', 10000, 25, true);
  h.jobs[0].resolve('Mined');await new Promise(r => setImmediate(r));
  let release;
  h.setChainReady(() => new Promise(resolve => { release = resolve; }));
  const pending = h.timers.shift()();
  await h.call('mine-stop');
  release();await pending;
  assert.equal(h.jobs.length, 1);
  assert.equal(h.timers.length, 0);
  assert.equal(h.call('mine-status').mining, false);
  assert.deepEqual(h.controls.filter(c => c[0] === 'require-current-chain').at(-1),
    ['require-current-chain', true]);
});

test('stop while the initial chain check is pending cancels the start', async () => {
  let release;
  const h = harness('v3', 100, () => new Promise(resolve => { release = resolve; }));
  const pending = h.call('mine-start', 'Example', 10000, 25);
  await h.call('mine-stop');
  release();await pending;
  assert.equal(h.jobs.length, 0);
  assert.equal(h.timers.length, 0);
  assert.equal(h.call('mine-status').mining, false);
});

test('invalid intensity cannot start a job and old runtimes reject throttling explicitly', async () => {
  const h = harness();
  await assert.rejects(h.call('mine-start', 'Example', 10000, 0));
  await assert.rejects(h.call('mine', 'Example', 1, 101));
  await assert.rejects(h.call('mine-intensity', 25.5));
  assert.equal(h.jobs.length, 0);
  const old = harness('sandbox-v2');
  await assert.rejects(old.call('mine-start', 'Example', 10000, 25), /v3/);
  await old.call('mine-start', 'Example', 10000, 100);
  assert.ok(!old.jobs[0].args.includes('--intensity'));
  old.jobs[0].resolve('Mined');await new Promise(r => setImmediate(r));
});

test('saved low intensity pauses research and higher settings resume it without stopping mining', async () => {
  const h=harness('v3',10);
  assert.equal(h.call('mine-status').intensity,10);
  assert.equal(h.call('mine-status').research_paused,true);
  await h.call('mine-start','Example',10000,10);
  assert.ok(h.controls.some(c=>c[0]==='pause-research'));
  await h.call('mine-intensity',50);
  assert.equal(h.call('mine-status').research_paused,false);
  assert.equal(h.call('mine-status').mining,true);
  assert.ok(h.controls.some(c=>c[0]==='resume-research'));
  assert.equal(h.jobs.length,1);
  assert.equal(h.call('mine-status').active_intensity,10);
  assert.ok(!h.controls.some(c=>c.includes('mine-stop')));
  h.jobs[0].resolve('Mined');await new Promise(r=>setImmediate(r));
});
