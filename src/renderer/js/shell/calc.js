// Safe arithmetic evaluator for the launcher (no eval — the CSP forbids it
// anyway). Supports + - * / % ^, parentheses, unary minus, constants and a
// few functions.
const FUNCS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  log: Math.log10, ln: Math.log, exp: Math.exp
};
const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
const PREC = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3, "u-": 4 };
const RIGHT = new Set(["^", "u-"]);

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)|([a-z]+)|(\*\*|[-+*/%^(),]))/giy;
  let m;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    m = re.exec(src);
    if (!m || m.index !== pos) {
      if (/^\s+$/.test(src.slice(pos))) break;
      return null;
    }
    pos = re.lastIndex;
    if (m[1]) tokens.push({ t: "num", v: parseFloat(m[1]) });
    else if (m[2]) tokens.push({ t: "id", v: m[2].toLowerCase() });
    else tokens.push({ t: "op", v: m[3] === "**" ? "^" : m[3] });
  }
  return tokens;
}

export function evaluate(input) {
  const src = String(input).replace(/,/g, "").replace(/×/g, "*").replace(/÷/g, "/").trim();
  if (!src || src.length > 200) return null;
  const tokens = tokenize(src);
  if (!tokens || !tokens.length) return null;
  const out = [];
  const ops = [];
  let prev = null;
  for (const tok of tokens) {
    if (tok.t === "num") out.push(tok.v);
    else if (tok.t === "id") {
      if (tok.v in CONSTS) out.push(CONSTS[tok.v]);
      else if (tok.v in FUNCS) ops.push({ fn: tok.v });
      else return null;
    } else if (tok.v === "(") ops.push("(");
    else if (tok.v === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop());
      if (!ops.length) return null;
      ops.pop();
      if (ops.length && ops[ops.length - 1].fn) out.push(ops.pop());
    } else {
      let op = tok.v;
      const unary = op === "-" && (!prev || (prev.t === "op" && prev.v !== ")"));
      if (op === "+" && (!prev || (prev.t === "op" && prev.v !== ")"))) { prev = tok; continue; }
      if (unary) op = "u-";
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top === "(" || top.fn) break;
        if (PREC[top] > PREC[op] || (PREC[top] === PREC[op] && !RIGHT.has(op))) out.push(ops.pop());
        else break;
      }
      ops.push(op);
    }
    prev = tok;
  }
  while (ops.length) {
    const op = ops.pop();
    if (op === "(") return null;
    out.push(op);
  }
  const stack = [];
  for (const item of out) {
    if (typeof item === "number") stack.push(item);
    else if (item.fn) {
      if (!stack.length) return null;
      stack.push(FUNCS[item.fn](stack.pop()));
    } else if (item === "u-") {
      if (!stack.length) return null;
      stack.push(-stack.pop());
    } else {
      if (stack.length < 2) return null;
      const b = stack.pop(), a = stack.pop();
      stack.push(item === "+" ? a + b : item === "-" ? a - b : item === "*" ? a * b : item === "/" ? a / b : item === "%" ? a % b : a ** b);
    }
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) return null;
  return stack[0];
}

export function looksLikeMath(q) {
  const s = q.trim();
  if (s.startsWith("=")) return true;
  return /^[\d\s.()+\-*/%^,a-z]+$/i.test(s) && /\d/.test(s) && /[+\-*/%^(]/.test(s.replace(/^-/, "")) && !/^[a-z]+$/i.test(s);
}

export function formatNumber(n) {
  if (Math.abs(n) >= 1e15 || (Math.abs(n) < 1e-6 && n !== 0)) return n.toExponential(6);
  return String(Math.round(n * 1e10) / 1e10);
}
