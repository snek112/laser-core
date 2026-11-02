'use strict';

const MAX_PROTOCOL_PHOTONS = 18446744073709551615n;

function blockCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error('Block count must be an integer from 1 through 100.');
  }
  return count;
}

function miningIntensity(value = 100) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 10 || value > 100) {
    throw new Error('Mining intensity must be a whole number from 10 through 100.');
  }
  return value;
}

// Mining on a chain the network has moved past is refused by default, so the
// override past that refusal has to be a deliberate boolean, never a value
// that merely looks truthy.
function soloMiningOverride(value) {
  if (value === undefined || value === null || value === false) return false;
  if (value !== true) {
    throw new Error('The solo mining override must be true or false.');
  }
  return true;
}

function laserAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(address)) {
    throw new Error('Recipient must be a 64-character hexadecimal Laser address.');
  }
  return address;
}

function laserValue(value, label, allowZero) {
  const text = String(value ?? '').trim();
  if (text.length > 32) {
    throw new Error(`${label} is outside the supported range.`);
  }
  const match = /^([0-9]+)(?:\.([0-9]{1,9}))?$/.exec(text);
  if (!match) {
    throw new Error(`${label} must be a decimal value with at most 9 places.`);
  }
  const photons = BigInt(match[1]) * 1000000000n +
    BigInt((match[2] || '').padEnd(9, '0'));
  if ((!allowZero && photons === 0n) || photons > MAX_PROTOCOL_PHOTONS) {
    throw new Error(`${label} is outside the supported range.`);
  }
  return {
    photons,
    text: `${BigInt(match[1])}.${(match[2] || '').padEnd(9, '0')}`
  };
}

module.exports = {
  blockCount,
  miningIntensity,
  soloMiningOverride,
  laserAddress,
  laserValue,
  MAX_PROTOCOL_PHOTONS
};
