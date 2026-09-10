import { useMemo, useRef, useState, type ChangeEvent } from "react";
import type { ExonGene } from "../types";

interface HeaderProps {
    exonFileName: string;
    bamFileLabel: string;
    exonIndexReady: boolean;
    exonIndexById: Map<string, ExonGene>;
    status: string;
    onExonIndexFile: (file: File) => void;
    onBamBaiFiles: (bamFile: File, baiFile: File) => void;
    onSelectGene: (geneId: string) => void;
}

export default function Header({
    exonFileName,
    bamFileLabel,
    exonIndexReady,
    exonIndexById,
    status,
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
        const bamFile = files.find((f) => /\.bam$/i.test(f.name));
        const baiFile = files.find((f) => /\.bai$/i.test(f.name));
        if (!bamFile || !baiFile) {
            window.alert("Select both the .bam file and its matching .bai file together");
        } else {
            const expectedBai = bamFile.name + ".bai";
            if (baiFile.name !== expectedBai) {
                console.warn(`"${baiFile.name}" doesn't look like the standard index name for "${bamFile.name}" (expected "${expectedBai}") - continuing anyway`);
            }
            onBamBaiFiles(bamFile, baiFile);
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

            <label className="file-label" htmlFor="exonInput">
                Exon index <span className="fname">{exonFileName}</span>
                <input type="file" id="exonInput" accept=".json" onChange={handleExonInput} />
            </label>

            <label className="file-label" htmlFor="bamBaiInput">
                BAM + BAI <span className="fname">{bamFileLabel}</span>
                <input type="file" id="bamBaiInput" accept=".bam,.bai" multiple onChange={handleBamBaiInput} />
            </label>

            <div id="geneSearchWrap" ref={wrapRef}>
                <input
                    id="geneSearch"
                    type="text"
                    placeholder={exonIndexReady ? "Gene ID or name" : "Load an exon index first…"}
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
