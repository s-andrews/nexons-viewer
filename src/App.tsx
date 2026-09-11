import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BaiRefIndex, BamRecord, ExonGene } from "./types";
import { parseBAMHeader, readBAI, fetchRegionRecords } from "./bamIo";
import { parseGtfFile } from "./gtfIo";
import Header, { type LayoutMode } from "./components/Header";
import Legend from "./components/Legend";
import GeneTabs, { type GeneTab } from "./components/GeneTabs";
import AlignmentPanel from "./components/AlignmentPanel";
import "./App.css";

interface BamSource {
    id: string;
    label: string;
    file: File;
    refNames: string[];
    chromToRefID: Map<string, number>;
    refIndex: BaiRefIndex[];
    ready: boolean;
    records: BamRecord[] | null;
    queryLoading: boolean;
    queryError: string | null;
    // Which gene the current records/queryLoading/queryError reflect - lets the query effect
    // tell "never queried" apart from "queried, but for a different gene" without a separate pass.
    queriedGeneId: string | null;
}

// Panels are up to 4 fixed slots, of which only the first `layoutMode` are shown (1 / 2x1 / 2x2).
// A slot holds a reference to a pool source (or none, rendered as an empty slot) - loading more
// BAM/BAI pairs than there are visible slots just adds them to the pool, still pickable from any
// slot's dropdown, including a slot that already shows another pair (sharing the same query
// result, no duplicate fetch). Slots beyond the current layout keep whatever they were assigned
// so switching layout back and forth doesn't lose anything.
const SLOT_COUNT = 4;

interface PanelSlot {
    sourceId: string | null;
    locked: boolean;
}

function makeEmptySlots(): PanelSlot[] {
    return Array.from({ length: SLOT_COUNT }, () => ({ sourceId: null, locked: true }));
}

function autoLayoutMode(readyCount: number): LayoutMode {
    if (readyCount <= 1) return 1;
    if (readyCount === 2) return 2;
    return 4;
}

