'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {miningGate}=require('../mining-gate');
const root=path.resolve(__dirname,'..');
const TIP='ab'.repeat(32), DEFAULT_INTENSITY=50;
function setup(bridge={},stored={}) {
  const storage=new Map(Object.entries(stored));
  const calls=[];
  const chain={network:'shadow',height:12,tip:TIP,blocks:13,mempool:0,orphans:0,peers:2,target_spacing_seconds:10,peer_best_height:12,peer_best_tip:TIP};
  let mine={mining:false,wallet:null,backend:'cpu',cuda_available:false,cpu_fallback:true,intensity:DEFAULT_INTENSITY,session:{blocks:0,errors:0,started_at:null}};
  const wallets=new Map([['Alice',{name:'Alice',address:'a1'.repeat(32),balance_photons:'9007199254740993',nonce:0}],['Bob',{name:'Bob',address:'b2'.repeat(32),balance_photons:'20000000000',nonce:0}]]);
  const unlocked=new Set();
  const listeners={};
  const metrics=n=>({wallet:n,confirmed_photons:wallets.get(n).balance_photons,pending_spent_photons:'0',pending_received_photons:'0',projected_photons:wallets.get(n).balance_photons,blocks_mined:0,total_mined_photons:'0',subsidy_photons:'0',fee_photons:'0',has_last:false,next_reward_photons:'7527996698'});
  const laser={
    startup:async()=>({ready:true,appVersion:'0.2.0-beta.1',channel:'v3'}),
    status:async()=>{const st={...chain,median_time_past:Math.floor(Date.now()/1000)-30};return {...st,mining_gate:miningGate(st)};},
    peers:async()=>({peers:2,outbound:2,inbound:0,connecting:0}),
    config:async()=>({channel:'v3',network:'shadow',walletDir:'test/wallets'}),
    publisherStatus:async()=>({state:'unconfigured',enabled:false,url:''}),
    publisherSave:async input=>({state:input.enabled?'waiting':'unconfigured',enabled:input.enabled,url:input.url||''}),
    onPublisherSettings:cb=>{listeners.publisher=cb;return ()=>delete listeners.publisher;},
    walletList:async()=>[...wallets.keys()],walletUnlocked:async n=>unlocked.has(n),
    walletOpen:async(n,pass)=>{calls.push(['walletOpen',n,pass]);if(pass)unlocked.add(n);if(!unlocked.has(n))throw new Error('Wallet is locked.');return wallets.get(n);},
    walletCreate:async(n,pass)=>{calls.push(['walletCreate',n]);wallets.set(n,{name:n,address:'c3'.repeat(32),balance_photons:'0',nonce:0});unlocked.add(n);return wallets.get(n);},
    walletRestore:async n=>{wallets.set(n,{name:n,address:'d4'.repeat(32),balance_photons:'0'});return {name:n};},
    walletLock:async n=>{calls.push(['walletLock',n]);unlocked.delete(n);mine={...mine,mining:false};return true;},
    minerMetrics:async n=>metrics(n),mineStatus:async()=>mine,
    mineStart:async(n,interval,intensity=DEFAULT_INTENSITY,solo=false)=>{calls.push(['mineStart',n,interval,intensity,solo]);mine={...mine,mining:true,wallet:n,interval,intensity};return mine;},
    mineSetIntensity:async intensity=>{calls.push(['mineSetIntensity',intensity]);mine={...mine,intensity};return mine;},
    mineStop:async()=>{calls.push(['mineStop']);mine={...mine,mining:false};return mine;},
    mine:async(n,count,intensity=DEFAULT_INTENSITY,solo=false)=>{calls.push(['mine',n,count,intensity,solo]);return 'Mined '+count+' blocks';},
    send:async(...args)=>{calls.push(['send',...args]);return 'Accepted by node';},
    copyAddress:async a=>{calls.push(['copyAddress',a]);return true;},
    onBlockMined:cb=>{listeners.block=cb;return ()=>delete listeners.block;},
    onMineError:cb=>{listeners.error=cb;return ()=>delete listeners.error;},
    ...bridge
  };
  class Component {constructor(props={}){this.props=props;}setState(patch,cb){this.state={...this.state,...(typeof patch==='function'?patch(this.state):patch)};cb?.();}}
  const context={module:{exports:{}},React:{Component,Fragment:'fragment',createElement:(tag,props,...children)=>({tag,props,children})},window:{innerWidth:960,innerHeight:640,laser,matchMedia:()=>({matches:true}),addEventListener(){},removeEventListener(){}},document:{querySelector:()=>null,addEventListener(){},removeEventListener(){}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setTimeout:()=>1,clearTimeout(){},setInterval:()=>2,clearInterval(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},performance:{now:()=>100},Date,console};
  vm.runInNewContext(fs.readFileSync(path.join(root,'renderer/template.js'),'utf8'),context);
  vm.runInNewContext(fs.readFileSync(path.join(root,'renderer/app.js'),'utf8'),context);
  const app=new context.module.exports.Component();
  app.m=laser;app.walletEpoch={};app.localBlocks=0;
  return {app,laser,calls,unlocked,wallets,metrics,storage,listeners,chain,tip:TIP,...context.module.exports};
}
module.exports={setup,TIP,DEFAULT_INTENSITY};
