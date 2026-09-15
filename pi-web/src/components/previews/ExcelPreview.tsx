import * as XLSX from "@keep-lts/xlsx";
import { useEffect, useState } from "react";

interface SheetView {
	name: string;
	rows: string[][];
}

/** Spreadsheet preview backed by SheetJS; formulas are shown using their cached/display values. */
export function ExcelPreview({ blob }: { blob: Blob }): JSX.Element {
	const [sheets, setSheets] = useState<SheetView[]>();
	const [error, setError] = useState<string>();
	const [active, setActive] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setSheets(undefined);
		setError(undefined);
		setActive(0);
		void blob
			.arrayBuffer()
			.then((buffer) => {
				const workbook = XLSX.read(buffer, { type: "array", cellNF: false, cellStyles: false });
				const parsed = workbook.SheetNames.map((name) => {
					const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
						header: 1,
						blankrows: false,
						defval: "",
						raw: false,
					});
					return { name, rows: rows.map((row) => row.map((cell) => String(cell ?? ""))) };
				});
				if (!cancelled) setSheets(parsed);
			})
			.catch((reason: unknown) => {
				if (!cancelled) setError(reason instanceof Error ? reason.message : "无法解析表格");
			});
		return () => {
			cancelled = true;
		};
	}, [blob]);

	if (error) return <div className="p-4 text-[12px] text-[#f04438]">表格解析失败：{error}</div>;
	if (!sheets) return <div className="p-4 text-[12px] text-[#98a2b3]">解析表格...</div>;
	const sheet = sheets[active];
	return (
		<section className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
			<div className="flex flex-wrap items-center gap-2 border-b border-black/[0.06] px-4 py-2">
				<span className="text-[12px] font-medium text-[#667085]">表格预览</span>
				{sheets.map((item, index) => (
					<button
						className={`rounded-md px-2 py-1 text-[11px] ${index === active ? "bg-[#e8f0ff] text-[#2f7df6]" : "text-[#667085] hover:bg-black/[0.04]"}`}
						key={`${item.name}-${index}`}
						onClick={() => setActive(index)}
						type="button"
					>
						{item.name}
					</button>
				))}
			</div>
			<div className="max-h-[calc(100vh-170px)] overflow-auto">
				{sheet && sheet.rows.length > 0 ? (
					<table className="border-collapse text-[12px]">
						<tbody>
							{sheet.rows.slice(0, 1000).map((row, rowIndex) => (
								<tr className="even:bg-black/[0.02]" key={rowIndex}>
									<th className="sticky left-0 border border-black/[0.06] bg-[#fafafa] px-2 py-1 text-right font-normal text-[#98a2b3]">
										{rowIndex + 1}
									</th>
									{row.map((cell, cellIndex) => (
										<td className="max-w-[300px] border border-black/[0.06] px-2 py-1 align-top whitespace-nowrap" key={cellIndex} title={cell}>
											{cell}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<div className="p-4 text-[12px] text-[#98a2b3]">（空工作表）</div>
				)}
				{sheet && sheet.rows.length > 1000 ? <div className="p-3 text-[11px] text-[#98a2b3]">仅显示前 1000 行</div> : null}
			</div>
		</section>
	);
}

export default ExcelPreview;
