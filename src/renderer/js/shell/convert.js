// Unit conversion for the launcher: "10 km to mi", "72 f in c", "5 gb to mb",
// "90 kmh to mph", "2.5 h to min". Offline and exact (factors to a base unit).
import { formatNumber } from "./calc.js";

const U = (dim, factor, names, label = names[0]) => ({ dim, factor, names, label });
const UNITS = [
  // length (m)
  U("length", 1e-3, ["mm", "millimeter", "millimeters", "millimetre", "millimetres"]),
  U("length", 1e-2, ["cm", "centimeter", "centimeters", "centimetre", "centimetres"]),
  U("length", 1, ["m", "meter", "meters", "metre", "metres"]),
  U("length", 1000, ["km", "kilometer", "kilometers", "kilometre", "kilometres"]),
  U("length", 0.0254, ["in", "inch", "inches", "\""], "in"),
  U("length", 0.3048, ["ft", "foot", "feet", "'"], "ft"),
  U("length", 0.9144, ["yd", "yard", "yards"]),
  U("length", 1609.344, ["mi", "mile", "miles"]),
  U("length", 1852, ["nmi", "nautical mile", "nautical miles"]),
  // mass (kg)
  U("mass", 1e-6, ["mg", "milligram", "milligrams"]),
  U("mass", 1e-3, ["g", "gram", "grams"]),
  U("mass", 1, ["kg", "kilogram", "kilograms", "kilo", "kilos"]),
  U("mass", 1000, ["t", "tonne", "tonnes", "metric ton"]),
  U("mass", 0.028349523125, ["oz", "ounce", "ounces"]),
  U("mass", 0.45359237, ["lb", "lbs", "pound", "pounds"]),
  U("mass", 6.35029318, ["st", "stone", "stones"]),
  // volume (l)
  U("volume", 1e-3, ["ml", "milliliter", "milliliters", "millilitre"]),
  U("volume", 1, ["l", "liter", "liters", "litre", "litres"]),
  U("volume", 3.785411784, ["gal", "gallon", "gallons"]),
  U("volume", 0.946352946, ["qt", "quart", "quarts"]),
  U("volume", 0.473176473, ["pt", "pint", "pints"]),
  U("volume", 0.2365882365, ["cup", "cups"]),
  U("volume", 0.0295735295625, ["floz", "fl oz", "fluid ounce", "fluid ounces"], "fl oz"),
  // area (m²)
  U("area", 1, ["m2", "m²", "sqm", "square meter", "square meters"], "m²"),
  U("area", 1e6, ["km2", "km²", "square kilometer", "square kilometers"], "km²"),
  U("area", 0.09290304, ["ft2", "ft²", "sqft", "square foot", "square feet"], "ft²"),
  U("area", 4046.8564224, ["acre", "acres"]),
  U("area", 10000, ["ha", "hectare", "hectares"]),
  // speed (m/s)
  U("speed", 1, ["m/s", "mps"]),
  U("speed", 1 / 3.6, ["km/h", "kmh", "kph"], "km/h"),
  U("speed", 0.44704, ["mph"]),
  U("speed", 0.514444, ["kn", "knot", "knots"]),
  // time (s)
  U("time", 1e-3, ["ms", "millisecond", "milliseconds"]),
  U("time", 1, ["s", "sec", "secs", "second", "seconds"]),
  U("time", 60, ["min", "mins", "minute", "minutes"]),
  U("time", 3600, ["h", "hr", "hrs", "hour", "hours"]),
  U("time", 86400, ["d", "day", "days"]),
  U("time", 604800, ["wk", "week", "weeks"]),
  U("time", 31557600, ["yr", "year", "years"]),
  // data (bytes; SI and binary)
  U("data", 1 / 8, ["bit", "bits"]),
  U("data", 1, ["b", "byte", "bytes"], "B"),
  U("data", 1e3, ["kb", "kilobyte", "kilobytes"], "KB"),
  U("data", 1e6, ["mb", "megabyte", "megabytes"], "MB"),
  U("data", 1e9, ["gb", "gigabyte", "gigabytes"], "GB"),
  U("data", 1e12, ["tb", "terabyte", "terabytes"], "TB"),
  U("data", 1024, ["kib", "kibibyte"], "KiB"),
  U("data", 1024 ** 2, ["mib", "mebibyte"], "MiB"),
  U("data", 1024 ** 3, ["gib", "gibibyte"], "GiB"),
  U("data", 1024 ** 4, ["tib", "tebibyte"], "TiB"),
  // energy (J) / power (W)
  U("energy", 1, ["j", "joule", "joules"], "J"),
  U("energy", 4184, ["kcal", "calorie", "calories"], "kcal"),
  U("energy", 3.6e6, ["kwh"], "kWh"),
  U("power", 1, ["w", "watt", "watts"], "W"),
  U("power", 1000, ["kw", "kilowatt", "kilowatts"], "kW"),
  U("power", 745.699872, ["hp", "horsepower"]),
  // temperature (special)
  U("temp", null, ["c", "°c", "celsius"], "°C"),
  U("temp", null, ["f", "°f", "fahrenheit"], "°F"),
  U("temp", null, ["k", "kelvin"], "K")
];
const BY_NAME = new Map();
for (const u of UNITS) for (const n of u.names) BY_NAME.set(n, u);

const toKelvin = { "°C": (v) => v + 273.15, "°F": (v) => (v - 32) * 5 / 9 + 273.15, K: (v) => v };
const fromKelvin = { "°C": (v) => v - 273.15, "°F": (v) => (v - 273.15) * 9 / 5 + 32, K: (v) => v };

const RE = /^\s*(-?\d[\d,]*(?:\.\d+)?|-?\.\d+)\s*([a-z°²/"' ]+?)\s+(?:to|in|as|into|->|=)\s+([a-z°²/"' ]+?)\s*$/i;

// Returns { text, value, from, to } or null.
export function convert(query) {
  const m = RE.exec(query);
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ""));
  const from = BY_NAME.get(m[2].trim().toLowerCase());
  const to = BY_NAME.get(m[3].trim().toLowerCase());
  if (!Number.isFinite(value) || !from || !to || from.dim !== to.dim || from === to) return null;
  const result = from.dim === "temp"
    ? fromKelvin[to.label](toKelvin[from.label](value))
    : (value * from.factor) / to.factor;
  const rounded = Math.abs(result) >= 1e-4 || result === 0 ? Number(result.toPrecision(10)) : result;
  return { value: rounded, text: `${formatNumber(rounded)} ${to.label}`, from: `${formatNumber(value)} ${from.label}`, to: to.label };
}

// "5m", "90s", "1h30m", "2.5 min", "1:30" (m:s), "10" (minutes) → milliseconds.
export function parseDuration(text) {
  const s = String(text).trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) > 0 ? Number(s) * 60000 : null;
  const colon = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (colon) return colon[3] !== undefined
    ? ((+colon[1] * 60 + +colon[2]) * 60 + +colon[3]) * 1000
    : (+colon[1] * 60 + +colon[2]) * 1000;
  let total = 0;
  let matched = false;
  // Longest unit names first, so "2.5 min" is not read as "2.5 m" + "in".
  const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/g;
  let rest = s;
  for (const part of s.matchAll(re)) {
    matched = true;
    const n = Number(part[1]);
    const unit = part[2][0];
    total += unit === "h" ? n * 3600000 : unit === "m" ? n * 60000 : n * 1000;
    rest = rest.replace(part[0], "");
  }
  if (!matched || rest.trim()) return null;
  return total > 0 ? total : null;
}
