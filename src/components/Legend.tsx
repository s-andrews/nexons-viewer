export default function Legend() {
    return (
        <div id="legend">
            <div className="group">
                <span className="item"><i className="box" style={{ background: "rgb(var(--unique))" }} /> unique</span>
                <span className="item"><i className="box" style={{ background: "rgb(var(--partial))" }} /> partial</span>
                <span className="item"><i className="box" style={{ background: "rgb(var(--gene))" }} /> gene-level only</span>
                <span className="item"><i className="box" style={{ background: "rgb(var(--multi))" }} /> multi-gene</span>
                <span className="item"><i className="box" style={{ background: "rgb(var(--none))" }} /> no match</span>
            </div>
            <div className="sep" />
            <div className="group">
                <span className="item"><i className="box" style={{ background: "rgb(80,80,80)" }} /> primary</span>
                <span className="item"><i className="box secondary" style={{ background: "rgb(80,80,80)" }} /> secondary</span>
            </div>
            <div className="sep" />
            <div className="group">
                <span className="item"><i className="box" style={{ background: "#7c3aed", width: 3 }} /> insertion</span>
                <span className="item"><i className="box" style={{ background: "#1f2933", height: 2 }} /> deletion</span>
                <span className="item">(shown when zoomed in enough)</span>
            </div>
        </div>
    );
}
