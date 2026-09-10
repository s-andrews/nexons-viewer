import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BamRecord, ExonGene, ExonTranscript } from "../types";
import { cigarString } from "../bamIo";

const NR_COLORS: Record<string, string> = {
    unique: "50,160,50",
    partial: "230,159,0",
    gene: "140,140,140",
    multi: "200,50,50",
};
const NO_MATCH_COLOR = "100,120,200";

const ROW_H = 12;
const ROW_GAP = 3;
const PX_GAP_MIN = 2;
const EXON_ROW_H = 10;
const GENE_ROW_H = 8;
const GENE_REGION_ROW_H = 8;
const MARGIN_L_MIN = 70;
const MARGIN_L_MAX = 220;
const MARGIN_R = 20;
const SEP_GAP = 6;
const LANE_INNER_GAP = 4;
const LANE_BOTTOM_GAP = 10;
const MIN_VIEW_BP = 30;
const CIGAR_DETAIL_MIN_PX_PER_BASE = 0.6;

type ScaleX = (g: number) => number;

interface PackedRead extends BamRecord { row: number }
interface PackedGeneItem { start: number; end: number; gene: ExonGene; row: number }

function packReads(reads: BamRecord[], scaleX: ScaleX): { reads: PackedRead[]; rowCount: number } {
    const sorted = [...reads].sort((a, b) => a.start - b.start) as PackedRead[];
    const rowEndPx: number[] = [];
    for (const r of sorted) {
        const xStart = scaleX(r.start);
        const xEnd = scaleX(r.end);
        let placedRow = -1;
        for (let i = 0; i < rowEndPx.length; i++) {
            if (rowEndPx[i] <= xStart) { placedRow = i; break; }
        }
        if (placedRow === -1) { placedRow = rowEndPx.length; rowEndPx.push(0); }
        rowEndPx[placedRow] = xEnd + PX_GAP_MIN;
        r.row = placedRow;
    }
    return { reads: sorted, rowCount: rowEndPx.length };
}

// Packs primary reads first (rows 0..N), then secondary reads below them (rows N..)
function layoutLane(reads: BamRecord[], scaleX: ScaleX) {
    const primary = reads.filter((r) => !r.isSecondary);
    const secondary = reads.filter((r) => r.isSecondary);
    const packedPrimary = packReads(primary, scaleX);
    const packedSecondary = packReads(secondary, scaleX);
    for (const r of packedSecondary.reads) r.row += packedPrimary.rowCount;
    return {
        reads: [...packedPrimary.reads, ...packedSecondary.reads],
        rowCount: packedPrimary.rowCount + packedSecondary.rowCount,
    };
}

function packGeneItems(items: { start: number; end: number; gene: ExonGene }[], scaleX: ScaleX) {
    const sorted = [...items].sort((a, b) => a.start - b.start) as PackedGeneItem[];
    const rowEndPx: number[] = [];
    for (const it of sorted) {
        const xStart = scaleX(it.start);
        const xEnd = scaleX(it.end);
        let placedRow = -1;
        for (let i = 0; i < rowEndPx.length; i++) {
            if (rowEndPx[i] <= xStart) { placedRow = i; break; }
        }
        if (placedRow === -1) { placedRow = rowEndPx.length; rowEndPx.push(0); }
        rowEndPx[placedRow] = xEnd + PX_GAP_MIN;
        it.row = placedRow;
    }
    return { items: sorted, rowCount: rowEndPx.length };
}

function readRgb(read: BamRecord): string {
    const val = read.tags.nR;
    return typeof val === "string" && NR_COLORS[val] ? NR_COLORS[val] : NO_MATCH_COLOR;
}

