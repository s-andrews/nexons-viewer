export default function Legend() {
    return (
        <div id="legend">
            <div className="group">
                <span className="item">color = gene (nG)</span>
                <span className="item"><i className="box style-unique" /> unique</span>
                <span className="item"><i className="box style-partial" /> partial</span>
                <span className="item"><i className="box style-gene" /> gene-level only</span>
                <span className="item"><i className="box style-multi" /> multi-gene / no hit</span>
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