function makeId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function App() {
    const [exonIndexById, setExonIndexById] = useState<Map<string, ExonGene>>(new Map());
    const [exonFileName, setExonFileName] = useState("");
    const [gtfProgress, setGtfProgress] = useState<number | null>(null);
    const [tslLevel, setTslLevel] = useState("2");
    const lastGtfFileRef = useRef<File | null>(null);
    const [sources, setSources] = useState<BamSource[]>([]);
    const [slots, setSlots] = useState<PanelSlot[]>(makeEmptySlots());
    const [layoutMode, setLayoutMode] = useState<LayoutMode>(1);
    const layoutManualRef = useRef(false);
    const [status, setStatus] = useState("No GTF loaded");

    // Browser-tab-style gene navigation: each tab just carries a gene id, the panel layout and
    // BAM-to-slot assignments below are shared across every tab. Switching tabs re-queries the
    // same panels for the new gene's region rather than duplicating/caching per tab.
    const [tabs, setTabs] = useState<GeneTab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const [addressBarOpen, setAddressBarOpen] = useState(false);
    const [sharedView, setSharedView] = useState<{ start: number; end: number } | null>(null);

    // Density-track peaks reported by each panel slot (per transcript id), merged across slots
    // so the same transcript scales identically no matter which panel it's viewed in.
    const [peaksBySlot, setPeaksBySlot] = useState<Map<number, Map<string, number>>>(new Map());
    const peaksCallbacksRef = useRef<Map<number, (peaks: Map<string, number>) => void>>(new Map());

    const queryTokensRef = useRef<Map<string, number>>(new Map());

    const bamFileLabel = sources.length === 0 ? "choose files…" : `${sources.length} set${sources.length === 1 ? "" : "s"}`;
    const anyBamReady = sources.some((s) => s.ready);

    const parseGtfWithLevel = useCallback(async (file: File, level: string) => {
        setGtfProgress(0);
        setExonIndexById(new Map()); // drop the previous index up front so it can be freed while the next one builds
        const map = new Map<string, ExonGene>();
        try {
            const maxTsl = level === "all" ? null : parseInt(level, 10);
            await parseGtfFile(file, maxTsl, {
                onProgress: (fraction) => setGtfProgress(fraction),
                onGenes: (chunk) => { for (const g of chunk) map.set(g.id, g); },
            });
            setExonIndexById(map);
            setExonFileName(file.name);
            setGtfProgress(null);
            if (!anyBamReady) setStatus("Load BAM+BAI files to query reads");
        } catch (err) {
            console.error("Could not parse GTF", err);
            setGtfProgress(null);
            setStatus("Failed to parse GTF: " + (err as Error).message);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anyBamReady]);

    const handleExonIndexFile = useCallback(async (file: File) => {
        if (/\.json$/i.test(file.name)) {
            lastGtfFileRef.current = null;
            try {
                const text = await file.text();
                const genes: ExonGene[] = JSON.parse(text);
                const map = new Map<string, ExonGene>();
                for (const g of genes) map.set(g.id, g);
                setExonIndexById(map);
                setExonFileName(file.name);
                if (!anyBamReady) setStatus("Load BAM+BAI files to query reads");
            } catch (err) {
                console.error("Could not parse exon index JSON", err);
                setStatus("Failed to parse exon index JSON");
            }
            return;
        }
        lastGtfFileRef.current = file;
        await parseGtfWithLevel(file, tslLevel);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anyBamReady, tslLevel, parseGtfWithLevel]);

    const handleTslLevelChange = useCallback((level: string) => {
        setTslLevel(level);
        if (lastGtfFileRef.current) parseGtfWithLevel(lastGtfFileRef.current, level);
    }, [parseGtfWithLevel]);

    const runQuery = useCallback(async (geneId: string, sourceId: string, geneMap: Map<string, ExonGene>) => {
        setSources((prev) => prev.map((s) => (s.id === sourceId ? { ...s, queryLoading: true, queryError: null, records: null, queriedGeneId: geneId } : s)));

        const token = (queryTokensRef.current.get(sourceId) ?? 0) + 1;
        queryTokensRef.current.set(sourceId, token);

        setSources((prev) => {
            const source = prev.find((s) => s.id === sourceId);
            const gene = geneMap.get(geneId);
            if (!source || !source.ready || !gene) return prev;

            const refID = source.chromToRefID.get(gene.chrom);
            if (refID === undefined) {
                return prev.map((s) => (s.id === sourceId ? { ...s, queryLoading: false, queryError: `"${gene.chrom}" isn't a reference in this BAM` } : s));
            }

            fetchRegionRecords(source.file, source.refIndex[refID], refID, gene.start - 1, gene.end, source.refNames)
                .then((recs) => {
                    if (queryTokensRef.current.get(sourceId) !== token) return;
                    setSources((cur) => cur.map((s) => (s.id === sourceId ? { ...s, queryLoading: false, records: recs } : s)));
                })
                .catch((err) => {
                    if (queryTokensRef.current.get(sourceId) !== token) return;
                    console.error(err);
                    setSources((cur) => cur.map((s) => (s.id === sourceId ? { ...s, queryLoading: false, queryError: "Region query failed: " + (err as Error).message } : s)));
                });

            return prev;
        });
    }, []);

    const handleBamBaiFiles = useCallback(async (pairs: { bamFile: File; baiFile: File }[]) => {
        setStatus(`Reading ${pairs.length} BAM header${pairs.length > 1 ? "s" : ""} and BAI index${pairs.length > 1 ? "es" : ""}…`);

        const newSources = await Promise.all(
            pairs.map(async ({ bamFile, baiFile }): Promise<BamSource> => {
                const id = makeId();
                try {
                    const [{ refNames }, refIndex] = await Promise.all([parseBAMHeader(bamFile), readBAI(baiFile)]);
                    const chromToRefID = new Map(refNames.map((name, i) => [name, i]));
                    return {
                        id, label: bamFile.name, file: bamFile, refNames, chromToRefID, refIndex,
                        ready: true, records: null, queryLoading: false, queryError: null, queriedGeneId: null,
                    };
                } catch (err) {
                    console.error(err);
                    return {
                        id, label: bamFile.name, file: bamFile, refNames: [], chromToRefID: new Map(), refIndex: [],
                        ready: false, records: null, queryLoading: false,
                        queryError: "Failed to load BAM/BAI: " + (err as Error).message, queriedGeneId: null,
                    };
                }
            }),
        );

        let totalReady = 0;
        setSources((prev) => {
            const next = [...prev, ...newSources];
            totalReady = next.filter((s) => s.ready).length;
            return next;
        });

        // Fill any empty panel slots with the newly loaded BAMs, in order; anything past the
        // 4 slots just sits in the pool, still selectable from any slot's dropdown.
        const readyIds = newSources.filter((s) => s.ready).map((s) => s.id);
        setSlots((prev) => {
            const next = [...prev];
            let idx = 0;
            for (let i = 0; i < next.length && idx < readyIds.length; i++) {
                if (next[i].sourceId === null) {
                    next[i] = { ...next[i], sourceId: readyIds[idx] };
                    idx++;
                }
            }
            return next;
        });

        // Suggest a layout that fits what's loaded so far, unless the user has already picked one.
        if (!layoutManualRef.current) setLayoutMode(autoLayoutMode(totalReady));

        const readyCount = readyIds.length;
        setStatus(readyCount > 0
            ? `${readyCount} BAM${readyCount > 1 ? "s" : ""} ready - select a gene to query its region`
            : "Failed to load one or more BAM/BAI files");
    }, []);

    const handleLayoutModeChange = useCallback((mode: LayoutMode) => {
        layoutManualRef.current = true;
        setLayoutMode(mode);
    }, []);

    const handleOpenAddressBar = useCallback(() => setAddressBarOpen(true), []);
    const handleCloseAddressBar = useCallback(() => setAddressBarOpen(false), []);

    const handlePickGene = useCallback((geneId: string) => {
        const tab: GeneTab = { id: makeId(), geneId };
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
        setAddressBarOpen(false);
        setSharedView(null);
    }, []);

    const handleSelectTab = useCallback((tabId: string) => {
        setActiveTabId(tabId);
        setAddressBarOpen(false);
        setSharedView(null);
    }, []);

    const handleCloseTab = useCallback((tabId: string) => {
        setTabs((prev) => {
            const idx = prev.findIndex((t) => t.id === tabId);
            if (idx === -1) return prev;
            const next = prev.filter((t) => t.id !== tabId);
            setActiveTabId((cur) => {
                if (cur !== tabId) return cur;
                const fallbackIndex = idx > 0 ? idx - 1 : 0;
                return next[fallbackIndex]?.id ?? null;
            });
            return next;
        });
    }, []);

    const handleSlotSourceChange = useCallback((slotIndex: number, sourceId: string | null) => {
        setSlots((prev) => prev.map((slot, i) => (i === slotIndex ? { ...slot, sourceId } : slot)));
    }, []);

    const toggleSlotLock = useCallback((slotIndex: number) => {
        setSlots((prev) => prev.map((slot, i) => (i === slotIndex ? { ...slot, locked: !slot.locked } : slot)));
    }, []);

    const handlePanelViewChange = useCallback((slotIndex: number, next: { start: number; end: number }) => {
        setSlots((prev) => {
            if (prev[slotIndex]?.locked) setSharedView(next);
            return prev;
        });
    }, []);

    const handlePeaksChange = useCallback((slotIndex: number, peaks: Map<string, number>) => {
        setPeaksBySlot((prev) => {
            const next = new Map(prev);
            next.set(slotIndex, peaks);
            return next;
        });
    }, []);

    // Stable per-slot callback identity (AlignmentCanvas only re-reports peaks when its own
    // values change, so this doesn't need to change every render to avoid a report/re-render loop).
    function getPeaksCallback(slotIndex: number) {
        let fn = peaksCallbacksRef.current.get(slotIndex);
        if (!fn) {
            fn = (peaks: Map<string, number>) => handlePeaksChange(slotIndex, peaks);
            peaksCallbacksRef.current.set(slotIndex, fn);
        }
        return fn;
    }

    const sharedPeaks = useMemo(() => {
        const merged = new Map<string, number>();
        for (const peaks of peaksBySlot.values()) {
            for (const [id, v] of peaks) merged.set(id, Math.max(merged.get(id) ?? 0, v));
        }
        return merged;
    }, [peaksBySlot]);

    const currentGeneId = tabs.find((t) => t.id === activeTabId)?.geneId ?? null;

    // Single source of truth for querying: runs whenever the selected gene, the visible slot
    // assignments, or the source pool change, and queries any slot-assigned, ready source
    // whose records don't already reflect the current gene. Switching tabs just changes
    // currentGeneId, which this picks up the same way a fresh gene selection would.
    useEffect(() => {
        if (!currentGeneId) return;
        const visibleSlots = slots.slice(0, layoutMode);
        const assignedIds = new Set(visibleSlots.map((s) => s.sourceId).filter((id): id is string => id !== null));
        for (const source of sources) {
            if (!assignedIds.has(source.id) || !source.ready || source.queryLoading) continue;
            if (source.queriedGeneId === currentGeneId) continue;
            runQuery(currentGeneId, source.id, exonIndexById);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentGeneId, slots, layoutMode, sources, exonIndexById]);

    const currentGene = currentGeneId ? exonIndexById.get(currentGeneId) ?? null : null;
    const visibleSlotCount = layoutMode;
    const assignedCount = slots.slice(0, visibleSlotCount).filter((s) => s.sourceId !== null).length;
    const sourceOptions = useMemo(() => sources.map((s) => ({ id: s.id, label: s.label })), [sources]);

    function renderSlot(slotIndex: number) {
        const slot = slots[slotIndex];
        const source = slot.sourceId ? sources.find((s) => s.id === slot.sourceId) ?? null : null;
        return (
            <AlignmentPanel
                key={slotIndex}
                gene={currentGene}
                sourceOptions={sourceOptions}
                selectedSourceId={slot.sourceId}
                onSelectSource={(id) => handleSlotSourceChange(slotIndex, id)}
                records={source?.records ?? null}
                loading={source?.queryLoading ?? false}
                error={source?.queryError ?? null}
                exonIndexById={exonIndexById}
                locked={slot.locked}
                sharedView={sharedView}
                onViewChange={(v) => handlePanelViewChange(slotIndex, v)}
                sharedPeaks={sharedPeaks}
                onPeaksChange={getPeaksCallback(slotIndex)}
                onToggleLock={() => toggleSlotLock(slotIndex)}
                showLock={assignedCount > 1}
            />
        );
    }

    return (
        <>
            <Header
                exonFileName={exonFileName}
                gtfProgress={gtfProgress}
                bamFileLabel={bamFileLabel}
                status={status}
                tslLevel={tslLevel}
                onTslLevelChange={handleTslLevelChange}
                onExonIndexFile={handleExonIndexFile}
                onBamBaiFiles={handleBamBaiFiles}
                layoutMode={layoutMode}
                onLayoutModeChange={handleLayoutModeChange}
            />
            <Legend />

            <GeneTabs
                tabs={tabs}
                activeTabId={activeTabId}
                addressBarOpen={addressBarOpen}
                exonIndexById={exonIndexById}
                exonIndexReady={exonIndexById.size > 0}
                onSelectTab={handleSelectTab}
                onCloseTab={handleCloseTab}
                onOpenAddressBar={handleOpenAddressBar}
                onCloseAddressBar={handleCloseAddressBar}
                onPickGene={handlePickGene}
            />

            {currentGene && sources.length > 0 ? (
                <div id="panelArea">
                    <div className={`panel-grid layout-${visibleSlotCount}`}>
                        {Array.from({ length: visibleSlotCount }, (_, i) => renderSlot(i))}
                    </div>
                </div>
            ) : (
                <div id="placeholder">
                    Load a GTF (optionally filtered by transcript support level) to get an instant, searchable gene
                    list with coordinates. Then load one or more BAM files together with their .bai. Open a gene in
                    a new tab with the + button above - it queries just that region through each index and shows
                    the known transcript models alongside the actual reads, in up to 4 panels at once, each with
                    its own BAM picker.
                </div>
            )}
        </>
    );
}
