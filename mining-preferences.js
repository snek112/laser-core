'use strict';
const fs = require('fs');
const path = require('path');
const { miningIntensity } = require('./ipc-validation');

// Mining starts at a low intensity unless the operator has chosen otherwise,
// so a first run does not commit the whole machine to it.
const DEFAULT_MINING_INTENSITY = 25;

function loadMiningPreferences(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (typeof value.intensity !== 'number') throw new Error('Missing intensity');
    return { intensity: miningIntensity(value.intensity), saved: true };
  } catch (_) {
    return { intensity: DEFAULT_MINING_INTENSITY, saved: false };
  }
}

function saveMiningPreferences(file, intensity) {
  const value = miningIntensity(intensity);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({ intensity: value }) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function researchPaused(intensity) {
  return miningIntensity(intensity) <= 25;
}

module.exports = {
  DEFAULT_MINING_INTENSITY,
  loadMiningPreferences,
  saveMiningPreferences,
  researchPaused
};
