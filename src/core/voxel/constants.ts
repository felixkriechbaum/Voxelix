/** Edge length of a cubic chunk. Objects are meshed one chunk at a time. */
export const CHUNK = 16;

/** Hard cap on an object's grid dimension on any axis. */
export const MAX_SIZE = 64;

/** Number of palette slots shared by every object in a project. */
export const PALETTE_SIZE = 256;

/**
 * Sentinel cell value used only in an extend object's overlay grid: it means
 * "this voxel is explicitly removed from the resolved base", as opposed to 0
 * which means "inherit whatever the base has here".
 */
export const REMOVED = 0xffff;
