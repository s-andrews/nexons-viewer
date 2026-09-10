import type { DragEvent } from "react";
import type { BamRecord, ExonGene } from "../types";
import AlignmentCanvas from "./AlignmentCanvas";

interface AlignmentPanelProps {
    label: string;
    gene: ExonGene;
    records: BamRecord[] | null;
    loading: boolean;
    error: string | null;
    exonIndexById: Map<string, ExonGene>;
    locked: boolean;
    sharedView: { start: number; end: number } | null;
    onViewChange: (view: { start: number; end: number }) => void;
    sharedPeaks: Map<string, number> | null;
    onPeaksChange: (peaks: Map<string, number>) => void;
    onToggleLock: () => void;
    showLock: boolean;
    draggable: boolean;
    isDragging: boolean;
    isDropTarget: boolean;
    onHeaderDragStart: (e: DragEvent<HTMLDivElement>) => void;
    onHeaderDragOver: (e: DragEvent<HTMLDivElement>) => void;
    onHeaderDragLeave: (e: DragEvent<HTMLDivElement>) => void;
    onHeaderDrop: (e: DragEvent<HTMLDivElement>) => void;
    onHeaderDragEnd: (e: DragEvent<HTMLDivElement>) => void;
}

export default function AlignmentPanel({
    label,
    gene,
    records,
    loading,
    error,
    exonIndexById,
    locked,
    sharedView,
    onViewChange,
    sharedPeaks,
    onPeaksChange,
    onToggleLock,
    showLock,
    draggable,
    isDragging,
    isDropTarget,
    onHeaderDragStart,
    onHeaderDragOver,
    onHeaderDragLeave,
    onHeaderDrop,
    onHeaderDragEnd,
}: AlignmentPanelProps) {
    return (
        <div className={"alignment-panel" + (isDragging ? " dragging" : "") + (isDropTarget ? " drop-target" : "")}>
            <div
                className="alignment-panel-header"
                draggable={draggable}
                onDragStart={onHeaderDragStart}
                onDragOver={onHeaderDragOver}
                onDragLeave={onHeaderDragLeave}
                onDrop={onHeaderDrop}
                onDragEnd={onHeaderDragEnd}
            >
                {draggable && <span className="drag-handle" title="Drag to reorder panels">⠿</span>}
                <span className="panel-filename" title={label}>{label}</span>
                {showLock && (
                    <button
                        type="button"
                        className={"lock-toggle" + (locked ? " locked" : "")}
                        onClick={onToggleLock}
                        title={locked ? "Unlock to explore this panel independently" : "Re-lock to snap back and sync with other panels"}
                    >
                        {locked ? "🔒 Locked" : "🔓 Unlocked"}
                    </button>
                )}
            </div>
            <div className="alignment-panel-body">
                {error ? (
                    <div className="panel-message panel-message-error">{error}</div>
                ) : loading || !records ? (
                    <div className="panel-message">Querying BAM…</div>
                ) : (
                    <AlignmentCanvas
                        gene={gene}
                        records={records}
                        exonIndexById={exonIndexById}
                        locked={locked}
                        sharedView={sharedView}
                        onViewChange={onViewChange}
                        sharedPeaks={sharedPeaks}
                        onPeaksChange={onPeaksChange}
                    />
                )}
            </div>
        </div>
    );
}
