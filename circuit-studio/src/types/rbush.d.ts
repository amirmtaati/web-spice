/** Minimal ambient declaration for rbush v4 (see docs/decisions/009-*.md). */
declare module "rbush" {
  export interface BBox {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  }

  export default class RBush<T extends BBox> {
    constructor(maxEntries?: number);
    insert(item: T): this;
    load(items: readonly T[]): this;
    remove(item: T, equalsFn?: (a: T, b: T) => boolean): this;
    clear(): this;
    search(bbox: BBox): T[];
    collides(bbox: BBox): boolean;
    all(): T[];
    toJSON(): unknown;
    fromJSON(data: unknown): this;
  }
}
