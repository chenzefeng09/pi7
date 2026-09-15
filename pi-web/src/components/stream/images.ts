/**
 * Display sizing for a message image, ported from the dsh web client (its
 * `MessageImage.singleFit` in `@deepseek-ai/dsh-client-ui-attachment`).
 *
 * A lone image is a 240px box, not a full-width picture: a screenshot is a
 * reference, not the message, and the transcript is a column of conversations.
 * Plain `max-width: 100%` makes every pasted screenshot as tall as the column,
 * which pushes the rest of the conversation off screen.
 */

/** Long edge of a lone message image. */
export const MESSAGE_IMAGE_LONG_EDGE = 240;

/** Square cell for one image among several: a gallery reads as thumbnails. */
export const MESSAGE_IMAGE_TILE = 64;

/**
 * Aspect ratios outside this band are cropped rather than shrunk. A 3000x400
 * long screenshot boxed at its own ratio would be 240x32 — too short to
 * recognize — so the box holds the 4:1 edge and `object-fit: cover` cuts the
 * overflow instead.
 */
const MAX_RATIO = 4;
const MIN_RATIO = 0.25;

export interface ImageSize {
	height: number;
	width: number;
}

export interface ImageFit extends ImageSize {
	/** `object-position` that keeps the informative corner of a cropped image. */
	objectPosition: string;
}

/**
 * Box a lone image renders in: long edge 240px, aspect ratio clamped to
 * [0.25, 4], and never scaled past the image's own pixel size.
 *
 * `undefined` means the browser has not reported the natural size yet (pi's
 * image blocks carry no dimensions, unlike dsh's probed attachments). The
 * caller then renders the image at its own size capped at 240px, which is the
 * same box for every ratio inside the band — only an extreme ratio moves once
 * the measurement lands.
 */
export function messageImageFit(size?: ImageSize): ImageFit | undefined {
	if (!size || size.width <= 0 || size.height <= 0) return undefined;
	const natural = size.width / size.height;
	const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, natural));
	const box =
		ratio >= 1
			? { height: MESSAGE_IMAGE_LONG_EDGE / ratio, width: MESSAGE_IMAGE_LONG_EDGE }
			: { height: MESSAGE_IMAGE_LONG_EDGE, width: MESSAGE_IMAGE_LONG_EDGE * ratio };
	const scale = Math.min(1, size.width / box.width, size.height / box.height);
	return {
		height: Math.max(1, Math.round(box.height * scale)),
		objectPosition: natural < MIN_RATIO ? "center top" : natural > MAX_RATIO ? "left center" : "center",
		width: Math.max(1, Math.round(box.width * scale)),
	};
}

/** Images of one message: a lone image renders large, several render as tiles. */
export function messageImageTiled(count: number): boolean {
	return count > 1;
}
