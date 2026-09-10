import { useCallback, useEffect, useRef, useState } from "react";
import type { BaiRefIndex, BamRecord, ExonGene } from "./types";
import { parseBAMHeader, readBAI, fetchRegionRecords } from "./bamIo";
import Header from "./components/Header";
import Legend from "./components/Legend";
import StatsRow from "./components/StatsRow";
import AlignmentCanvas from "./components/AlignmentCanvas";
import "./App.css";

interface BamState {
    file: File | null;
    refNames: string[];
    chromToRefID: Map<string, number>;
    refIndex: BaiRefIndex[];
    ready: boolean;
}

const EMPTY_BAM: BamState = { file: null, refNames: [], chromToRefID: new Map(), refIndex: [], ready: false };

export default function App() {
    const [exonIndexById, setExonIndexById] = useState<Map<string, ExonGene>>(new Map());
    const [exonFileName, setExonFileName] = useState("choose file…");
    const [bamFileLabel, setBamFileLabel] = useState("choose both files…");
    const [bam, setBam] = useState<BamState>(EMPTY_BAM);
    const [status, setStatus] = useState("No exon index loaded");

    const [currentGeneId, setCurrentGeneId] = useState<string | null>(null);
    const [queryLoading, setQueryLoading] = useState(false);
    const [queryError, setQueryError] = useState<string | null>(null);
    const [records, setRecords] = useState<BamRecord[] | null>(null);
    const [viewingGeneId, setViewingGeneId] = useState<string | null>(null);

    const queryTokenRef = useRef(0);

    const handleExonIndexFile = useCallback(async (file: File) => {
        setExonFileName(file.name);
        try {
            const text = await file.text();
            const genes: ExonGene[] = JSON.parse(text);
            const map = new Map<string, ExonGene>();
            for (const g of genes) map.set(g.id, g);
            setExonIndexById(map);
            setStatus(`${genes.length.toLocaleString()} genes loaded${bam.ready ? "" : " - load a BAM+BAI to query reads"}`);
        } catch (err) {
            console.error("Could not parse exon index JSON", err);
            setStatus("Failed to parse exon index JSON");
        }
    }, [bam.ready]);

    const runQuery = useCallback(async (geneId: string, bamState: BamState, geneMap: Map<string, ExonGene>) => {
        const gene = geneMap.get(geneId);
        if (!gene || !bamState.ready || !bamState.file) return;

        const token = ++queryTokenRef.current;
        setQueryLoading(true);
        setQueryError(null);
        setRecords(null);

        const refID = bamState.chromToRefID.get(gene.chrom);
        if (refID === undefined) {
            if (token === queryTokenRef.current) {
                setQueryLoading(false);
                setQueryError(`"${gene.chrom}" isn't a reference in this BAM`);
            }
            return;
        }

        try {
            const recs = await fetchRegionRecords(bamState.file, bamState.refIndex[refID], refID, gene.start - 1, gene.end, bamState.refNames);
            if (token !== queryTokenRef.current) return;
            setRecords(recs);
            setQueryLoading(false);
        } catch (err) {
            if (token !== queryTokenRef.current) return;
            console.error(err);
            setQueryLoading(false);
            setQueryError("Region query failed: " + (err as Error).message);
        }
    }, []);

    const handleBamBaiFiles = useCallback(async (bamFile: File, baiFile: File) => {
        setBamFileLabel(`${bamFile.name} + ${baiFile.name}`);
        setStatus("Reading BAM header and BAI index…");
        setBam(EMPTY_BAM);
        try {
            const [{ refNames }, refIndex] = await Promise.all([parseBAMHeader(bamFile), readBAI(baiFile)]);
            const chromToRefID = new Map(refNames.map((name, i) => [name, i]));
            const nextBam: BamState = { file: bamFile, refNames, chromToRefID, refIndex, ready: true };
            setBam(nextBam);
            setStatus(`BAM ready (${refNames.length.toLocaleString()} references) - select a gene to query its region`);
            if (currentGeneId) runQuery(currentGeneId, nextBam, exonIndexById);
        } catch (err) {
            console.error(err);
            setStatus("Failed to load BAM/BAI: " + (err as Error).message);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentGeneId, exonIndexById, runQuery]);

    const handleSelectGene = useCallback((geneId: string) => {
        setCurrentGeneId(geneId);
        setViewingGeneId(null);
        setRecords(null);
        setQueryError(null);
        setQueryLoading(false);
        if (bam.ready) runQuery(geneId, bam, exonIndexById);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bam, exonIndexById, runQuery]);

    // Re-run automatically if a fresh BAM finishes loading while a gene is already selected
    useEffect(() => {
        if (currentGeneId && bam.ready) runQuery(currentGeneId, bam, exonIndexById);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bam.ready]);

    const currentGene = currentGeneId ? exonIndexById.get(currentGeneId) ?? null : null;
    const viewingGene = viewingGeneId ? exonIndexById.get(viewingGeneId) ?? null : null;

    return (
        <>
            <Header
                exonFileName={exonFileName}
                bamFileLabel={bamFileLabel}
                exonIndexReady={exonIndexById.size > 0}
                exonIndexById={exonIndexById}
                status={status}
                onExonIndexFile={handleExonIndexFile}
                onBamBaiFiles={handleBamBaiFiles}
                onSelectGene={handleSelectGene}
            />
            <Legend />

            {currentGene && (
                <>
                    <p id="geneTitle">
                        {currentGene.name && currentGene.name !== currentGene.id ? `${currentGene.name} (${currentGene.id})` : currentGene.id}
                    </p>
                    <p id="geneSubtitle">
                        {currentGene.chrom}:{currentGene.start.toLocaleString()}-{currentGene.end.toLocaleString()}
                    </p>
                    <StatsRow
                        loading={queryLoading}
                        error={queryError}
                        records={records}
                        bamReady={bam.ready}
                        onView={() => setViewingGeneId(currentGeneId)}
                    />
                </>
            )}

            {viewingGene && records ? (
                <AlignmentCanvas gene={viewingGene} records={records} exonIndexById={exonIndexById} />
            ) : (
                <div id="placeholder">
                    Load an exon index (from build_exon_index.py) to get an instant, searchable gene list with
                    coordinates. Then load a BAM together with its .bai. Selecting a gene queries just that region
                    through the index - no need to scan the whole file - and shows a quick read-count summary. From
                    there, "View Nexon Alignments" draws the known transcript models alongside the actual reads.
                </div>
            )}
        </>
    );
}
