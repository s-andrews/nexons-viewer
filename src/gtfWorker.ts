// Streams a GTF file line-by-line and builds gene/transcript/exon models without ever
// holding the raw text in memory - only the parsed result accumulates as the file is read.
//
// Mirrors build_exon_index.py's read_gtf() exactly: only "exon" feature rows are read at
// all - gene_id/gene_name/transcript_id/transcript_name/transcript_support_level all come
// from the exon row's own attributes, and gene/transcript start/end are the running min/max
// over their exons. "gene"/"transcript" feature rows are ignored entirely. This also means
// we don't assume the file is gene-sorted (some exports interleave a transcript's exons with
// other genes', or emit exons before the gene they belong to) - a gene can be built up from
// exon rows scattered anywhere in the file, not just a contiguous block.
//
// A transcript is kept if its transcript_support_level is <= maxTsl, UNLESS its attributes
// carry one of the "good" tags below, in which case it's treated as TSL 1 regardless of its
// actual (or missing) TSL - matching MANE_Select/canonical transcripts that often lack a TSL
// annotation entirely.
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
    genesById: Map<string, ExonGene>;
    transcriptsById: Map<string, ExonTranscript>;
}

function processExonLine(line: string, state: ParseState) {
    if (line.length === 0 || line.charCodeAt(0) === 35 /* '#' */) return;

    const t1 = line.indexOf("\t");
    const t2 = line.indexOf("\t", t1 + 1);
    const t3 = line.indexOf("\t", t2 + 1);
    if (line.slice(t2 + 1, t3) !== "exon") return;

    const t4 = line.indexOf("\t", t3 + 1);
    const t5 = line.indexOf("\t", t4 + 1);
    const start = parseInt(line.slice(t3 + 1, t4), 10);
    const end = parseInt(line.slice(t4 + 1, t5), 10);
    const t6 = line.indexOf("\t", t5 + 1); // score
    const t7 = line.indexOf("\t", t6 + 1);
    const strand = line.slice(t6 + 1, t7);
    const t8 = line.indexOf("\t", t7 + 1); // frame
    const attrs = line.slice(t8 + 1);

    let gid = extractAttr(attrs, "gene_id");
    let gname = extractAttr(attrs, "gene_name");
    if (!gid && !gname) return;
    if (!gid) gid = gname;
    if (!gname) gname = gid;

    let tid = extractAttr(attrs, "transcript_id");
    let tname = extractAttr(attrs, "transcript_name");
    if (!tid && !tname) return;
    if (!tid) tid = tname;
    if (!tname) tname = tid;

    if (state.maxTsl !== null && !hasGoodTag(attrs)) {
        const tsl = extractTsl(attrs);
        if (tsl === null || tsl > state.maxTsl) return;
    }

    let gene = state.genesById.get(gid!);
    if (!gene) {
        const chrom = line.slice(0, t1);
        gene = { id: gid!, name: gname!, chrom, start, end, strand, transcripts: [] };
        state.genesById.set(gid!, gene);
    } else {
        if (start < gene.start) gene.start = start;
        if (end > gene.end) gene.end = end;
    }

    let transcript = state.transcriptsById.get(tid!);
    if (!transcript) {
        transcript = { id: tid!, name: tname!, start, end, exons: [] };
        state.transcriptsById.set(tid!, transcript);
        gene.transcripts.push(transcript);
    } else {
        if (start < transcript.start) transcript.start = start;
        if (end > transcript.end) transcript.end = end;
    }

    transcript.exons.push([start, end]);
}

const PROGRESS_INTERVAL = 8 << 20; // report roughly every 8MB of decoded text

async function parseGtf(
    file: File,
    maxTsl: number | null,
    onProgress: (bytesRead: number) => void,
    onGenes: (genes: ExonGene[]) => void,
): Promise<number> {
    const state: ParseState = { maxTsl, genesById: new Map(), transcriptsById: new Map() };
    const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let bytesRead = 0;
    let lastReported = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesRead += value.length;
        buffer += value;

        let newlineIdx = buffer.indexOf("\n");
        while (newlineIdx !== -1) {
            let line = buffer.slice(0, newlineIdx);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            processExonLine(line, state);
            buffer = buffer.slice(newlineIdx + 1);
            newlineIdx = buffer.indexOf("\n");
        }

        if (bytesRead - lastReported > PROGRESS_INTERVAL) {
            onProgress(bytesRead);
            lastReported = bytesRead;
        }
    }
    if (buffer.length > 0) processExonLine(buffer, state);

    // Genes can arrive out of order across the file, so there's no "this gene is done" moment
    // to stream chunks off during the parse - only the final result is chunked, to keep any
    // single postMessage from having to structured-clone the whole thing at once.
    let totalGenes = 0;
    let chunk: ExonGene[] = [];
    for (const gene of state.genesById.values()) {
        for (const transcript of gene.transcripts) transcript.exons.sort((a, b) => a[0] - b[0]);
        chunk.push(gene);
        if (chunk.length >= CHUNK_SIZE) {
            totalGenes += chunk.length;
            onGenes(chunk);
            chunk = [];
        }
    }
    if (chunk.length > 0) {
        totalGenes += chunk.length;
        onGenes(chunk);
    }

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
