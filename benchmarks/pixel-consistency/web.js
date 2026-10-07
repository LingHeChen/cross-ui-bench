export async function renderPixelFixture(id) {
  const fixtures = await (await fetch("./pixel/fixtures.json")).json();
  const fixture = fixtures.find((f) => f.id === id);
  if (!fixture) throw Error("Unknown pixel fixture");
  const style = document.createElement("style");
  style.textContent = `@font-face{font-family:PixelPlex;src:url('./fonts/IBMPlexSans-Regular.ttf')}@font-face{font-family:PixelMono;src:url('./fonts/IBMPlexMono-Regular.ttf')}*{box-sizing:border-box}html,body{margin:0;width:1280px;height:800px;background:${fixture.background};overflow:hidden;font-family:PixelPlex;color:#193a2c}#pixel-root{position:relative;width:1280px;height:800px}#pixel-root *{margin:0;font-weight:400}button,input{font-family:PixelPlex;outline:none}button{display:flex;align-items:center;justify-content:center}input{padding:0 12px}input::placeholder{color:#68756a;opacity:1}`;
  document.head.append(style);
  const root = document.createElement("main");
  root.id = "pixel-root";
  document.body.replaceChildren(root);
  const make = (node, parent) => {
    const e = document.createElement(
      node.type === "input"
        ? "input"
        : node.type === "button"
          ? "button"
          : node.type === "image"
            ? "img"
            : "div",
    );
    e.dataset.pixel = node.id;
    e.style.cssText = `position:absolute;left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px;font-size:${node.fontSize ?? 16}px;line-height:1.25;color:${node.textColor ?? (node.type === "text" ? node.color : "#193a2c") ?? "#193a2c"};background:${node.type === "text" ? "transparent" : (node.color ?? "transparent")};border:${node.border ? "1px solid " + node.border : node.type === "input" ? "1px solid #d7ddd5" : "0"};border-radius:${node.radius ?? (node.type === "button" || node.type === "input" ? 6 : 0)}px;font-family:${node.mono ? "PixelMono" : "PixelPlex"};`;
    if (node.type === "gradient")
      e.style.background = "linear-gradient(120deg,#193a2c,#c0ef81)";
    if (node.type === "blur") e.style.backdropFilter = "blur(8px)";
    if (node.shadow) e.style.boxShadow = "0 10px 24px #193a2c26";
    if (node.type === "image") {
      e.src = "./pixel/image.png";
      e.style.objectFit = "cover";
    } else if (node.type === "input") {
      e.placeholder = node.text;
      e.readOnly = true;
    } else if (node.type === "icon")
      e.innerHTML =
        '<svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M4 4h10v10H4zM18 4h10v10H18zM4 18h10v10H4zM18 18l10 10m0-10L18 28" stroke="#193a2c" stroke-width="2"/></svg>';
    else if (node.text) e.textContent = node.text;
    parent.append(e);
    node.children?.forEach((n) => make(n, e));
  };
  fixture.nodes.forEach((n) => make(n, root));
  await document.fonts.ready;
  await Promise.all([...root.querySelectorAll("img")].map((i) => i.decode()));
  await new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r)),
  );
  const bounds = {};
  for (const e of root.querySelectorAll("[data-pixel]")) {
    const r = e.getBoundingClientRect();
    let textBounds = null;
    if (e.firstChild?.nodeType === 3) {
      const range = document.createRange();
      range.selectNodeContents(e);
      const b = range.getBoundingClientRect();
      textBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
    }
    bounds[e.dataset.pixel] = {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      textBounds,
    };
  }
  window.__PIXEL_READY__ = {
    fixture: fixture.id,
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    bounds,
    locale: "en",
    theme: "light",
    font: "bundled IBM Plex TTF",
  };
  if (window.__TAURI_INTERNALS__) {
    await window.__TAURI_INTERNALS__.invoke("pixel_ready", {
      metadata: window.__PIXEL_READY__,
    });
  }
}
