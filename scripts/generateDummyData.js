"use strict";
const { context } = require("@arangodb/locals");
const { db } = require("@arangodb");
const { getTargets } = require("../utils/getTargets");
const targets = getTargets(context.configuration.targets);

const ONE_DAY = 24 * 60 * 60 * 1000;
const START = Date.now() - ONE_DAY;
const COUNTRIES = ["de", "es", "fr", "in", "nl", "ru", "us"];
const STATUS_CODES = [200, 404, 201, 400, 500];

/** @type {(max: number, min?: number) => number} */
const randInt = (max = Number.MAX_SAFE_INTEGER, min = 0) =>
  min + Math.floor((max - min) * Math.random());
/** @type {<T>(arr: T[]) => T} */
const pick = arr => arr[randInt(arr.length)];
/** @type {<T>(arr: T[]) => T} */
const pickBiased = arr => {
  let n = Math.random();
  for (const value of arr) {
    if (n < 0.5) n *= 2;
    else return value;
  }
  return arr[0];
};

for (const collectionName of targets.values()) {
  const collection = db._collection(collectionName);
  if (collection.count()) {
    console.warn(`Collection not empty: "${collectionName}". Skipping.`);
    continue;
  }
  let prev = [0, 0, 0];
  for (let i = 0; i < ONE_DAY / 100; i++) {
    const latencyMs = (prev[0] + prev[1] + Math.random() * 10 ** 4) / 3;
    prev.pop();
    prev.unshift(latencyMs);
    const country = pick(COUNTRIES);
    collection.save({
      date: START + (i + Math.random()) * 100,
      ip: [192, 168, randInt(256), randInt(255, 1)].join("."),
      statusCode: pickBiased(STATUS_CODES),
      latencyMs,
      country,
      luckyNumbers: {
        of10: randInt(10),
        of100: randInt(100)
      }
    });
  }
}
