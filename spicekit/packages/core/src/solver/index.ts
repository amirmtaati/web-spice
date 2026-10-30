/**
 * Linear solver facade (SPEC §5.4). Stage 1 is the dense LU; stage 2 (E4)
 * is the sparse LU with the symbolic factorization (Markowitz order + fill
 * accounting) reused across Newton iterations and timesteps — numeric
 * refactor only. E3 adds the complex LU behind `luFactorC`/`luSolveC` for
 * `.ac`/`.noise`.
 */
export { luFactorC, luSolveC } from "./complex.ts";
export { type LuFactors, luFactor, luSolve } from "./lu.ts";
export { SparseLU, type SparsityPattern, SymbolicLU } from "./sparse.ts";
