import { defaultContentMargins, type ContentMargins, type NinePatch } from './types';

export const CONTENT_MARGIN_MIN = -1;
export const CONTENT_MARGIN_MAX = 2048;

export interface PatchQuad {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Corner-fixed, edge/middle-stretched slice of a source image into a
 * destination box. Empty quads (zero source or destination extent) are
 * dropped rather than returned degenerate.
 */
export function sliceNinePatch(
  src: { w: number; h: number },
  patch: NinePatch,
  dst: { w: number; h: number },
): PatchQuad[] {
  const p = clampPatch(patch, src.w, src.h);
  const srcColsX = [0, p.left, src.w - p.right, src.w];
  const srcRowsY = [0, p.top, src.h - p.bottom, src.h];

  // the destination middle can't go negative even when dst is smaller than
  // the fixed borders — sliceNinePatch stays correct even if the caller
  // ignored minDrawSize's warning
  const dstMidW = Math.max(0, dst.w - p.left - p.right);
  const dstMidH = Math.max(0, dst.h - p.top - p.bottom);
  const dstColsX = [0, p.left, p.left + dstMidW, p.left + dstMidW + p.right];
  const dstRowsY = [0, p.top, p.top + dstMidH, p.top + dstMidH + p.bottom];

  const quads: PatchQuad[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const sw = srcColsX[col + 1] - srcColsX[col];
      const sh = srcRowsY[row + 1] - srcRowsY[row];
      const dw = dstColsX[col + 1] - dstColsX[col];
      const dh = dstRowsY[row + 1] - dstRowsY[row];
      if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
      quads.push({
        sx: srcColsX[col],
        sy: srcRowsY[row],
        sw,
        sh,
        dx: dstColsX[col],
        dy: dstRowsY[row],
        dw,
        dh,
      });
    }
  }
  return quads;
}

/** Sanitises a patch against a source size: non-negative, integer, opposite margins never overlap. */
export function clampPatch(patch: NinePatch, w: number, h: number): NinePatch {
  const left = Math.max(0, Math.round(patch.left));
  const top = Math.max(0, Math.round(patch.top));
  let right = Math.max(0, Math.round(patch.right));
  let bottom = Math.max(0, Math.round(patch.bottom));
  const maxH = Math.max(0, w - 1);
  const maxV = Math.max(0, h - 1);
  right = Math.min(right, Math.max(0, maxH - left));
  bottom = Math.min(bottom, Math.max(0, maxV - top));
  return { left: Math.min(left, maxH), top: Math.min(top, maxV), right, bottom };
}

/**
 * Set one margin field, shrinking only the opposite margin — and only if the
 * two would otherwise overlap. Shared by the numeric inputs and the
 * draggable on-canvas guides so both editing paths clamp the same way.
 */
export function setPatchField(
  patch: NinePatch,
  field: keyof NinePatch,
  value: number,
  size: { w: number; h: number },
): NinePatch {
  const next: NinePatch = { ...patch, [field]: Math.max(0, Math.round(value)) };
  const maxH = Math.max(0, size.w - 1);
  const maxV = Math.max(0, size.h - 1);
  if (next.left + next.right > maxH) {
    if (field === 'left') next.right = Math.max(0, maxH - next.left);
    else next.left = Math.max(0, maxH - next.right);
  }
  if (next.top + next.bottom > maxV) {
    if (field === 'top') next.bottom = Math.max(0, maxV - next.top);
    else next.top = Math.max(0, maxV - next.bottom);
  }
  return next;
}

function clampContentMargin(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return CONTENT_MARGIN_MIN;
  return Math.min(CONTENT_MARGIN_MAX, Math.max(CONTENT_MARGIN_MIN, Math.round(value)));
}

/** Content margins are independent Godot layout padding, not texture slices. */
export function clampContentMargins(margins?: Partial<ContentMargins> | null): ContentMargins {
  if (!margins) return defaultContentMargins();
  return {
    left: clampContentMargin(margins.left),
    top: clampContentMargin(margins.top),
    right: clampContentMargin(margins.right),
    bottom: clampContentMargin(margins.bottom),
  };
}

export function setContentMarginField(
  margins: ContentMargins,
  field: keyof ContentMargins,
  value: number,
): ContentMargins {
  return clampContentMargins({ ...margins, [field]: value });
}

/**
 * Smallest destination size before the fixed corners would overlap — below
 * this, Godot (and sliceNinePatch above) scale the whole patch down rather
 * than draw what's configured. Callers should warn, not silently comply.
 */
export function minDrawSize(patch: NinePatch): { w: number; h: number } {
  return { w: patch.left + patch.right, h: patch.top + patch.bottom };
}
