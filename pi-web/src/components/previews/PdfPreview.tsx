import { useEffect, useState } from "react";
import { t } from "../../i18n";

/** Uses Electron/Chromium's built-in PDF viewer, which works on the app's Node 18/Electron 22 base. */
export function PdfPreview({ blob }: { blob: Blob }): JSX.Element {
	const [url, setUrl] = useState<string>();
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		const nextUrl = URL.createObjectURL(blob);
		setUrl(nextUrl);
		setLoaded(false);
		return () => URL.revokeObjectURL(nextUrl);
	}, [blob]);

	return (
		<section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-black/[0.06] bg-[#f7f7f8]">
			<div className="border-b border-black/[0.06] px-4 py-2 text-[12px] font-medium text-[#667085]">{t("PDF 预览")}</div>
			{!loaded ? <div className="p-3 text-[12px] text-[#98a2b3]">{t("加载 PDF...")}</div> : null}
			{url ? (
				<iframe
					className="min-h-[520px] flex-1 border-0"
					onLoad={() => setLoaded(true)}
					src={url}
					title={t("PDF 预览")}
				/>
			) : null}
		</section>
	);
}

export default PdfPreview;
