import { useState } from "react";
import type { ImageBlock } from "../../state/types";
import { ImageLightbox } from "../ImageLightbox";
import { useImageMenu } from "../ImageMenu";
import {
	MESSAGE_IMAGE_LONG_EDGE,
	MESSAGE_IMAGE_TILE,
	type ImageSize,
	messageImageFit,
	messageImageTiled,
} from "./images";
import { t } from "../../i18n";

/**
 * One message image: a bounded frame that opens the original on click.
 *
 * The frame carries the size, not the `<img>`: a data URL whose aspect ratio
 * sits outside the dsh band is cropped by `object-fit: cover` inside a box the
 * fit rule computed, so the transcript keeps its rhythm whatever was pasted.
 * Until the browser reports the natural size the image sizes itself under a
 * 240px cap — the same box for every ratio the rule does not clamp.
 */
function MessageImage({ block, tile }: { block: ImageBlock; tile: boolean }) {
	const [open, setOpen] = useState(false);
	const [size, setSize] = useState<ImageSize | undefined>(undefined);
	const source = `data:${block.mimeType};base64,${block.data}`;
	const imageMenu = useImageMenu(source);
	const fit = tile ? undefined : messageImageFit(size);
	return (
		<>
			<button
				className="grid min-h-11 min-w-11 shrink-0 cursor-zoom-in place-items-center overflow-hidden rounded-2xl border-[0.5px] border-line bg-black/[0.03] transition-opacity hover:opacity-90"
				onClick={() => setOpen(true)}
				style={
					tile
						? { height: MESSAGE_IMAGE_TILE, width: MESSAGE_IMAGE_TILE }
						: fit
							? { height: fit.height, width: fit.width }
							: { maxHeight: MESSAGE_IMAGE_LONG_EDGE, maxWidth: MESSAGE_IMAGE_LONG_EDGE }
				}
				title={t("查看原图（右键可复制）")}
				type="button"
			>
				<img
					alt={t("附件")}
					className={tile || fit ? "h-full w-full object-cover" : "object-contain"}
					onContextMenu={imageMenu.onContextMenu}
					onLoad={(event) =>
						setSize({ height: event.currentTarget.naturalHeight, width: event.currentTarget.naturalWidth })
					}
					style={fit ? { objectPosition: fit.objectPosition } : undefined}
					src={source}
				/>
			</button>
			{open ? <ImageLightbox alt={t("附件")} onClose={() => setOpen(false)} src={source} /> : null}
			{imageMenu.menu}
		</>
	);
}

/**
 * A message's images as one wrapping group, right-aligned under a user prompt
 * and left-aligned in an answer, the alignment dsh's `ImageGallery` uses.
 *
 * One image renders large (240px long edge); two or more shrink to 64px tiles
 * so a multi-image paste stays a row of thumbnails instead of a wall.
 */
export function MessageImages({ align, blocks }: { align: "start" | "end"; blocks: ImageBlock[] }) {
	if (blocks.length === 0) return null;
	const tile = messageImageTiled(blocks.length);
	return (
		<div
			className={`flex max-w-full flex-wrap gap-2.5 ${align === "end" ? "justify-end" : "justify-start"}`}
			data-align={align}
		>
			{blocks.map((block, index) => (
				<MessageImage block={block} key={index} tile={tile} />
			))}
		</div>
	);
}
