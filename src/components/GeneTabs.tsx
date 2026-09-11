import { useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { ExonGene } from "../types";

export interface GeneTab {
    id: string;
    geneId: string;
}

interface GeneTabsProps {
    tabs: GeneTab[];
    activeTabId: string | null;
    addressBarOpen: boolean;
    exonIndexById: Map<string, ExonGene>;
    exonIndexReady: boolean;
    onSelectTab: (id: string) => void;
    onCloseTab: (id: string) => void;
    onOpenAddressBar: () => void;
    onCloseAddressBar: () => void;
    onPickGene: (geneId: string) => void;
}

export default function GeneTabs({
    tabs,
    activeTabId,
    addressBarOpen,
    exonIndexById,
    exonIndexReady,
    onSelectTab,
    onCloseTab,
    onOpenAddressBar,
    onCloseAddressBar,
    onPickGene,
}: GeneTabsProps) {
    const [query, setQuery] = useState("");
    const [showSuggestions, setShowSuggestions] = useState(false);

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (q.length < 1) return [];
        return [...exonIndexById.values()]
            .filter((g) => g.id.toLowerCase().startsWith(q) || (g.name && g.name.toLowerCase().startsWith(q)))
            .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
            .slice(0, 20);
    }, [query, exonIndexById]);

    function pickGene(g: ExonGene) {
        setQuery("");
        setShowSuggestions(false);
        onPickGene(g.id);
    }

    function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Escape") {
            setQuery("");
            setShowSuggestions(false);
            onCloseAddressBar();
        }
    }

    return (
        <div id="geneTabs">
            <div className="tab-strip">
                {tabs.map((tab) => {
                    const gene = exonIndexById.get(tab.geneId);
                    const title = gene && gene.name && gene.name !== gene.id ? `${gene.name} (${gene.id})` : (gene?.id ?? tab.geneId);
                    const coords = gene ? `${gene.chrom}:${gene.start.toLocaleString()}-${gene.end.toLocaleString()}` : "";
                    return (
                        <div
                            key={tab.id}
                            className={"gene-tab" + (tab.id === activeTabId ? " active" : "")}
                            onClick={() => onSelectTab(tab.id)}
                        >
                            <span className="gene-tab-label" title={title}>{title}</span>
                            {coords && <span className="gene-tab-coords">{coords}</span>}
                            <button
                                type="button"
                                className="gene-tab-close"
                                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                                title="Close tab"
                            >
                                ×
                            </button>
                        </div>
                    );
                })}
                <button
                    type="button"
                    className={"gene-tab-add" + (tabs.length === 0 ? " gene-tab-add-empty" : "")}
                    onClick={onOpenAddressBar}
                    title="Open a gene in a new tab"
                >
                    +
                </button>
            </div>
            {addressBarOpen && (
                <div id="geneAddressBarWrap">
                    <input
                        id="geneAddressBar"
                        type="text"
                        placeholder={exonIndexReady ? "Gene ID or name" : "Load a GTF first…"}
                        disabled={!exonIndexReady}
                        autoComplete="off"
                        autoFocus
                        value={query}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => { setQuery(e.target.value); setShowSuggestions(true); }}
                        onKeyDown={handleKeyDown}
                        onBlur={() => window.setTimeout(() => setShowSuggestions(false), 150)}
                    />
                    {showSuggestions && matches.length > 0 && (
                        <div id="suggestions">
                            {matches.map((g) => (
                                <div className="row" key={g.id} onMouseDown={(e) => e.preventDefault()} onClick={() => pickGene(g)}>
                                    <span>
                                        {g.name && g.name !== g.id ? (
                                            <>{g.name} <span className="sugg-meta">{g.id}</span></>
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
            )}
        </div>
    );
}