function drawCigarDetail(ctx: CanvasRenderingContext2D, r: BamRecord, scaleX: ScaleX, rowY: number) {
    let refPos = r.start;
    for (const [op, len] of r.cigar) {
        if (op === "M" || op === "=" || op === "X" || op === "D") {
            if (op === "D" && len > 0) {
                const x1 = scaleX(refPos);
                const x2 = scaleX(refPos + len);
                ctx.strokeStyle = "#1f2933";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x1, rowY + ROW_H / 2);
                ctx.lineTo(x2, rowY + ROW_H / 2);
                ctx.stroke();
            }
            refPos += len;
        } else if (op === "N") {
            refPos += len;
        } else if (op === "I") {
            const x = scaleX(refPos);
            ctx.fillStyle = "#7c3aed";
            ctx.fillRect(x - 1, rowY - 2, 2, ROW_H + 4);
        }
    }
}

type HitRect =
    | { x1: number; x2: number; y1: number; y2: number; kind: "read"; read: BamRecord }
    | { x1: number; x2: number; y1: number; y2: number; kind: "gene"; gene: ExonGene }
    | { x1: number; x2: number; y1: number; y2: number; kind: "generegion" };

interface AlignmentCanvasProps {
    gene: ExonGene;
    records: BamRecord[];
    exonIndexById: Map<string, ExonGene>;
}

const ZOOM_LEVELS: { label: string; bp: number | null }[] = [
    { label: "Whole region", bp: null },
    { label: "50 kb", bp: 50000 },
    { label: "10 kb", bp: 10000 },
    { label: "5 kb", bp: 5000 },
    { label: "1 kb", bp: 1000 },
    { label: "500 bp", bp: 500 },
    { label: "200 bp", bp: 200 },
    { label: "100 bp", bp: 100 },
];

