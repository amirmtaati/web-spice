/**
 * Linear solver facade (SPEC §5.4). Stage 1 is the dense LU; the sparse LU
 * (Markowitz/AMD ordering, Gilbert-Peierls, symbolic factorization reused
 * across Newton iterations) arrives with E4 behind this same facade.
 */
export { type LuFactors, luFactor, luSolve } from "./lu.ts";
