/**
 * Protocol version (semver). Handshake refuses incompatible majors (SPEC §2.1).
 *
 * Rules (SPEC §6): minors add; majors may break with a migration guide;
 * deprecations last at least two minors with runtime warnings.
 */
export const PROTOCOL_VERSION = "0.1.0" as const;

/** Returns true when a peer announcing `peerVersion` can talk to us. */
export function isCompatibleProtocol(peerVersion: string): boolean {
  const [major] = peerVersion.split(".");
  const [ourMajor] = PROTOCOL_VERSION.split(".");
  if (major === undefined || ourMajor === undefined) {
    return false;
  }
  return major === ourMajor;
}
