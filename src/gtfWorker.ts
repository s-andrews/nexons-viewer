// Streams a GTF file line-by-line and builds gene/transcript/exon models without ever
// holding the raw text, or the whole result, in memory at once.
//
// Mirrors build_exon_index.py's read_gtf(): a transcript is kept if its
// transcript_support_level is <= maxTsl, UNLESS its attributes carry one of the
// "good" tags below, in which case it's treated as TSL 1 regardless of its actual
// (or missing) TSL - matching MANE_Select/canonical transcripts that often lack a
// TSL annotation entirely.
//
// GTFs are gene-sorted (every transcript/exon row for a gene is contiguous, right
// after that gene's own row), so we only ever need to hold one gene's transcripts
// at a time: a finished gene is pushed into a small chunk buffer as soon as the
// next "gene" line starts, and chunks are streamed back to the main thread as they
// fill rather than accumulated into one giant final array.
import type { ExonGene, ExonTranscript } from "./types";
import type { GtfWorkerRequest, GtfWorkerResponse } from "./gtfTypes";

const GOOD_TAGS = ["MANE_Select", "Ensembl_Canonical", "gencode_primary", "gencode_basic"];

// Matches "key "value"" exactly as GTF/GFF2 attribute columns format them.
function extractAttr(attrs: string, key: string): string | null {
    const marker = key + ' "';
    const idx = attrs.indexOf(marker);
    if (idx === -1) return null;
    const valueStart = idx + marker.length;
    const valueEnd = attrs.indexOf('"', valueStart);
    if (valueEnd === -1) return null;
    return attrs.slice(valueStart, valueEnd);
}

// transcript_support_level is e.g. "1", "2 (assigned to previous version 3)", or "NA".
function extractTsl(attrs: string): number | null {
    const raw = extractAttr(attrs, "transcript_support_level");
    if (!raw) return null;
    const m = /^(\d+)/.exec(raw);
    return m ? parseInt(m[1], 10) : null;
}

function hasGoodTag(attrs: string): boolean {
    for (const tag of GOOD_TAGS) if (attrs.includes(tag)) return true;
    return false;
}

const CHUNK_SIZE = 2000;

interface ParseState {
    maxTsl: number | null;
    currentGene: ExonGene | null;
    currentTranscripts: Map<string, ExonTranscript>;
    chunk: ExonGene[];
}

function finalizeCurrentGene(state: ParseState) {
    if (!state.currentGene) return;
    for (const transcript of state.currentTranscripts.values()) {
        if (transcript.exons.length === 0) continue; // never got an exon (e.g. its only exon rows were malformed) - nothing to draw
        transcript.exons.sort((a, b) => a[0] - b[0]);
        state.currentGene.transcripts.push(transcript);
    }
    // Only emit genes that ended up with at least one transcript, matching build_exon_index.py -
    // which only ever sees a gene through its exon rows, so a gene with none simply never appears.
    if (state.currentGene.transcripts.length > 0) state.chunk.push(state.currentGene);
    state.currentGene = null;
    state.currentTranscripts = new Map();
}

