'use strict';

// Mining must extend the chain the rest of the network is on. A block solved
// on a tip the network has already moved past is discarded, which is what
// happens when mining is allowed during initial block download.
//
// The gate compares the local tip against the best chain the node's peers have
// announced, by height and by tip hash, so a node sitting at the right height
// on a forked or stale chain is still refused.
//
// Updated nodes expose fresh, completed header-sync observations as
// peer_best_height/peer_best_tip. Older runtimes or nodes still discovering,
// syncing, or refreshing their peer view fail closed. These observations are
// a local readiness check, not proof of agreement by the whole network.
const PEER_MINIMUM = 1;
const EXEMPT_NETWORKS = new Set(['regtest']);
const OVERRIDABLE = new Set(['peers', 'peer-chain-unknown', 'height', 'tip']);
const TIP_HASH = /^[0-9a-f]{64}$/;
// median_time_past is the median of the last eleven block times, so it trails
// even a current tip by about five intervals. Tip age does not gate mining; it
// is reported so the interface can show how far behind the node is and warn
// when the solo override is used on a chain that is plainly not current.
const TIP_AGE_INTERVALS = 30;
const TIP_AGE_FLOOR_SECONDS = 180;
const TIP_AGE_TRAIL_INTERVALS = 6;

function tipHash(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return TIP_HASH.test(text) ? text : null;
}

function count(value) {
  if (typeof value !== 'number' &&
      !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function peerChainView(status) {
  if (status.peer_chain_known === false || status.peer_chain_known === 0) return null;
  const height = count(status.peer_best_height);
  const tip = tipHash(status.peer_best_tip);
  return height === null || tip === null ? null : { height, tip };
}

function tipAge(status, now) {
  const spacing = count(status.target_spacing_seconds) || 10;
  const medianTimePast = count(status.median_time_past);
  const seconds = medianTimePast
    ? Math.max(0, Math.round(now / 1000 - medianTimePast))
    : null;
  const allowed = Math.max(TIP_AGE_FLOOR_SECONDS, spacing * TIP_AGE_INTERVALS);
  return {
    target_spacing_seconds: spacing,
    tip_age_seconds: seconds,
    tip_age_allowed_seconds: allowed,
    tip_fresh: seconds === null ? null : seconds <= allowed,
    tip_age_blocks: seconds === null
      ? null
      : Math.max(0, Math.round((seconds - spacing * TIP_AGE_TRAIL_INTERVALS) / spacing))
  };
}

function miningGate(status, options = {}) {
  const solo = options.soloOverride === true;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const chain = status || {};
  const network = String(chain.network || '') || null;
  const exempt = EXEMPT_NETWORKS.has(network);
  const localHeight = count(chain.height);
  const localTip = tipHash(chain.tip);
  const peers = count(chain.peers);
  const view = peerChainView(chain);

  let blockedBy = 'none';
  if (!status || localHeight === null || localTip === null) blockedBy = 'chain-unreadable';
  else if (exempt) blockedBy = 'none';
  else if (peers === null || peers < PEER_MINIMUM) blockedBy = 'peers';
  else if (!view) blockedBy = 'peer-chain-unknown';
  else if (view.height > localHeight) blockedBy = 'height';
  else if (view.tip !== localTip) blockedBy = 'tip';

  const overridable = OVERRIDABLE.has(blockedBy);
  return {
    ok: blockedBy === 'none' || (solo && overridable),
    blocked_by: blockedBy,
    overridable,
    solo_override: solo,
    network,
    regtest_exempt: exempt,
    peers,
    peers_required: PEER_MINIMUM,
    local_height: localHeight,
    local_tip: localTip,
    peer_best_height: view ? view.height : null,
    peer_best_tip: view ? view.tip : null,
    peer_chain_known: Boolean(view),
    blocks_behind: view && localHeight !== null
      ? Math.max(0, view.height - localHeight)
      : null,
    tip_matches: view ? view.tip === localTip : null,
    ...tipAge(chain, now)
  };
}

module.exports = {
  miningGate,
  peerChainView,
  EXEMPT_NETWORKS,
  OVERRIDABLE,
  PEER_MINIMUM
};