export default function AlignmentCanvas({ gene, records, exonIndexById }: AlignmentCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const hitRectsRef = useRef<HitRect[]>([]);
    const draggingRef = useRef<{ startX: number; view: { start: number; end: number } } | null>(null);

    const [width, setWidth] = useState(600);
    const [tooltip, setTooltip] = useState<{ hit: HitRect; x: number; y: number } | null>(null);

    const geneStart0 = gene.start - 1;
    const transcripts = gene.transcripts || [];

    const hardStart0 = useMemo(() => {
        let s = geneStart0;
        for (const r of records) if (r.start < s) s = r.start;
        const pad = Math.max(200, Math.round(((() => {
            let e = gene.end;
            for (const r of records) if (r.end > e) e = r.end;
            return e;
        })() - s) * 0.05));
        return s - pad;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gene.id, records]);

    const hardEnd0 = useMemo(() => {
        let e = gene.end;
        for (const r of records) if (r.end > e) e = r.end;
        let s = geneStart0;
        for (const r of records) if (r.start < s) s = r.start;
        const pad = Math.max(200, Math.round((e - s) * 0.05));
        return e + pad;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gene.id, records]);

    const [view, setView] = useState({ start: hardStart0, end: hardEnd0 });

    // Reset pan/zoom whenever a different gene's alignments are opened
    useEffect(() => {
        setView({ start: hardStart0, end: hardEnd0 });
    }, [hardStart0, hardEnd0]);

    const overlappingGenes = useMemo(
        () =>
            [...exonIndexById.values()]
                .filter((g) => g.id !== gene.id && g.chrom === gene.chrom && g.start - 1 < hardEnd0 && g.end > hardStart0)
                .sort((a, b) => a.start - b.start),
        [exonIndexById, gene.id, gene.chrom, hardStart0, hardEnd0],
    );

    const marginL = useMemo(() => {
        const measureCanvas = document.createElement("canvas");
        const measureCtx = measureCanvas.getContext("2d")!;
        measureCtx.font = "11px -apple-system, sans-serif";
        let labelWidth = 0;
        for (const t of transcripts) labelWidth = Math.max(labelWidth, measureCtx.measureText(t.id).width);
        for (const g of overlappingGenes) {
            labelWidth = Math.max(labelWidth, measureCtx.measureText(g.name && g.name !== g.id ? g.name : g.id).width);
        }
        return Math.min(MARGIN_L_MAX, Math.max(MARGIN_L_MIN, labelWidth + 12));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transcripts, overlappingGenes]);

    useLayoutEffect(() => {
        if (containerRef.current) {
            setWidth(Math.max(600, containerRef.current.clientWidth - 20 || document.body.clientWidth - 60));
        }
    }, [gene.id]);

    function clampView(newStart: number, newEnd: number): [number, number] {
        const w = newEnd - newStart;
        if (newStart < hardStart0) { newStart = hardStart0; newEnd = newStart + w; }
        if (newEnd > hardEnd0) { newEnd = hardEnd0; newStart = newEnd - w; }
        return [Math.max(hardStart0, newStart), Math.min(hardEnd0, newEnd)];
    }

    function setViewWidth(bp: number) {
        const newWidth = Math.max(MIN_VIEW_BP, Math.min(bp, hardEnd0 - hardStart0));
        const center = (view.start + view.end) / 2;
        const [s, e] = clampView(center - newWidth / 2, center + newWidth / 2);
        setView({ start: s, end: e });
    }

    function panByFraction(frac: number) {
        const shift = (view.end - view.start) * frac;
        const [s, e] = clampView(view.start + shift, view.end + shift);
        setView({ start: s, end: e });
    }

    // ---- draw ----
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const scaleX: ScaleX = (g) => marginL + ((g - view.start) / (view.end - view.start)) * (width - marginL - MARGIN_R);
        const pxPerBase = scaleX(1) - scaleX(0);
        const showCigarDetail = pxPerBase >= CIGAR_DETAIL_MIN_PX_PER_BASE;

        const visible = records.filter((r) => r.start < view.end && r.end > view.start);
        const assignedTranscriptIds = new Set(transcripts.map((t) => t.id));

        type Lane =
            | { kind: "transcript"; t: ExonTranscript; layout: ReturnType<typeof layoutLane> }
            | { kind: "gene_level" | "no_match"; layout: ReturnType<typeof layoutLane> };

        const lanes: Lane[] = transcripts.map((t) => ({
            kind: "transcript",
            t,
            layout: layoutLane(visible.filter((r) => r.tags.nT === t.id), scaleX),
        }));

        const unassigned = visible.filter((r) => !r.tags.nT || !assignedTranscriptIds.has(r.tags.nT as string));
        const geneLevelReads = unassigned.filter((r) => r.tags.nR === "gene");
        const noMatchReads = unassigned.filter((r) => r.tags.nR !== "gene");
        lanes.push({ kind: "gene_level", layout: layoutLane(geneLevelReads, scaleX) });
        lanes.push({ kind: "no_match", layout: layoutLane(noMatchReads, scaleX) });

        const geneItems = overlappingGenes
            .filter((g) => g.start - 1 < view.end && g.end > view.start)
            .map((g) => ({ start: g.start - 1, end: g.end, gene: g }));
        const geneLayout = packGeneItems(geneItems, scaleX);
        const contextHeight = geneLayout.rowCount > 0
            ? SEP_GAP + 1 + SEP_GAP + 14 + LANE_INNER_GAP + geneLayout.rowCount * (GENE_ROW_H + ROW_GAP) + LANE_BOTTOM_GAP
            : 0;

        let height = 30 + GENE_REGION_ROW_H + SEP_GAP + 1 + SEP_GAP + contextHeight;
        for (const lane of lanes) {
            height += SEP_GAP + 1 + SEP_GAP;
            height += lane.kind === "transcript" ? EXON_ROW_H : 14;
            height += LANE_INNER_GAP;
            height += lane.layout.rowCount * (ROW_H + ROW_GAP);
            height += LANE_BOTTOM_GAP;
        }

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        // Ruler
        ctx.strokeStyle = "#d7dbe0";
        ctx.fillStyle = "#6b7280";
        ctx.font = "11px -apple-system, sans-serif";
        ctx.beginPath();
        ctx.moveTo(marginL, 20.5);
        ctx.lineTo(width - MARGIN_R, 20.5);
        ctx.stroke();
        ctx.fillText(`${Math.round(view.start + 1).toLocaleString()}`, marginL, 14);
        const endLabel = `${Math.round(view.end).toLocaleString()}`;
        ctx.fillText(endLabel, width - MARGIN_R - ctx.measureText(endLabel).width, 14);

        const hitRects: HitRect[] = [];
        let y = 30;

        // Gene region indicator
        {
            const gx1 = scaleX(geneStart0);
            const gx2 = scaleX(gene.end);
            ctx.fillStyle = "#0e7490";
            ctx.fillRect(gx1, y, Math.max(1, gx2 - gx1), GENE_REGION_ROW_H);

            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, y - 1, marginL - 2, GENE_REGION_ROW_H + 2);
            ctx.fillStyle = "#0e7490";
            ctx.font = "600 11px -apple-system, sans-serif";
            ctx.fillText("Gene region", 4, y + GENE_REGION_ROW_H - 1);

            hitRects.push({ x1: gx1, x2: gx2, y1: y, y2: y + GENE_REGION_ROW_H, kind: "generegion" });

            y += GENE_REGION_ROW_H + SEP_GAP;
            ctx.strokeStyle = "#b6bcc4";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(marginL, Math.round(y) + 0.5);
            ctx.lineTo(width - MARGIN_R, Math.round(y) + 0.5);
            ctx.stroke();
            y += SEP_GAP;
        }

        for (const lane of lanes) {
            y += SEP_GAP;
            ctx.strokeStyle = "#b6bcc4";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(marginL, Math.round(y) + 0.5);
            ctx.lineTo(width - MARGIN_R, Math.round(y) + 0.5);
            ctx.stroke();
            y += SEP_GAP;

            if (lane.kind === "transcript") {
                const t = lane.t;
                const midY = y + EXON_ROW_H / 2;
                ctx.strokeStyle = "#9aa5b1";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(scaleX(t.start - 1), midY);
                ctx.lineTo(scaleX(t.end), midY);
                ctx.stroke();

                ctx.fillStyle = "#3b4754";
                for (const [exStart, exEnd] of t.exons) {
                    const x1 = scaleX(exStart - 1);
                    const x2 = scaleX(exEnd);
                    ctx.fillRect(x1, y, Math.max(1, x2 - x1), EXON_ROW_H);
                }

                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, y - 1, marginL - 2, EXON_ROW_H + 2);

                ctx.fillStyle = "#6b7280";
                ctx.font = "11px -apple-system, sans-serif";
                ctx.fillText(t.id, 4, y + EXON_ROW_H - 1);
                if (t.name && t.name !== t.id) {
                    ctx.fillText(t.name, scaleX(t.end) + 6, y + EXON_ROW_H - 1);
                }

                y += EXON_ROW_H;
            } else {
                ctx.fillStyle = "#4b5563";
                ctx.font = "600 11px -apple-system, sans-serif";
                const label = lane.kind === "gene_level"
                    ? "Gene-level match, no specific transcript (nR: gene)"
                    : "No match to this gene (nR: blank/multi) — may align to an overlapping gene";
                ctx.fillText(label, 4, y + 11);
                y += 14;
            }

            y += LANE_INNER_GAP;

            for (const r of lane.layout.reads) {
                const rowY = y + r.row * (ROW_H + ROW_GAP);
                const midY = rowY + ROW_H / 2;
                const rgb = readRgb(r);

                ctx.strokeStyle = `rgba(${rgb},${r.isSecondary ? 0.5 : 0.9})`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(scaleX(r.start), midY);
                ctx.lineTo(scaleX(r.end), midY);
                ctx.stroke();

                for (const [bStart, bEnd] of r.blocks) {
                    const x1 = scaleX(bStart);
                    const x2 = scaleX(bEnd);
                    const w = Math.max(1, x2 - x1);

                    if (r.isSecondary) {
                        ctx.fillStyle = `rgba(${rgb},0.35)`;
                        ctx.fillRect(x1, rowY, w, ROW_H);
                        ctx.strokeStyle = `rgb(${rgb})`;
                        ctx.setLineDash([2, 2]);
                        ctx.lineWidth = 1;
                        ctx.strokeRect(x1 + 0.5, rowY + 0.5, Math.max(0, w - 1), ROW_H - 1);
                        ctx.setLineDash([]);
                    } else {
                        ctx.fillStyle = `rgb(${rgb})`;
                        ctx.fillRect(x1, rowY, w, ROW_H);
                    }
                }

                if (showCigarDetail) drawCigarDetail(ctx, r, scaleX, rowY);

                ctx.fillStyle = "#ffffff";
                ctx.font = "9px monospace";
                const arrow = r.isReverse ? "‹" : "›";
                const cx = (scaleX(r.start) + scaleX(r.end)) / 2;
                if (scaleX(r.end) - scaleX(r.start) > 8) {
                    ctx.fillText(arrow, cx - 2, midY + 3);
                }

                hitRects.push({ x1: scaleX(r.start), x2: scaleX(r.end), y1: rowY, y2: rowY + ROW_H, kind: "read", read: r });
            }

            y += lane.layout.rowCount * (ROW_H + ROW_GAP) + LANE_BOTTOM_GAP;
        }

        if (geneLayout.rowCount > 0) {
            y += SEP_GAP;
            ctx.strokeStyle = "#b6bcc4";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(marginL, Math.round(y) + 0.5);
            ctx.lineTo(width - MARGIN_R, Math.round(y) + 0.5);
            ctx.stroke();
            y += SEP_GAP;

            ctx.fillStyle = "#4b5563";
            ctx.font = "600 11px -apple-system, sans-serif";
            ctx.fillText("Overlapping genes (context only, no transcript detail)", 4, y + 11);
            y += 14 + LANE_INNER_GAP;

            for (const item of geneLayout.items) {
                const g = item.gene;
                const rowY = y + item.row * (GENE_ROW_H + ROW_GAP);
                const x1 = scaleX(item.start);
                const x2 = scaleX(item.end);

                ctx.fillStyle = "#a3b8d8";
                ctx.fillRect(x1, rowY, Math.max(1, x2 - x1), GENE_ROW_H);

                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, rowY - 1, marginL - 2, GENE_ROW_H + 2);
                ctx.fillStyle = "#5b6b85";
                ctx.font = "11px -apple-system, sans-serif";
                ctx.fillText(g.name && g.name !== g.id ? g.name : g.id, 4, rowY + GENE_ROW_H - 1);

                hitRects.push({ x1, x2, y1: rowY, y2: rowY + GENE_ROW_H, kind: "gene", gene: g });
            }
        }

        hitRectsRef.current = hitRects;
    }, [view, records, gene, transcripts, overlappingGenes, marginL, width, geneStart0]);

    // ---- tooltip positioning: flip to stay inside the viewport ----
    useLayoutEffect(() => {
        if (!tooltip || !tooltipRef.current) return;
        const pad = 14;
        const rect = tooltipRef.current.getBoundingClientRect();
        let left = tooltip.x + pad;
        let top = tooltip.y + pad;
        if (left + rect.width > window.innerWidth) left = tooltip.x - pad - rect.width;
        if (top + rect.height > window.innerHeight) top = tooltip.y - pad - rect.height;
        tooltipRef.current.style.left = Math.max(4, left) + "px";
        tooltipRef.current.style.top = Math.max(4, top) + "px";
    }, [tooltip]);

    function handleWheel(evt: React.WheelEvent<HTMLCanvasElement>) {
        evt.preventDefault();
        const rect = evt.currentTarget.getBoundingClientRect();
        const mx = evt.clientX - rect.left;
        const curWidth = view.end - view.start;
        const cursorGenomic = view.start + ((mx - marginL) / (width - marginL - MARGIN_R)) * curWidth;
        const factor = evt.deltaY > 0 ? 1.25 : 0.8;
        const newWidth = Math.max(MIN_VIEW_BP, Math.min(curWidth * factor, hardEnd0 - hardStart0));
        const ratio = (cursorGenomic - view.start) / curWidth;
        const newStart = cursorGenomic - ratio * newWidth;
        const [s, e] = clampView(newStart, newStart + newWidth);
        setView({ start: s, end: e });
    }

    function handleMouseDown(evt: React.MouseEvent<HTMLCanvasElement>) {
        draggingRef.current = { startX: evt.clientX, view: { ...view } };
        setTooltip(null);
    }

    useEffect(() => {
        function onMove(evt: MouseEvent) {
            const dragging = draggingRef.current;
            if (!dragging) return;
            const dx = evt.clientX - dragging.startX;
            const curWidth = dragging.view.end - dragging.view.start;
            const bpPerPx = curWidth / (width - marginL - MARGIN_R);
            const shift = -dx * bpPerPx;
            const [s, e] = clampView(dragging.view.start + shift, dragging.view.end + shift);
            setView({ start: s, end: e });
        }
        function onUp() {
            draggingRef.current = null;
        }
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [width, marginL, hardStart0, hardEnd0]);

    function handleDoubleClick() {
        setView({ start: hardStart0, end: hardEnd0 });
    }

    function handleMouseMove(evt: React.MouseEvent<HTMLCanvasElement>) {
        if (draggingRef.current) return;
        const rect = evt.currentTarget.getBoundingClientRect();
        const mx = evt.clientX - rect.left;
        const my = evt.clientY - rect.top;
        const hit = hitRectsRef.current.find((h) => mx >= h.x1 && mx <= h.x2 && my >= h.y1 && my <= h.y2);
        if (hit) {
            setTooltip({ hit, x: evt.clientX, y: evt.clientY });
        } else {
            setTooltip(null);
        }
    }

    return (
        <div id="plot-container" ref={containerRef}>
            <div className="plot-toolbar">
                <select className="zoom-select" onChange={(e) => setViewWidth(e.target.value === "" ? hardEnd0 - hardStart0 : Number(e.target.value))}>
                    {ZOOM_LEVELS.map((lvl) => (
                        <option key={lvl.label} value={lvl.bp ?? ""}>{lvl.label}</option>
                    ))}
                </select>
                <button type="button" className="pan-btn" title="Pan left by 75% of the visible range" onClick={() => panByFraction(-0.75)}>◀ 75%</button>
                <button type="button" className="pan-btn" title="Pan right by 75% of the visible range" onClick={() => panByFraction(0.75)}>75% ▶</button>
                <span className="plot-hint">scroll to zoom · drag to pan · double-click to reset</span>
            </div>

            <canvas
                ref={canvasRef}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setTooltip(null)}
                onDoubleClick={handleDoubleClick}
                style={{ cursor: draggingRef.current ? "grabbing" : "default" }}
            />

            <div className="plot-footer-spacer" />

            {tooltip && (
                <div id="tooltip" ref={tooltipRef} style={{ display: "block" }}>
                    {tooltip.hit.kind === "generegion" && (
                        <>
                            <div><b>{gene.name && gene.name !== gene.id ? gene.name : gene.id}</b> - gene region</div>
                            <div>{gene.chrom}:{gene.start.toLocaleString()}-{gene.end.toLocaleString()}</div>
                            <div className="stats-loading">The display window below extends further to also fit overlapping-gene transcripts and out-of-bounds reads</div>
                        </>
                    )}
                    {tooltip.hit.kind === "gene" && (() => {
                        const g = tooltip.hit.gene;
                        return (
                            <>
                                <div><b>{g.name && g.name !== g.id ? g.name : g.id}</b></div>
                                <div>{g.chrom}:{g.start.toLocaleString()}-{g.end.toLocaleString()} ({g.strand} strand)</div>
                                <div>{g.id}</div>
                                <div className="stats-loading">Overlapping gene shown for context only</div>
                            </>
                        );
                    })()}
                    {tooltip.hit.kind === "read" && (() => {
                        const r = tooltip.hit.read;
                        return (
                            <>
                                <div><b>{r.readName}</b></div>
                                <div>{r.chrom}:{(r.start + 1).toLocaleString()}-{r.end.toLocaleString()} ({r.isReverse ? "-" : "+"} strand)</div>
                                <div>mapq {r.mapq} — {r.isSecondary ? "secondary" : "primary"} alignment</div>
                                <div>nR: {r.tags.nR ?? "—"} &nbsp; nT: {r.tags.nT ?? "—"}</div>
                                <div>CIGAR: {cigarString(r.cigar)}</div>
                            </>
                        );
                    })()}
                </div>
            )}
        </div>
    );
}