function processLine(line: string, state: ParseState) {
    if (line.length === 0 || line.charCodeAt(0) === 35 /* '#' */) return;

    const t1 = line.indexOf("\t");
    const t2 = line.indexOf("\t", t1 + 1);
    const t3 = line.indexOf("\t", t2 + 1);
    const feature = line.slice(t2 + 1, t3);
    if (feature !== "gene" && feature !== "transcript" && feature !== "exon") return;

    const t4 = line.indexOf("\t", t3 + 1);
    const t5 = line.indexOf("\t", t4 + 1);
    const start = parseInt(line.slice(t3 + 1, t4), 10);
    const end = parseInt(line.slice(t4 + 1, t5), 10);

    if (feature === "exon") {
        const t6 = line.indexOf("\t", t5 + 1); // score
        const t7 = line.indexOf("\t", t6 + 1); // strand
        const t8 = line.indexOf("\t", t7 + 1); // frame
        const attrs = line.slice(t8 + 1);
        const tid = extractAttr(attrs, "transcript_id");
        if (!tid) return;
        // Absent when the transcript's own line was filtered out by the TSL threshold.
        const transcript = state.currentTranscripts.get(tid);
        if (!transcript) return;
        transcript.exons.push([start, end]);
        // Transcript/gene span is the union of their exons, not whatever the dedicated
        // "transcript"/"gene" GTF rows happened to declare - some GTFs declare a wider span
        // (e.g. covering a first/last intron) than the exons actually reach, which left a gap
        // between the drawn baseline's end and the first/last exon rectangle.
        if (start < transcript.start) transcript.start = start;
        if (end > transcript.end) transcript.end = end;
        if (state.currentGene) {
            if (start < state.currentGene.start) state.currentGene.start = start;
            if (end > state.currentGene.end) state.currentGene.end = end;
        }
        return;
    }

    const t6 = line.indexOf("\t", t5 + 1); // score
    const t7 = line.indexOf("\t", t6 + 1);
    const strand = line.slice(t6 + 1, t7);
    const t8 = line.indexOf("\t", t7 + 1); // frame
    const attrs = line.slice(t8 + 1);

    if (feature === "gene") {
        finalizeCurrentGene(state); // previous gene's block is complete
        let gid = extractAttr(attrs, "gene_id");
        let gname = extractAttr(attrs, "gene_name");
        if (!gid && !gname) return;
        if (!gid) gid = gname;
        if (!gname) gname = gid;
        const chrom = line.slice(0, t1);
        // start/end are placeholders, widened to the union of this gene's exons as they arrive.
        state.currentGene = { id: gid!, name: gname!, chrom, start: Infinity, end: -Infinity, strand, transcripts: [] };
        return;
    }

    // transcript
    if (!state.currentGene) return; // transcript row before any gene row - not a sorted GTF
    let tid = extractAttr(attrs, "transcript_id");
    let tname = extractAttr(attrs, "transcript_name");
    if (!tid && !tname) return;
    if (!tid) tid = tname;
    if (!tname) tname = tid;

    if (state.maxTsl !== null && !hasGoodTag(attrs)) {
        const tsl = extractTsl(attrs);
        if (tsl === null || tsl > state.maxTsl) return;
    }

    // start/end are placeholders too, widened to the union of this transcript's own exons.
    state.currentTranscripts.set(tid!, { id: tid!, name: tname!, start: Infinity, end: -Infinity, exons: [] });
}

const PROGRESS_INTERVAL = 8 << 20; // report roughly every 8MB of decoded text

async function parseGtf(
    file: File,
    maxTsl: number | null,
    onProgress: (bytesRead: number) => void,
    onGenes: (genes: ExonGene[]) => void,
): Promise<number> {
    const state: ParseState = { maxTsl, currentGene: null, currentTranscripts: new Map(), chunk: [] };
    const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let bytesRead = 0;
    let lastReported = 0;
    let totalGenes = 0;

    function flushChunk() {
        if (state.chunk.length === 0) return;
        totalGenes += state.chunk.length;
        onGenes(state.chunk);
        state.chunk = [];
    }

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesRead += value.length;
        buffer += value;

        let newlineIdx = buffer.indexOf("\n");
        while (newlineIdx !== -1) {
            let line = buffer.slice(0, newlineIdx);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            processLine(line, state);
            buffer = buffer.slice(newlineIdx + 1);
            newlineIdx = buffer.indexOf("\n");
        }

        if (state.chunk.length >= CHUNK_SIZE) flushChunk();
        if (bytesRead - lastReported > PROGRESS_INTERVAL) {
            onProgress(bytesRead);
            lastReported = bytesRead;
        }
    }
    if (buffer.length > 0) processLine(buffer, state);
    finalizeCurrentGene(state);
    flushChunk();

    return totalGenes;
}

self.onmessage = async (e: MessageEvent<GtfWorkerRequest>) => {
    const { file, maxTsl } = e.data;
    try {
        const totalGenes = await parseGtf(
            file,
            maxTsl,
            (bytesRead) => {
                const progress: GtfWorkerResponse = { type: "progress", bytesRead, totalBytes: file.size };
                self.postMessage(progress);
            },
            (genes) => {
                const chunk: GtfWorkerResponse = { type: "genes", genes };
                self.postMessage(chunk);
            },
        );
        const done: GtfWorkerResponse = { type: "done", totalGenes };
        self.postMessage(done);
    } catch (err) {
        const error: GtfWorkerResponse = { type: "error", message: (err as Error).message };
        self.postMessage(error);
    }
};
