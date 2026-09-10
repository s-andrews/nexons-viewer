import type { ReactNode } from "react";
import type { BamRecord } from "../types";

const NR_KEYS = ["unique", "partial", "gene", "multi", "none"] as const;

interface StatsRowProps {
    loading: boolean;
    error: string | null;
    records: BamRecord[] | null;
    bamReady: boolean;
    onView: () => void;
}

export default function StatsRow({ loading, error, records, bamReady, onView }: StatsRowProps) {
    let body: ReactNode;
    let total = 0;

    if (!bamReady) {
        body = <div className="stats-loading">Load a BAM + BAI to query reads in this region</div>;
    } else if (loading) {
        body = <div className="stats-loading">Querying BAM via BAI…</div>;
    } else if (error) {
        body = <div className="stats-loading">{error}</div>;
    } else if (records) {
        total = records.length;
        const primary = records.filter((r) => !r.isSecondary).length;
        const secondary = total - primary;
        const nrCounts: Record<string, number> = { unique: 0, partial: 0, gene: 0, multi: 0, none: 0 };
        for (const r of records) {
            const val = r.tags.nR;
            nrCounts[typeof val === "string" && val in nrCounts ? val : "none"]++;
        }
        body = (
            <div className="stats-row">
                <span><b>{total.toLocaleString()}</b> reads in region</span>
                <span>{primary.toLocaleString()} primary / {secondary.toLocaleString()} secondary</span>
                <span className="stats-nr">
                    {NR_KEYS.map((key) => (
                        <span key={key}>
                            <i className="box" style={{ background: `rgb(var(--${key}))` }} />
                            {nrCounts[key].toLocaleString()}
                        </span>
                    ))}
                </span>
            </div>
        );
    } else {
        body = null;
    }

    const disabled = !bamReady || loading || !records || total === 0;

    return (
        <div id="statsRow">
            <div id="statsPanel" style={{ display: bamReady || loading || error || records ? "block" : "none" }}>
                {body}
            </div>
            <button
                id="viewButton"
                style={{ display: bamReady || loading || error || records ? "inline-block" : "none" }}
                disabled={disabled}
                title={records && total === 0 ? "No reads in this region" : ""}
                onClick={onView}
            >
                View Nexon Alignments
            </button>
        </div>
    );
}
