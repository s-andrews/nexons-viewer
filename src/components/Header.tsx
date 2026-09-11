import { useMemo, useRef, useState, type ChangeEvent } from "react";
import type { ExonGene } from "../types";

interface HeaderProps {
    exonFileName: string;
    gtfProgress: number | null;
    bamFileLabel: string;
    exonIndexReady: boolean;
    exonIndexById: Map<string, ExonGene>;
    status: string;
    tslLevel: string;
    onTslLevelChange: (level: string) => void;
    onExonIndexFile: (file: File) => void;
    onBamBaiFiles: (pairs: { bamFile: File; baiFile: File }[]) => void;
    onSelectGene: (geneId: string) => void;
}

export default function Header({
    exonFileName,
    gtfProgress,
    bamFileLabel,
    exonIndexReady,
    exonIndexById,
    status,
    tslLevel,
    onTslLevelChange,
    onExonIndexFile,
    onBamBaiFiles,
    onSelectGene,
}: HeaderProps) {
    const [query, setQuery] = useState("");
    const [showSuggestions, setShowSuggestions] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (q.length < 1) return [];
        return [...exonIndexById.values()]
            .filter((g) => g.id.toLowerCase().startsWith(q) || (g.name && g.name.toLowerCase().startsWith(q)))
            .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
            .slice(0, 20);
    }, [query, exonIndexById]);

    function handleExonInput(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (file) onExonIndexFile(file);
        e.target.value = "";
    }

    function handleBamBaiInput(e: ChangeEvent<HTMLInputElement>) {
        const files = [...(e.target.files ?? [])];
        const bams = files.filter((file) => /\.bam$/i.test(file.name));
        const bais = files.filter((file) => /\.bai$/i.test(file.name));
        const pairs = bams.map((bamFile) => {
            const expectedNames = new Set([`${bamFile.name}.bai`, bamFile.name.replace(/\.bam$/i, ".bai")]);
            const baiFile = bais.find((file) => expectedNames.has(file.name));
            return baiFile ? { bamFile, baiFile } : null;
        }).filter((pair): pair is { bamFile: File; baiFile: File } => pair !== null);

        if (pairs.length !== bams.length || pairs.length === 0) {
            window.alert("Select each BAM together with its matching BAI file");
        } else {
            onBamBaiFiles(pairs);
        }
        e.target.value = "";
    }

    function pickGene(g: ExonGene) {
        setQuery(g.name || g.id);
        setShowSuggestions(false);
        onSelectGene(g.id);
    }

    return (
        <header>
            <h1>Nexons&nbsp;read&nbsp;viewer</h1>

            <label className="tsl-label" htmlFor="tslSelect">
                Max TSL:
                <select
                    id="tslSelect"
                    value={tslLevel}
                    onChange={(e) => onTslLevelChange(e.target.value)}
                    title="Transcript support level filter (applies when loading a .gtf file)"
                >
                    <option value="all">All</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="5">5</option>
                </select>
            </label>

            <label className={`file-label${gtfProgress !== null ? " file-label-progress" : ""}`} htmlFor="exonInput">
                {gtfProgress !== null && (
                    <span className="progress-fill" style={{ width: `${Math.min(100, Math.round(gtfProgress * 100))}%` }} />
                )}
                <span className="file-label-text">
                    {gtfProgress !== null
                        ? `Parsing… ${Math.round(gtfProgress * 100)}%`
                        : exonFileName
                            ? `GTF: ${exonFileName}`
                            : "Select GTF File"}
                </span>
                <input type="file" id="exonInput" accept=".json,.gtf,.gtf.txt" disabled={gtfProgress !== null} onChange={handleExonInput} />
            </label>

            <label className="file-label" htmlFor="bamBaiInput">
                BAM + BAI: <span className="fname">{bamFileLabel}</span>
                <input type="file" id="bamBaiInput" accept=".bam,.bai" multiple onChange={handleBamBaiInput} />
            </label>

            <div id="geneSearchWrap" ref={wrapRef}>
                <input
                    id="geneSearch"
                    type="text"
                    placeholder={exonIndexReady ? "Gene ID or name" : "Load a GTF first…"}
                    disabled={!exonIndexReady}
                    autoComplete="off"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setShowSuggestions(true);
                    }}
                    onBlur={() => {
                        // Delay so a click on a suggestion row still registers first
                        window.setTimeout(() => setShowSuggestions(false), 150);
                    }}
                />
                {showSuggestions && matches.length > 0 && (
                    <div id="suggestions">
                        {matches.map((g) => (
                            <div className="row" key={g.id} onMouseDown={(e) => e.preventDefault()} onClick={() => pickGene(g)}>
                                <span>
                                    {g.name && g.name !== g.id ? (
                                        <>
                                            {g.name} <span className="sugg-meta">{g.id}</span>
                                        </>
                                    ) : (
                                        g.id
                                    )}{" "}
                                    <span className="sugg-meta">{g.chrom}:{g.start}-{g.end}</span>
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div id="status">{status}</div>
        </header>
    );
}
