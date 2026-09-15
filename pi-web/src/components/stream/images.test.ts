import { describe, expect, it } from "vitest";
import { MESSAGE_IMAGE_LONG_EDGE, MESSAGE_IMAGE_TILE, messageImageFit, messageImageTiled } from "./images";

describe("message image box", () => {
	it("holds the 240px long edge for a landscape screenshot", () => {
		expect(messageImageFit({ height: 406, width: 1440 })).toEqual({
			height: Math.round(MESSAGE_IMAGE_LONG_EDGE / (1440 / 406)),
			objectPosition: "center",
			width: 240,
		});
	});

	it("holds the 240px long edge for a portrait image", () => {
		expect(messageImageFit({ height: 2400, width: 1080 })).toEqual({
			height: 240,
			objectPosition: "center",
			width: 108,
		});
	});

	it("never upscales an image smaller than the box", () => {
		expect(messageImageFit({ height: 32, width: 48 })).toEqual({
			height: 32,
			objectPosition: "center",
			width: 48,
		});
	});

	it("crops a long screenshot to the 4:1 edge and keeps its left side", () => {
		expect(messageImageFit({ height: 400, width: 3000 })).toEqual({
			height: 60,
			objectPosition: "left center",
			width: 240,
		});
	});

	it("crops a very tall image to the 1:4 edge and keeps its top", () => {
		expect(messageImageFit({ height: 4000, width: 400 })).toEqual({
			height: 240,
			objectPosition: "center top",
			width: 60,
		});
	});

	it("reports no box until the browser measured the image", () => {
		expect(messageImageFit(undefined)).toBeUndefined();
		expect(messageImageFit({ height: 0, width: 0 })).toBeUndefined();
	});
});

describe("message image layout", () => {
	it("tiles a message that carries more than one image", () => {
		expect(messageImageTiled(1)).toBe(false);
		expect(messageImageTiled(2)).toBe(true);
		expect(MESSAGE_IMAGE_TILE).toBe(64);
	});
});
