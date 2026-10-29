/**
 * Junction-voltage limiting (SPEC §5.5 "Newton with limiting"). Faithful
 * ports of SPICE3/ngspice `src/spicelib/devices/devsup.c` (DEVpnjlim,
 * DEVfetlim, DEVlimvds; the Alan Gillespie fixes included) — the same
 * algorithms ngspice runs between Newton iterations:
 *
 *  - pnjlim: PN junctions (diode, BJT vbe/vbc, MOS bulk diodes, JFET gates).
 *    Forward steps that would overshoot `vcrit` are damped along the
 *    exponential (2·vt scale); reverse steps are forced to cross zero
 *    gradually instead of jumping to large negative values.
 *  - fetlim: FET drive voltages (MOS vgs/vgd, JFET after pnjlim). Relies on
 *    the device threshold (not the thermal voltage); lets the device move
 *    freely in the subthreshold→on transition band and damps large steps
 *    when strongly on/off.
 *  - limvds: keeps the drain-source voltage change bounded so vgs/vgd stay
 *    consistent after fetlim.
 *
 * Ported exactly (including constants) so convergence behavior matches the
 * reference engine; deviations would make the reference suite incomparable.
 * Device code must import these through this module, never reimplement.
 */

import { ln } from "../../math/index.ts";

/**
 * Limit a PN junction voltage between Newton iterations.
 * Returns the (possibly clamped) voltage; `limited` is set when the value
 * was changed, which forces the analysis to run at least one more Newton
 * iteration (convergence on a limited iterate is not trusted).
 */
export function pnjlim(
  vNew: number,
  vOld: number,
  vt: number,
  vcrit: number,
): { v: number; limited: boolean } {
  let v = vNew;
  let limited = false;
  if (vNew > vcrit && Math.abs(vNew - vOld) > vt + vt) {
    if (vOld > 0) {
      const arg = (vNew - vOld) / vt;
      if (arg > 0) {
        v = vOld + vt * (2 + ln(arg - 2));
      } else {
        v = vOld - vt * (2 + ln(2 - arg));
      }
    } else {
      v = vt * ln(vNew / vt);
    }
    limited = true;
  } else if (vNew < 0) {
    // Gillespie fix: large negative steps across a zero-biased junction are
    // walked through zero (-(vOld+1) when the old iterate was forward).
    const arg = vOld > 0 ? -vOld - 1 : 2 * vOld - 1;
    if (vNew < arg) {
      v = arg;
      limited = true;
    }
  }
  return { v, limited };
}

/** FET drive-voltage limiting (threshold-relative, see module header). */
export function fetlim(vNew: number, vOld: number, vto: number): number {
  const vtsthi = Math.abs(2 * (vOld - vto)) + 2;
  const vtstlo = Math.abs(vOld - vto) + 1;
  const vtox = vto + 3.5;
  const delv = vNew - vOld;
  if (vOld >= vto) {
    if (vOld >= vtox) {
      if (delv <= 0) {
        // going off
        if (vNew >= vtox) {
          if (-delv > vtstlo) {
            return vOld - vtstlo;
          }
        } else {
          return Math.max(vNew, vto + 2);
        }
      } else if (delv >= vtsthi) {
        // staying on
        return vOld + vtsthi;
      }
    } else if (delv <= 0) {
      // middle region, decreasing
      return Math.max(vNew, vto - 0.5);
    } else {
      // middle region, increasing
      return Math.min(vNew, vto + 4);
    }
  } else if (delv <= 0) {
    // off, turning further off
    if (-delv > vtsthi) {
      return vOld - vtsthi;
    }
  } else {
    // off, turning on
    const vtemp = vto + 0.5;
    if (vNew <= vtemp) {
      if (delv > vtstlo) {
        return vOld + vtstlo;
      }
    } else {
      return vtemp;
    }
  }
  return vNew;
}

/** Bound a drain-source step so the fetlim'ed gate voltages stay consistent. */
export function limvds(vNew: number, vOld: number): number {
  if (vOld >= 3.5) {
    if (vNew > vOld) {
      return Math.min(vNew, 3 * vOld + 2);
    }
    if (vNew < 3.5) {
      return Math.max(vNew, 2);
    }
  } else if (vNew > vOld) {
    return Math.min(vNew, 4);
  } else {
    return Math.max(vNew, -0.5);
  }
  return vNew;
}

/**
 * Critical voltage (ngspice `tVcrit`): beyond this the Shockley exponential
 * grows so fast that Newton overshoot dominates — pnjlim engages above it.
 * vcrit = vt·ln(vt/(√2·Is)).
 */
export function junctionVcrit(vt: number, satCurrent: number): number {
  return vt * ln(vt / (Math.SQRT2 * satCurrent));
}
