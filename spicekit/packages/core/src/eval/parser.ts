/**
 * Recursive-descent expression compiler (SPEC §5.6). Produces closures over
 * `EvalContext` — no AST interpretation on the hot path, and never `eval` or
 * `new Function` (SPEC §12.4). Precedence (low → high): ternary, ||, &&,
 * equality, comparison, additive, multiplicative, unary, power (right-assoc).
 * Comparisons yield 1/0 so they compose with arithmetic and ternaries.
 */

import { CONSTANTS, compileCall, type EvalFn } from "./functions.ts";
import { ExpressionError, type Token, tokenize } from "./tokenizer.ts";

export function compileExpression(src: string): EvalFn {
  const tokens = tokenize(src);
  const parser = new ExprParser(tokens, src);
  const fn = parser.parseTernary();
  const end = parser.peek();
  if (end.type !== "end") {
    throw new ExpressionError(`Unexpected token "${end.text}"`, end.pos);
  }
  return fn;
}

class ExprParser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly src: string,
  ) {}

  peek(): Token {
    return this.tokens[this.index] as Token;
  }

  next(): Token {
    const token = this.tokens[this.index] as Token;
    this.index += 1;
    return token;
  }

  expectOp(op: string): void {
    const token = this.next();
    if (token.type !== "op" || token.text !== op) {
      throw new ExpressionError(`Expected "${op}"`, token.pos);
    }
  }

  parseTernary(): EvalFn {
    const condition = this.parseOr();
    if (this.peek().type === "op" && this.peek().text === "?") {
      this.next();
      const thenFn = this.parseTernary();
      this.expectOp(":");
      const elseFn = this.parseTernary();
      return (ctx) => (condition(ctx) !== 0 ? thenFn(ctx) : elseFn(ctx));
    }
    return condition;
  }

  private parseBinary(
    operand: (p: ExprParser) => EvalFn,
    ops: Readonly<Record<string, (a: number, b: number) => number>>,
  ): EvalFn {
    let left = operand(this);
    for (;;) {
      const token = this.peek();
      if (token.type === "op" && ops[token.text] !== undefined) {
        this.next();
        const right = operand(this);
        const fn = ops[token.text] as (a: number, b: number) => number;
        const l = left;
        left = (ctx) => fn(l(ctx), right(ctx));
        continue;
      }
      return left;
    }
  }

  private parseOr(): EvalFn {
    return this.parseBinary((p) => p.parseAnd(), {
      "||": (a, b) => (a !== 0 || b !== 0 ? 1 : 0),
    });
  }

  private parseAnd(): EvalFn {
    return this.parseBinary((p) => p.parseEquality(), {
      "&&": (a, b) => (a !== 0 && b !== 0 ? 1 : 0),
    });
  }

  private parseEquality(): EvalFn {
    return this.parseBinary((p) => p.parseCompare(), {
      "==": (a, b) => (a === b ? 1 : 0),
      "!=": (a, b) => (a !== b ? 1 : 0),
    });
  }

  private parseCompare(): EvalFn {
    return this.parseBinary((p) => p.parseAdditive(), {
      "<": (a, b) => (a < b ? 1 : 0),
      "<=": (a, b) => (a <= b ? 1 : 0),
      ">": (a, b) => (a > b ? 1 : 0),
      ">=": (a, b) => (a >= b ? 1 : 0),
    });
  }

  private parseAdditive(): EvalFn {
    return this.parseBinary((p) => p.parseMultiplicative(), {
      "+": (a, b) => a + b,
      "-": (a, b) => a - b,
    });
  }

  private parseMultiplicative(): EvalFn {
    return this.parseBinary((p) => p.parseUnary(), {
      "*": (a, b) => a * b,
      "/": (a, b) => a / b,
      "%": (a, b) => a % b,
    });
  }

  private parseUnary(): EvalFn {
    const token = this.peek();
    if (token.type === "op" && (token.text === "-" || token.text === "+" || token.text === "!")) {
      this.next();
      const operand = this.parseUnary();
      if (token.text === "-") {
        return (ctx) => -operand(ctx);
      }
      if (token.text === "+") {
        return operand;
      }
      return (ctx) => (operand(ctx) === 0 ? 1 : 0);
    }
    return this.parsePower();
  }

  /** Power binds tighter than unary minus on the left, looser on the right. */
  private parsePower(): EvalFn {
    const base = this.parsePrimary();
    const token = this.peek();
    if (token.type === "op" && (token.text === "^" || token.text === "**")) {
      this.next();
      const exponent = this.parseUnary();
      return (ctx) => base(ctx) ** exponent(ctx);
    }
    return base;
  }

  private parsePrimary(): EvalFn {
    const token = this.next();
    switch (token.type) {
      case "number": {
        const value = token.value;
        return () => value;
      }
      case "lparen": {
        const inner = this.parseTernary();
        const close = this.next();
        if (close.type !== "rparen") {
          throw new ExpressionError("Expected ')'", close.pos);
        }
        return inner;
      }
      case "ident": {
        return this.parseIdentifier(token);
      }
      case "end":
        throw new ExpressionError(`Unexpected end of expression: "${this.src}"`, token.pos);
      case "comma":
      case "op":
      case "rparen":
        throw new ExpressionError(`Unexpected token "${token.text}"`, token.pos);
      default:
        throw new ExpressionError("Unexpected token type", token.pos);
    }
  }

  private parseIdentifier(token: Token): EvalFn {
    const name = token.text;
    const lower = name.toLowerCase();
    if (this.peek().type === "lparen") {
      this.next(); // consume '('
      if (lower === "v" || lower === "i") {
        return this.parseAccess(lower, token.pos);
      }
      const args: EvalFn[] = [];
      if (this.peek().type !== "rparen") {
        args.push(this.parseTernary());
        while (this.peek().type === "comma") {
          this.next();
          args.push(this.parseTernary());
        }
      }
      const close = this.next();
      if (close.type !== "rparen") {
        throw new ExpressionError(`Expected ')' after ${name}(...)`, close.pos);
      }
      return compileCall(name, args, token.pos);
    }
    const constant = CONSTANTS[lower];
    if (constant !== undefined) {
      return constant;
    }
    if (lower === "time") {
      return (ctx) => ctx.time;
    }
    // Bare identifier: a named parameter (case-insensitive).
    return (ctx) => {
      const value = ctx.param(lower);
      if (value === undefined) {
        throw new Error(`Unknown identifier "${name}" in expression`);
      }
      return value;
    };
  }

  /**
   * v(node)/i(element): the target is captured as a raw name token at parse
   * time (node names may be numeric — "v(1)" — so expression parsing cannot
   * produce them). Case handling is delegated to the context lookup.
   */
  private parseAccess(lower: string, pos: number): EvalFn {
    const target = this.next();
    if (target.type !== "ident" && target.type !== "number") {
      throw new ExpressionError(`${lower}() expects a node/element name`, pos);
    }
    const close = this.next();
    if (close.type !== "rparen") {
      throw new ExpressionError(`Expected ')' after ${lower}(${target.text}`, close.pos);
    }
    const name = target.text;
    return lower === "v" ? (ctx) => ctx.v(name) : (ctx) => ctx.i(name);
  }
}
