export function hashSeed(value) {
  const text = String(value ?? "default");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRoller(options = {}) {
  const injected = options.roller;
  if (typeof injected === "function") {
    return { next: injected, source: "injected" };
  }
  const rawSeed = options.seed ?? hashSeed(options.seedText ?? "magtopia-random");
  const seed = typeof rawSeed === "number" && Number.isFinite(rawSeed) ? rawSeed : hashSeed(rawSeed);
  const next = mulberry32(seed);
  return { next, source: "seeded", seed };
}

export function rollNumber(roller, min = 0, max = 1, options = {}) {
  const value = options.next ?? roller.next();
  return min + (max - min) * value;
}

export function randomInt(roller, min, max) {
  return Math.floor(rollNumber(roller, min, max + 1));
}

export function pick(roller, values) {
  if (!values.length) return undefined;
  return values[randomInt(roller, 0, values.length - 1)];
}

export function chance(roller, probability) {
  return roller.next() < probability;
}

export function rollDice(roller, sides = 20) {
  return randomInt(roller, 1, sides);
}
