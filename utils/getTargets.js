"use strict";
/**
 * @param {string} cfg
 * @returns {Map<string, string>} */
exports.getTargets = function(cfg) {
  const targets = new Map();
  for (const target of cfg.split(",")) {
    const i = target.indexOf(":");
    if (i === -1) {
      targets.set(target, target);
    } else {
      const left = target.slice(0, i).trim();
      const right = target.slice(i + 1).trim();
      if (!left.length || !right.length) {
        console.warn(`Invalid target format "${target}". Skipping.`);
        continue;
      }
      targets.set(left, right);
    }
  }
  return targets;
};
